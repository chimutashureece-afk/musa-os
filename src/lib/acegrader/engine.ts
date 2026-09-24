// ============================================================================
// AceGrader engine — Gemini structured-JSON marking + deterministic simulated mode.
// ============================================================================
import { GoogleGenAI, Type } from '@google/genai';
import type { Annotation, GradeCriterionResult, GradingResult, Rubric, SubmissionInput, TeacherCorrection } from '../../types';

const API_KEY = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() || '';
export const AI_MODEL: string = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || 'gemini-3-flash-preview';
export const aiAvailable: boolean = !!API_KEY;

const TIMEOUT_MS = 90_000;
const TEXT_CAP = 60_000;

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: API_KEY }));

export class GraderError extends Error {
  transient: boolean;
  constructor(msg: string, transient = false) { super(msg); this.transient = transient; this.name = 'GraderError'; }
}

// ------------------------------------------------------------------ utils --
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const roundHalf = (n: number) => Math.round(n * 2) / 2;
export const rubricTotal = (r: Pick<Rubric, 'criteria'>) => r.criteria.reduce((a, c) => a + (Number(c.maxPoints) || 0), 0);

function extractJSON(text: string | undefined): any {
  if (!text) throw new GraderError('The marking service returned an empty response. Please try again.', true);
  try { return JSON.parse(text); } catch { /* fall through */ }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch { /* fall through */ }
  }
  throw new GraderError('The marking response could not be read as a structured result. Try again, or shorten the submission.', true);
}

function friendlyError(err: any): GraderError {
  if (err instanceof GraderError) return err;
  if (err?.name === 'AbortError') return new GraderError('Cancelled.');
  const status: number | undefined = err?.status ?? err?.code;
  const msg = String(err?.message ?? err ?? '');
  if (status === 400 && /api key/i.test(msg)) return new GraderError('The marking service key was rejected. Check VITE_GEMINI_API_KEY.');
  if (status === 401 || status === 403) return new GraderError('The marking service refused the request (permission denied). Check the API key and that the model is enabled for it.');
  if (status === 404) return new GraderError(`The model “${AI_MODEL}” was not found. Set VITE_GEMINI_MODEL to an available model.`);
  if (status === 413 || /too large|payload/i.test(msg)) return new GraderError('The file is too large to mark. Use a smaller scan or split the document.');
  if (status === 429 || /quota|rate/i.test(msg)) return new GraderError('Gemini rate limit reached. Wait a minute and retry.', true);
  if (status && status >= 500) return new GraderError('Gemini is temporarily unavailable. Retrying usually helps.', true);
  if (/fetch|network|failed to fetch|ECONN/i.test(msg)) return new GraderError('Network error while contacting Gemini. Check your connection.', true);
  if (/safety|blocked/i.test(msg)) return new GraderError('The marking service declined to process this content (safety filter).');
  return new GraderError(msg || 'Unexpected error from the marking service.', true);
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); }, { once: true });
});

/** Calls Gemini with a per-attempt timeout and one retry on transient failures. */
async function callJSON(parts: any[], systemInstruction: string, responseSchema: any, signal?: AbortSignal): Promise<any> {
  let lastErr: GraderError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new GraderError('Cancelled.');
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
    try {
      const response = await ai().models.generateContent({
        model: AI_MODEL,
        contents: [{ role: 'user', parts }],
        config: { systemInstruction, responseMimeType: 'application/json', responseSchema, maxOutputTokens: 32768, abortSignal: ctrl.signal },
      });
      const cand = response.candidates?.[0];
      if (!response.text && cand?.finishReason && /SAFETY|PROHIBITED|BLOCK/i.test(String(cand.finishReason)))
        throw new GraderError('The marking service declined to process this content (safety filter).');
      if (cand?.finishReason && String(cand.finishReason) === 'MAX_TOKENS' && !response.text)
        throw new GraderError('The response was cut off (document too long). Split the script and try again.');
      return extractJSON(response.text);
    } catch (e: any) {
      if (signal?.aborted) throw new GraderError('Cancelled.');
      lastErr = timedOut ? new GraderError(`Marking took longer than ${TIMEOUT_MS / 1000}s. Try again or use a smaller file.`, true) : friendlyError(e);
      if (!lastErr.transient || attempt === 1) throw lastErr;
      await sleep(1500 + attempt * 1500, signal);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr ?? new GraderError('Unknown marking error.');
}

const inputParts = (label: string, input: SubmissionInput): any[] =>
  input.type === 'file' && input.mimeType
    ? [{ text: label }, { inlineData: { mimeType: input.mimeType, data: input.content } }]
    : [{ text: `${label}\n"""\n${input.content.slice(0, TEXT_CAP)}\n"""` }];

// ======================================================== rubric extraction --
const RUBRIC_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    keyPointers: { type: Type.ARRAY, items: { type: Type.STRING } },
    criteria: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, maxPoints: { type: Type.NUMBER }, description: { type: Type.STRING } },
        required: ['name', 'maxPoints', 'description'],
        propertyOrdering: ['name', 'maxPoints', 'description'],
      },
    },
  },
  required: ['title', 'description', 'criteria', 'keyPointers'],
  propertyOrdering: ['title', 'description', 'criteria', 'keyPointers'],
};

function cleanRubric(raw: any): Omit<Rubric, 'id'> {
  const criteria = (Array.isArray(raw?.criteria) ? raw.criteria : [])
    .map((c: any) => ({ name: String(c?.name ?? '').trim(), maxPoints: Math.max(0, Number(c?.maxPoints) || 0), description: String(c?.description ?? '').trim() }))
    .filter((c: any) => c.name);
  return {
    title: String(raw?.title ?? '').trim() || 'Imported rubric',
    description: String(raw?.description ?? '').trim(),
    criteria: criteria.length ? criteria : fallbackCriteria(),
    keyPointers: (Array.isArray(raw?.keyPointers) ? raw.keyPointers : []).map((k: any) => String(k).trim()).filter(Boolean).slice(0, 8),
  };
}

export async function extractRubric(input: SubmissionInput, signal?: AbortSignal): Promise<Omit<Rubric, 'id'>> {
  if (!aiAvailable) return simulateExtractRubric(input);
  const parts = [
    { text: 'Convert the marking scheme / rubric below into structured criteria. Keep the teacher\'s own criterion names and exact point values. If only band descriptors are given, create one criterion per assessed skill with its maximum mark. Write a short title and one-sentence description. Add 3–6 keyPointers: the critical things a strong answer must contain (key facts, required points, success criteria).' },
    ...inputParts('MARKING SCHEME:', input),
  ];
  const raw = await callJSON(parts, 'You are an experienced examiner and curriculum specialist. You convert any marking scheme, rubric or question paper into a clean, precise JSON rubric. Never invent point values that contradict the source.', RUBRIC_SCHEMA, signal);
  return cleanRubric(raw);
}

const fallbackCriteria = () => [
  { name: 'Content & understanding', maxPoints: 10, description: 'Relevant, accurate ideas that answer the task and show understanding.' },
  { name: 'Organisation & structure', maxPoints: 5, description: 'Logical order, clear paragraphs, introduction and conclusion.' },
  { name: 'Language & accuracy', maxPoints: 5, description: 'Appropriate vocabulary; correct grammar, spelling and punctuation.' },
];

/** Offline parser: "Criterion (10)", "Name - 10 marks", "Name: 10". */
export function simulateExtractRubric(input: SubmissionInput): Omit<Rubric, 'id'> {
  if (input.type === 'file') {
    return { title: input.fileName?.replace(/\.[^.]+$/, '') || 'Imported rubric', description: 'Starter rubric (quick-marking mode could not read the file — edit criteria below).', criteria: fallbackCriteria(), keyPointers: [] };
  }
  const lines = input.content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const criteria: { name: string; maxPoints: number; description: string }[] = [];
  const pointers: string[] = [];
  let title = '';
  const strip = (s: string) => s.replace(/^(?:[-*•▪◦]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i, '').trim();
  const reParen = /^(.+?)\s*[([]\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)?\s*[)\]]\s*[:\-–—.]?\s*(.*)$/i;
  const reSep = /^(.+?)\s*[:\-–—]\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\b\.?\s*(?:[:\-–—,.;]\s*)?(.*)$/i;
  const reColon = /^(.+?)\s*:\s*(\d+(?:\.\d+)?)\s*$/;
  const reTrail = /^(.+?)\s+(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)\s*$/i;
  for (const raw of lines) {
    const bullet = /^(?:[-*•▪◦])\s+/.test(raw);
    const l = strip(raw);
    const m = l.match(reParen) ?? l.match(reSep) ?? l.match(reColon) ?? l.match(reTrail);
    if (m && m[1]!.length <= 90 && !/^total\b/i.test(m[1]!)) {
      criteria.push({ name: m[1]!.replace(/[:\-–—]+$/, '').trim(), maxPoints: Number(m[2]), description: (m[3] ?? '').trim() });
    } else if (/^total\b/i.test(l)) {
      continue;
    } else if (!title && !criteria.length && !bullet && l.length <= 100) {
      title = l;
    } else if (criteria.length && !bullet && !criteria[criteria.length - 1]!.description) {
      criteria[criteria.length - 1]!.description = l;
    } else if (bullet || /key|must|should|ensure/i.test(l)) {
      if (pointers.length < 6) pointers.push(l);
    } else if (criteria.length) {
      const c = criteria[criteria.length - 1]!;
      c.description = `${c.description} ${l}`.trim();
    }
  }
  return {
    title: title || 'Imported rubric',
    description: criteria.length ? `Imported from pasted marking scheme (${criteria.length} criteria).` : 'Starter rubric — no point values were detected, so a default structure was used.',
    criteria: criteria.length ? criteria : fallbackCriteria(),
    keyPointers: pointers,
  };
}

// ================================================================= grading --
export interface GradeArgs {
  rubric: Rubric;
  submission: SubmissionInput;
  questionPaper?: SubmissionInput;
  corrections?: TeacherCorrection[];
  level?: string;
  subjectName?: string;
  studentFirstName?: string;
  signal?: AbortSignal;
}

const GRADE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    thinkingProcess: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Short bullet notes of the marking reasoning (for the teacher).' },
    fullTranscribedText: { type: Type.STRING, description: 'Complete verbatim transcription for scanned/file submissions. Empty string for typed text submissions.' },
    breakdown: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, pointsEarned: { type: Type.NUMBER }, maxPoints: { type: Type.NUMBER }, justification: { type: Type.STRING } },
        required: ['name', 'pointsEarned', 'maxPoints', 'justification'],
        propertyOrdering: ['name', 'justification', 'pointsEarned', 'maxPoints'],
      },
    },
    annotations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          originalText: { type: Type.STRING, description: 'EXACT substring copied from the student text (3–12 words).' },
          correction: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['error', 'warning', 'praise', 'grammar'] },
          comment: { type: Type.STRING },
        },
        required: ['originalText', 'type', 'comment'],
        propertyOrdering: ['originalText', 'type', 'correction', 'comment'],
      },
    },
    summary: { type: Type.STRING },
    feedback: { type: Type.STRING },
    improvementTips: { type: Type.ARRAY, items: { type: Type.STRING } },
    totalScore: { type: Type.NUMBER },
    maxTotalScore: { type: Type.NUMBER },
  },
  required: ['thinkingProcess', 'fullTranscribedText', 'breakdown', 'annotations', 'summary', 'feedback', 'improvementTips', 'totalScore', 'maxTotalScore'],
  propertyOrdering: ['thinkingProcess', 'fullTranscribedText', 'breakdown', 'annotations', 'summary', 'feedback', 'improvementTips', 'totalScore', 'maxTotalScore'],
};

function audienceNote(level?: string) {
  if (!level) return 'Write feedback suitable for a secondary-school learner.';
  if (/ECD|Grade [1-3]\b/i.test(level)) return `The learner is in ${level} (young child): use very simple, warm, short sentences.`;
  if (/Grade/i.test(level)) return `The learner is in ${level} (primary school): use simple, friendly, encouraging language.`;
  if (/Form [56]/i.test(level)) return `The learner is in ${level} (A-Level): be academically rigorous, precise and mature in tone.`;
  return `The learner is in ${level} (secondary school): be clear, direct and encouraging.`;
}

function fewShot(corrections: TeacherCorrection[] | undefined): string {
  const recent = [...(corrections ?? [])].sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
  if (!recent.length) return '';
  const lines = recent.map((c, i) => {
    const delta = c.correctedScore - c.originalScore;
    const dir = delta > 0 ? `raised by ${delta}` : delta < 0 ? `lowered by ${-delta}` : 'kept the score';
    return `${i + 1}. Criterion “${c.criterion}”: AI gave ${c.originalScore}, teacher ${dir} → ${c.correctedScore}.` +
      (c.reason ? ` Reason: ${c.reason}.` : '') +
      (c.correctedFeedback && c.correctedFeedback !== c.originalFeedback ? ` Teacher's wording: “${c.correctedFeedback.slice(0, 240)}”.` : '');
  });
  return `CALIBRATION — this teacher has corrected earlier AI marking with this rubric. Learn their standard (strictness, what they reward/penalise, tone) and apply it consistently:\n${lines.join('\n')}`;
}

export async function gradeSubmission(args: GradeArgs): Promise<GradingResult> {
  const { rubric, submission, questionPaper, corrections, level, subjectName, signal } = args;
  if (!aiAvailable) return simulateGrading(args);
  const total = rubricTotal(rubric);
  const criteriaList = rubric.criteria.map((c, i) => `${i + 1}. “${c.name}” — max ${c.maxPoints}: ${c.description}`).join('\n');
  const isText = submission.type === 'text';
  const system = [
    'You are AceGrader, a meticulous, fair and kind examiner who marks school work strictly against a rubric.',
    'Rules:',
    '- Award marks for EVERY rubric criterion, in the given order, using the exact criterion names. pointsEarned must be between 0 and that criterion\'s maxPoints (half marks allowed).',
    '- Each justification must cite concrete evidence from the work (quote short phrases) and explain why marks were gained or lost against the criterion description.',
    '- Annotations: 5–15 margin notes. originalText MUST be copied character-for-character from the student text (a short phrase of 3–12 words, no ellipses, no paraphrase) so it can be highlighted. Use type praise for strengths, error for content/factual mistakes, grammar for spelling/grammar/punctuation (give the correction), warning for style/clarity concerns.',
    '- feedback: 2–4 sentences addressed directly to the learner, beginning with a genuine strength, then the most important next step. summary: 1–2 sentences for the teacher.',
    '- improvementTips: 2–4 short, specific, actionable tips (imperative sentences).',
    '- totalScore = sum of pointsEarned; maxTotalScore = rubric total.',
    `- ${audienceNote(level)}`,
    '- Never invent content that is not in the work. If the work is blank, illegible or off-task, award low marks and say so.',
  ].join('\n');
  const parts: any[] = [{
    text: [
      subjectName ? `SUBJECT: ${subjectName}` : '',
      level ? `LEVEL: ${level}` : '',
      `RUBRIC: ${rubric.title}${rubric.description ? ` — ${rubric.description}` : ''}`,
      `CRITERIA (total ${total}):\n${criteriaList}`,
      rubric.keyPointers?.length ? `KEY POINTERS a strong answer should contain:\n- ${rubric.keyPointers.join('\n- ')}` : '',
      fewShot(corrections),
      isText
        ? 'The submission is typed text: return fullTranscribedText as an empty string, and quote annotations exactly from the text given.'
        : 'The submission is a scanned/uploaded document: transcribe the COMPLETE student response verbatim into fullTranscribedText (do not correct errors), then quote annotations from that transcription.',
    ].filter(Boolean).join('\n\n'),
  }];
  if (questionPaper) parts.push(...inputParts('QUESTION PAPER / TASK (context only — do not mark this):', questionPaper));
  parts.push(...inputParts('STUDENT SUBMISSION:', submission));

  const raw = await callJSON(parts, system, GRADE_SCHEMA, signal);
  const transcription = isText ? submission.content : String(raw?.fullTranscribedText ?? '').trim();
  return normalizeResult(raw, rubric, transcription || undefined);
}

/** Enforce rubric structure: clamp criteria, recompute totals, align breakdown with rubric order. */
export function normalizeResult(raw: any, rubric: Rubric, transcription?: string): GradingResult {
  const given: any[] = Array.isArray(raw?.breakdown) ? raw.breakdown : [];
  const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\band\b/g, ' ').replace(/\s+/g, ' ').trim();
  const used = new Set<number>();
  const pick = new Array<number>(rubric.criteria.length).fill(-1);
  const names = given.map((g) => norm(String(g?.name ?? '')));
  // pass 1: exact names; pass 2: containment; pass 3: position
  rubric.criteria.forEach((c, i) => { const j = names.findIndex((n, k) => !used.has(k) && n === norm(c.name)); if (j >= 0) { pick[i] = j; used.add(j); } });
  rubric.criteria.forEach((c, i) => {
    if (pick[i]! >= 0) return;
    const cn = norm(c.name);
    const j = names.findIndex((n, k) => !used.has(k) && n.length > 2 && (n.includes(cn) || cn.includes(n)));
    if (j >= 0) { pick[i] = j; used.add(j); }
  });
  rubric.criteria.forEach((_, i) => { if (pick[i]! < 0 && given[i] && !used.has(i)) { pick[i] = i; used.add(i); } });
  const breakdown: GradeCriterionResult[] = rubric.criteria.map((c, i) => {
    const g = pick[i]! >= 0 ? given[pick[i]!] : undefined;
    const pts = Number(g?.pointsEarned);
    return {
      name: c.name,
      maxPoints: c.maxPoints,
      pointsEarned: roundHalf(clamp(Number.isFinite(pts) ? pts : 0, 0, c.maxPoints)),
      justification: String(g?.justification ?? '').trim() || 'Not assessed — please review.',
    };
  });
  const lower = transcription?.toLowerCase() ?? '';
  const annotations: Annotation[] = (Array.isArray(raw?.annotations) ? raw.annotations : [])
    .map((a: any) => ({
      originalText: String(a?.originalText ?? '').trim().replace(/^["“'‘]+|["”'’]+$/g, '').replace(/\s*(\.\.\.|…)\s*$/, ''),
      correction: a?.correction ? String(a.correction).trim() : undefined,
      type: (['error', 'warning', 'praise', 'grammar'].includes(a?.type) ? a.type : 'warning') as Annotation['type'],
      comment: String(a?.comment ?? '').trim(),
    }))
    .filter((a: Annotation) => a.originalText && a.comment)
    // prefer annotations that can be located in the text
    .sort((a: Annotation, b: Annotation) => (lower ? Number(!lower.includes(a.originalText.toLowerCase())) - Number(!lower.includes(b.originalText.toLowerCase())) : 0))
    .slice(0, 20);
  annotations.forEach((a) => { if (!a.correction) delete a.correction; });
  const totalScore = Math.round(breakdown.reduce((a, b) => a + b.pointsEarned, 0) * 10) / 10;
  return {
    summary: String(raw?.summary ?? '').trim(),
    thinkingProcess: (Array.isArray(raw?.thinkingProcess) ? raw.thinkingProcess : []).map(String).filter(Boolean),
    improvementTips: (Array.isArray(raw?.improvementTips) ? raw.improvementTips : []).map(String).map((s: string) => s.trim()).filter(Boolean).slice(0, 6),
    annotations,
    breakdown,
    totalScore,
    maxTotalScore: rubricTotal(rubric),
    feedback: String(raw?.feedback ?? '').trim(),
    ...(transcription ? { fullTranscribedText: transcription } : {}),
    ...(raw?.simulated ? { simulated: true } : {}),
  };
}

// ========================================================= simulated mode --
const STOP = new Set('a an the and or but if then than so to of in on at by for with from as is are was were be been being it its this that these those there their they them he she his her you your we our i me my not no yes do does did have has had will would can could should may might must also very just into about over under after before up down out more most less some any all each every such what which who whom when where why how one two three'.split(' '));
const LINKERS = ['however', 'therefore', 'moreover', 'furthermore', 'firstly', 'secondly', 'finally', 'in conclusion', 'as a result', 'for example', 'for instance', 'although', 'because', 'consequently', 'meanwhile', 'on the other hand', 'in addition', 'nevertheless', 'suddenly', 'afterwards', 'later'];
const MISSPELL: Record<string, string> = {
  recieve: 'receive', recieved: 'received', alot: 'a lot', definately: 'definitely', seperate: 'separate', untill: 'until', wich: 'which', becuase: 'because',
  occured: 'occurred', begining: 'beginning', truely: 'truly', tommorow: 'tomorrow', tomorow: 'tomorrow', freind: 'friend', freinds: 'friends', beleive: 'believe',
  goverment: 'government', enviroment: 'environment', wierd: 'weird', thier: 'their', arguement: 'argument', embarass: 'embarrass', neccessary: 'necessary',
  accomodate: 'accommodate', finaly: 'finally', realy: 'really', beautifull: 'beautiful', sucess: 'success', succesful: 'successful', whith: 'with', wen: 'when', becos: 'because',
};
const GRAMMAR: { re: RegExp; fix: (m: string) => string; comment: string }[] = [
  { re: /\b(we|they|you) was\b/gi, fix: (m) => m.replace(/was/i, 'were'), comment: 'Subject–verb agreement: use “were” with plural subjects.' },
  { re: /\b(he|she|it) were\b/gi, fix: (m) => m.replace(/were/i, 'was'), comment: 'Subject–verb agreement: use “was” with a singular subject.' },
  { re: /\b(should|could|would|must) of\b/gi, fix: (m) => m.replace(/of/i, 'have'), comment: '“of” should be “have” after a modal verb.' },
  { re: /\b(\w+) \1\b/gi, fix: (m) => m.split(' ')[0]!, comment: 'Repeated word.' },
  { re: /(?<=^|\s)i\s+[a-z']+/g, fix: (m) => `I${m.slice(1)}`, comment: 'The pronoun “I” is always a capital letter.' },
  { re: /[.!?]\s+(?!i\b)[a-z]\w*/g, fix: (m) => m.replace(/[a-z]/, (c) => c.toUpperCase()), comment: 'Start each new sentence with a capital letter.' },
];

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

type Kind = 'content' | 'organisation' | 'language' | 'accuracy' | 'general';
function kindOf(name: string, desc: string): Kind {
  const s = `${name} ${desc}`.toLowerCase();
  if (/grammar|spelling|punctuation|accuracy|mechanic|conventions/.test(s)) return 'accuracy';
  if (/organi[sz]|structure|paragraph|coheren|sequence|layout|format/.test(s)) return 'organisation';
  if (/language|style|vocab|expression|fluency|tone|register|word choice/.test(s)) return 'language';
  if (/content|knowledge|relevan|idea|argument|analysis|understand|evidence|cause|explain|fact|point|task/.test(s)) return 'content';
  return 'general';
}

interface Metrics {
  words: string[]; wc: number; sentences: string[]; avgLen: number; sdLen: number; diversity: number; paragraphs: number;
  linkers: string[]; errors: Annotation[]; keywordHits: string[]; keywordTotal: number; errorRate: number;
}

function analyse(text: string, rubric: Rubric, qp?: SubmissionInput): Metrics {
  const words = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  const lw = words.map((w) => w.toLowerCase());
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => /[A-Za-z]/.test(s));
  const lens = sentences.map((s) => (s.match(/[A-Za-z]+/g) ?? []).length);
  const avgLen = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sdLen = lens.length ? Math.sqrt(lens.reduce((a, b) => a + (b - avgLen) ** 2, 0) / lens.length) : 0;
  const content = lw.filter((w) => !STOP.has(w) && w.length > 2);
  const diversity = content.length ? new Set(content).size / content.length : 0;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length || 1;
  const lower = text.toLowerCase();
  const linkers = LINKERS.filter((l) => new RegExp(`\\b${l}\\b`).test(lower));
  const errors: Annotation[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z]+/g)) {
    const fix = MISSPELL[m[0].toLowerCase()];
    if (fix && !seen.has(m[0].toLowerCase())) { seen.add(m[0].toLowerCase()); errors.push({ originalText: m[0], correction: fix, type: 'grammar', comment: `Spelling: “${fix}”.` }); }
  }
  for (const g of GRAMMAR) {
    for (const m of text.matchAll(g.re)) {
      const q = m[0].trim();
      if (q.length < 2 || seen.has(q.toLowerCase())) continue;
      if (g.comment === 'Repeated word.' && /^(had had|that that)$/i.test(q)) continue;
      seen.add(q.toLowerCase());
      errors.push({ originalText: q, correction: g.fix(q).trim(), type: 'grammar', comment: g.comment });
      if (errors.length > 14) break;
    }
  }
  const src = [...(rubric.keyPointers ?? []), ...rubric.criteria.map((c) => c.description), qp?.type === 'text' ? qp.content.slice(0, 4000) : ''].join(' ').toLowerCase();
  const kw = [...new Set((src.match(/[a-z][a-z'-]{3,}/g) ?? []).filter((w) => !STOP.has(w) && !/^(marks?|points?|clear|good|use|uses|using|shows?|answer|student|learner|relevant|appropriate|work|well|writing)$/.test(w)))];
  const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, '');
  const textStems = new Set(content.map(stem));
  const keywordHits = kw.filter((k) => textStems.has(stem(k)));
  return { words, wc: words.length, sentences, avgLen, sdLen, diversity, paragraphs, linkers, errors, keywordHits, keywordTotal: kw.length, errorRate: words.length ? errors.length / (words.length / 100) : 0 };
}

function findSpan(text: string, needle: string) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  return i < 0 ? null : text.slice(i, i + needle.length);
}
function phrase(sentence: string, maxWords = 9) {
  const w = sentence.split(/\s+/).slice(0, maxWords).join(' ');
  return w.replace(/[,;:]$/, '');
}

export function simulateGrading(args: GradeArgs): GradingResult {
  const { rubric, submission, questionPaper, level, studentFirstName } = args;
  const total = rubricTotal(rubric);
  const name = studentFirstName || 'You';
  if (submission.type === 'file') {
    return {
      summary: `Quick-marking mode cannot read ${submission.fileName ? `“${submission.fileName}”` : 'uploaded files'} (scans, images or PDFs). Please read the script and enter the marks for each criterion.`,
      thinkingProcess: ['Scanned scripts need full marking — file contents were not analysed.', 'All criteria set to 0 for the teacher to mark manually.'],
      improvementTips: [],
      annotations: [],
      breakdown: rubric.criteria.map((c) => ({ name: c.name, pointsEarned: 0, maxPoints: c.maxPoints, justification: 'Not assessed — scanned scripts need full marking or manual marking.' })),
      totalScore: 0,
      maxTotalScore: total,
      feedback: 'Your teacher will add feedback after reading your work.',
      simulated: true,
    };
  }
  const text = submission.content;
  const M = analyse(text, rubric, questionPaper);
  const h = hash(text);
  const jitter = (i: number) => (((h >> (i * 3)) & 15) - 7.5) / 150; // ±5%
  const young = /ECD|Grade/i.test(level ?? '');
  const target = young ? 120 : /Form [56]/i.test(level ?? '') ? 500 : 350;

  const lengthQ = clamp(M.wc / target, 0, 1.15);
  const kwQ = M.keywordTotal ? clamp((M.keywordHits.length / Math.min(M.keywordTotal, 12)) * 1.1, 0, 1) : 0.6;
  const q: Record<Kind, number> = {
    content: 0.2 + 0.45 * Math.min(1, lengthQ) + 0.35 * kwQ,
    organisation: 0.25 + 0.3 * clamp((M.paragraphs - 1) / 3, 0, 1) + 0.25 * clamp(M.linkers.length / 4, 0, 1) + 0.2 * Math.min(1, lengthQ),
    language: 0.2 + 0.35 * clamp((M.diversity - 0.35) / 0.35, 0, 1) + 0.3 * clamp(M.sdLen / 7, 0, 1) + 0.15 * clamp(M.avgLen / 16, 0, 1),
    accuracy: 0.95 - clamp(M.errorRate * 0.12, 0, 0.75),
    general: 0,
  };
  q.general = (q.content + q.organisation + q.language + q.accuracy) / 4;
  if (M.wc < 25) Object.keys(q).forEach((k) => (q[k as Kind] *= 0.4));

  const breakdown: GradeCriterionResult[] = rubric.criteria.map((c, i) => {
    const k = kindOf(c.name, c.description);
    const quality = clamp(q[k] + jitter(i), 0.05, 0.96);
    const pts = roundHalf(quality * c.maxPoints);
    const j: Record<Kind, string> = {
      content: `${M.wc} words; ${M.keywordHits.length ? `addresses key ideas such as ${M.keywordHits.slice(0, 3).map((k) => `“${k}”`).join(', ')}` : 'few of the expected key ideas are clearly present'}.${lengthQ < 0.6 ? ' The response is short, so ideas are not fully developed.' : ''}`,
      organisation: `${M.paragraphs} paragraph${M.paragraphs === 1 ? '' : 's'}${M.linkers.length ? `; linking words used: ${M.linkers.slice(0, 3).map((l) => `“${l}”`).join(', ')}` : '; few linking words to connect ideas'}.`,
      language: `Vocabulary variety ${Math.round(M.diversity * 100)}%; average sentence ${M.avgLen.toFixed(0)} words${M.sdLen > 5 ? ' with good variety of sentence lengths' : ', mostly similar sentence lengths'}.`,
      accuracy: M.errors.length ? `${M.errors.length} spelling/grammar issue${M.errors.length === 1 ? '' : 's'} noted, e.g. “${M.errors[0]!.originalText}”.` : 'Few or no obvious spelling and grammar errors detected.',
      general: `Overall quality estimated from length, vocabulary, structure and accuracy.`,
    };
    return { name: c.name, pointsEarned: pts, maxPoints: c.maxPoints, justification: `${j[k]} (Estimate — please verify.)` };
  });

  // annotations quoting real substrings
  const annotations: Annotation[] = [];
  const errLower = M.errors.map((e) => e.originalText.toLowerCase());
  const clean = (s: string) => !errLower.some((e) => s.toLowerCase().includes(e));
  const first = M.sentences[0];
  if (first && first.split(/\s+/).length >= 4 && clean(phrase(first, 8))) {
    const p = findSpan(text, phrase(first, 8));
    if (p) annotations.push({ originalText: p, type: 'praise', comment: young ? 'A good start!' : 'Clear opening that introduces your response.' });
  }
  const rich = [...M.sentences].filter((s) => s !== first && clean(phrase(s, 9))).sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)[0];
  if (rich && rich.split(/\s+/).length >= 12) {
    const p = findSpan(text, phrase(rich, 9));
    if (p) annotations.push({ originalText: p, type: 'praise', comment: 'Well-developed sentence with good detail.' });
  }
  for (const l of M.linkers.slice(0, 2)) {
    const p = findSpan(text, l);
    if (p) annotations.push({ originalText: p, type: 'praise', comment: 'Good use of a linking word to connect ideas.' });
  }
  annotations.push(...M.errors.slice(0, 8).filter((e) => findSpan(text, e.originalText)));
  const freq = new Map<string, number>();
  M.words.forEach((w) => { const l = w.toLowerCase(); if (!STOP.has(l) && l.length > 3) freq.set(l, (freq.get(l) ?? 0) + 1); });
  const over = [...freq.entries()].filter(([, n]) => n >= Math.max(4, M.wc / 60)).sort((a, b) => b[1] - a[1])[0];
  if (over) {
    const p = findSpan(text, over[0]);
    if (p) annotations.push({ originalText: p, type: 'warning', comment: `“${over[0]}” is used ${over[1]} times — try a synonym for variety.` });
  }
  const longS = M.sentences.find((s) => s.split(/\s+/).length > 40);
  if (longS) {
    const p = findSpan(text, phrase(longS, 7));
    if (p) annotations.push({ originalText: p, type: 'warning', comment: 'This sentence is very long — split it for clarity.' });
  }

  const totalScore = Math.round(breakdown.reduce((a, b) => a + b.pointsEarned, 0) * 10) / 10;
  const pctScore = total ? (totalScore / total) * 100 : 0;
  const weakest = [...breakdown].sort((a, b) => a.pointsEarned / a.maxPoints - b.pointsEarned / b.maxPoints);
  const tipFor: Record<Kind, string> = {
    content: lengthQ < 0.7 ? 'Develop each idea with more detail, examples and explanation.' : 'Link every point back to the question to stay relevant.',
    organisation: M.paragraphs < 3 ? 'Organise your work into clear paragraphs — one main idea each.' : 'Use linking words (however, therefore, as a result) to connect paragraphs.',
    language: 'Vary your sentence openings and lengths, and choose more precise vocabulary.',
    accuracy: 'Proofread carefully for spelling, capital letters and verb agreement before handing in.',
    general: 'Check your work against the rubric before submitting.',
  };
  const tips = [...new Set(weakest.slice(0, 3).map((b) => tipFor[kindOf(b.name, rubric.criteria.find((c) => c.name === b.name)?.description ?? '')]))];
  const best = weakest[weakest.length - 1];
  const strength = best ? best.name.toLowerCase() : 'your effort';
  const band = pctScore >= 75 ? 'an excellent piece of work' : pctScore >= 60 ? 'a good piece of work' : pctScore >= 45 ? 'a fair attempt' : 'a start we can build on';
  const feedback = young
    ? `Well done, ${name}! Your ${strength} is a strength. Next time, ${tips[0]?.toLowerCase() ?? 'keep practising'}`
    : `${name === 'You' ? 'This is' : `${name}, this is`} ${band}, with particular strength in ${strength}. To improve, ${tips[0] ? tips[0].charAt(0).toLowerCase() + tips[0].slice(1) : 'keep practising'}`;
  return {
    summary: `Quick check: ${M.wc} words, ${M.paragraphs} paragraph(s), ${M.errors.length} accuracy issue(s), ${M.keywordHits.length} rubric keyword match(es). Estimated ${Math.round(pctScore)}%.`,
    thinkingProcess: [
      `Word count ${M.wc} (target ≈ ${target} for ${level ?? 'this level'}).`,
      `Sentences: ${M.sentences.length}, average length ${M.avgLen.toFixed(1)} words, variation σ=${M.sdLen.toFixed(1)}.`,
      `Lexical diversity ${Math.round(M.diversity * 100)}%.`,
      `Rubric keyword overlap: ${M.keywordHits.length}/${Math.min(M.keywordTotal, 12)}${M.keywordHits.length ? ` (${M.keywordHits.slice(0, 5).join(', ')})` : ''}.`,
      `Linking words: ${M.linkers.join(', ') || 'none'}.`,
      'Heuristic estimate only — connect Gemini for real marking.',
    ],
    improvementTips: tips,
    annotations: annotations.slice(0, 14),
    breakdown,
    totalScore,
    maxTotalScore: total,
    feedback: feedback.replace(/\.?$/, '.'),
    fullTranscribedText: text,
    simulated: true,
  };
}
