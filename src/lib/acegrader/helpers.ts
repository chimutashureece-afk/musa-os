// Shared AceGrader helpers (pure functions, no React).
import type { Annotation, Assessment, GradingResult, Mark, Student, Submission, TeacherCorrection } from '../../types';
import type { WriteOp } from '../backend';

export const resultPct = (r?: Pick<GradingResult, 'totalScore' | 'maxTotalScore'> | null) =>
  r && r.maxTotalScore ? (r.totalScore / r.maxTotalScore) * 100 : null;

export const firstSentence = (s: string) => {
  const t = (s || '').trim();
  const m = t.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : t).slice(0, 240);
};

/** sessionStorage key holding the review queue order (for prev/next). */
export const QUEUE_KEY = 'acegrader:queue';

export const TEXT_EXCERPT_CAP = 20_000;
export const MINUTES_PER_SCRIPT = 6;

/** Gradebook score for an assessment, scaled from the AI total, 1 dp. */
export const scaledScore = (r: GradingResult, maxMark: number) =>
  r.maxTotalScore ? Math.round((r.totalScore / r.maxTotalScore) * maxMark * 10) / 10 : 0;

/** Ops that approve a submission and write/update its gradebook mark. */
export function approveOps(sub: Submission, a: Assessment, existing?: Mark): WriteOp[] {
  const mark: Mark = {
    id: `${a.id}_${sub.studentId}`,
    assessmentId: a.id,
    studentId: sub.studentId,
    classId: a.classId,
    subjectId: a.subjectId,
    termId: a.termId,
    score: scaledScore(sub.result, a.maxMark),
    comment: firstSentence(sub.result.feedback),
    source: 'acegrader',
    submissionId: sub.id,
    ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
  };
  return [
    { op: 'update', col: 'submissions', id: sub.id, data: { status: 'approved', assessmentId: a.id } },
    { op: 'set', col: 'marks', id: mark.id, data: mark },
  ];
}

export const ANN_STYLE: Record<Annotation['type'], { label: string; mark: string; dot: string; text: string; ring: string }> = {
  praise: { label: 'Praise', mark: 'bg-brand-200/60 decoration-brand-600 dark:bg-brand-400/20 dark:decoration-brand-400', dot: 'bg-brand-500', text: 'text-brand-700 dark:text-brand-300', ring: 'ring-brand-400' },
  error: { label: 'Error', mark: 'bg-rose-200/60 decoration-rose-600 dark:bg-rose-400/20 dark:decoration-rose-400', dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', ring: 'ring-rose-400' },
  grammar: { label: 'Grammar', mark: 'bg-marigold-200/70 decoration-marigold-600 dark:bg-marigold-400/20 dark:decoration-marigold-400', dot: 'bg-marigold-500', text: 'text-marigold-700 dark:text-marigold-300', ring: 'ring-marigold-400' },
  warning: { label: 'Suggestion', mark: 'bg-sky-200/60 decoration-sky-600 dark:bg-sky-400/20 dark:decoration-sky-400', dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', ring: 'ring-sky-400' },
};

export interface Segment { text: string; ann?: number }

/** Split text into plain / highlighted segments by matching each annotation's originalText (case-insensitive, first free occurrence). */
export function segmentText(text: string, anns: Annotation[]): { segments: Segment[]; placed: Set<number> } {
  const lower = text.toLowerCase();
  const ranges: { s: number; e: number; ann: number }[] = [];
  const placed = new Set<number>();
  anns.forEach((a, i) => {
    const needle = a.originalText.trim().toLowerCase();
    if (!needle) return;
    let from = 0;
    while (from <= lower.length) {
      const s = lower.indexOf(needle, from);
      if (s < 0) break;
      const e = s + needle.length;
      if (!ranges.some((r) => s < r.e && e > r.s)) { ranges.push({ s, e, ann: i }); placed.add(i); break; }
      from = s + 1;
    }
  });
  ranges.sort((a, b) => a.s - b.s);
  const segments: Segment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.s > pos) segments.push({ text: text.slice(pos, r.s) });
    segments.push({ text: text.slice(r.s, r.e), ann: r.ann });
    pos = r.e;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos) });
  return { segments, placed };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Best roster match for a filename (admission no > full name > surname > first name). */
export function matchStudent(fileName: string, roster: Student[], taken: Set<string> = new Set()): Student | undefined {
  const f = norm(fileName.replace(/\.[^.]+$/, ''));
  let best: { s: Student; score: number } | undefined;
  for (const s of roster) {
    const adm = norm(s.admissionNo), ln = norm(s.lastName), fn = norm(s.firstName);
    let score = 0;
    if (adm && f.includes(adm)) score = 100;
    else if (ln.length >= 3 && fn.length >= 2 && f.includes(ln) && f.includes(fn)) score = 60;
    else if (ln.length >= 3 && f.includes(ln)) score = 30;
    else if (fn.length >= 3 && f.includes(fn)) score = 20;
    if (!score) continue;
    if (taken.has(s.id)) score -= 15;
    score += Math.min(ln.length, 10) / 100; // prefer longer (more specific) names
    if (!best || score > best.score) best = { s, score };
  }
  // ambiguous first-name / surname matches: only accept if unique at that level
  if (best && best.score < 60) {
    const lvl = Math.floor(best.score);
    const rivals = roster.filter((s) => s.id !== best!.s.id && (lvl >= 30 ? norm(s.lastName) === norm(best!.s.lastName) : norm(s.firstName) === norm(best!.s.firstName)));
    if (rivals.length && !rivals.every((r) => taken.has(r.id))) return undefined;
  }
  return best?.s;
}

const TIP_STOP = new Set('a an the and or to of in on at for with your you more try use make sure be is are that this each every when it its as by from can will'.split(' '));
/** Normalised key for clustering similar improvement tips. */
export function tipKey(tip: string) {
  const words = tip.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !TIP_STOP.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ''));
  return [...new Set(words)].slice(0, 4).sort().join(' ');
}

/** Corrections for a rubric, newest first. */
export const correctionsFor = (all: TeacherCorrection[], rubricId: string, n = 8) =>
  all.filter((c) => c.rubricId === rubricId).sort((a, b) => b.timestamp - a.timestamp).slice(0, n);

export const cloneResult = (r: GradingResult): GradingResult => JSON.parse(JSON.stringify(r));
