// Turn a photo of a class list / enrolment form, a spreadsheet, or pasted text into rows.
// Photos: Gemini reads handwriting and printed lists when a key is set; otherwise
// Tesseract (in the browser) reads printed text and we pick the names out line by line.
import { Type } from '@google/genai';
import { aiAvailable, callJSON } from './acegrader/engine';

export type ImportKind = 'students' | 'staff';
export type Row = Record<string, string | undefined>;

export const FIELDS: Record<ImportKind, { key: string; label: string; synonyms: string[] }[]> = {
  students: [
    { key: 'firstName', label: 'First name', synonyms: ['first name', 'firstname', 'forename', 'forenames', 'given name', 'name'] },
    { key: 'lastName', label: 'Surname', synonyms: ['surname', 'last name', 'lastname', 'family name'] },
    { key: 'gender', label: 'Gender', synonyms: ['gender', 'sex', 'm/f', 'b/g'] },
    { key: 'dob', label: 'Date of birth', synonyms: ['dob', 'date of birth', 'birth date', 'birthdate', 'd.o.b', 'born'] },
    { key: 'className', label: 'Class', synonyms: ['class', 'form', 'grade', 'stream', 'class name'] },
    { key: 'guardianName', label: 'Parent / guardian', synonyms: ['guardian', 'guardian name', 'parent', 'parent name', 'mother', 'father', 'next of kin'] },
    { key: 'guardianPhone', label: 'Phone', synonyms: ['phone', 'cell', 'mobile', 'contact', 'guardian phone', 'parent phone', 'phone number', 'whatsapp'] },
  ],
  staff: [
    { key: 'title', label: 'Title', synonyms: ['title', 'mr/mrs'] },
    { key: 'firstName', label: 'First name', synonyms: ['first name', 'firstname', 'forename', 'name'] },
    { key: 'lastName', label: 'Surname', synonyms: ['surname', 'last name', 'lastname'] },
    { key: 'gender', label: 'Gender', synonyms: ['gender', 'sex'] },
    { key: 'position', label: 'Position', synonyms: ['position', 'post', 'role', 'job', 'designation'] },
    { key: 'department', label: 'Department', synonyms: ['department', 'dept', 'subject', 'section'] },
    { key: 'phone', label: 'Phone', synonyms: ['phone', 'cell', 'mobile', 'contact'] },
    { key: 'email', label: 'Email', synonyms: ['email', 'e-mail', 'email address'] },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z/.]+/g, ' ').trim();

// ------------------------------------------------------------ spreadsheets --
/** Read CSV / Excel into rows keyed by our field names (headers are matched loosely). */
export async function readSpreadsheet(file: File, kind: ImportKind): Promise<Row[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const grid = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', blankrows: false });
  if (!grid.length) return [];
  // the header is the first row that names at least two of our fields
  const fields = FIELDS[kind];
  const score = (r: any[]) => r.filter((c) => fields.some((f) => f.synonyms.includes(norm(String(c ?? ''))))).length;
  let h = grid.findIndex((r) => score(r) >= 2);
  if (h < 0) h = 0;
  const header = (grid[h] ?? []).map((c) => norm(String(c ?? '')));
  const map = header.map((hd) => {
    if (/full ?name|learner|student|pupil|names?$/.test(hd) && !header.some((x) => x === 'surname' || x === 'last name')) return '__full';
    return fields.find((f) => f.synonyms.includes(hd))?.key
      ?? fields.find((f) => f.key !== 'firstName' && f.synonyms.some((sy) => sy.length >= 3 && hd.includes(sy)))?.key
      ?? null;
  });
  // never map two columns to the same field — keep the first
  const seen = new Set<string>();
  map.forEach((k, i) => { if (k && k !== '__full') { if (seen.has(k)) map[i] = null; else seen.add(k); } });
  const out: Row[] = [];
  for (const r of grid.slice(h + 1)) {
    const row: Row = {};
    map.forEach((k, i) => {
      const v = String(r[i] ?? '').trim();
      if (!k || !v) return;
      if (k === '__full') Object.assign(row, splitName(v));
      else row[k] = v;
    });
    if (row.firstName || row.lastName) out.push(row);
  }
  return out;
}

// ---------------------------------------------------------------- names ----
const HONORIFIC = /^(mr|mrs|ms|miss|dr|sir|madam)\.?$/i;
/** "MOYO Tatenda", "Moyo, Tatenda", "Tatenda Moyo" → first + surname. */
export function splitName(full: string): Row {
  const clean = full.replace(/\s+/g, ' ').trim();
  if (clean.includes(',')) { const [a, b] = clean.split(',', 2); return { lastName: tidy(a!), firstName: tidy(b!) }; }
  const w = clean.split(' ').filter(Boolean);
  const title = w[0] && HONORIFIC.test(w[0]) ? w.shift()! : '';
  if (w.length === 1) return { firstName: tidy(w[0]!), lastName: '', ...(title ? { title: cap(title) } : {}) };
  const upperFirst = w[0]!.length > 1 && w[0] === w[0]!.toUpperCase() && w.slice(1).some((x) => x !== x.toUpperCase());
  const r = upperFirst ? { lastName: tidy(w[0]!), firstName: tidy(w.slice(1).join(' ')) } : { firstName: tidy(w.slice(0, -1).join(' ')), lastName: tidy(w[w.length - 1]!) };
  return title ? { ...r, title: cap(title) } : r;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const tidy = (s: string) => s.trim().split(/([\s-])/).map((p) => (/[\s-]/.test(p) ? p : cap(p))).join('');

// ------------------------------------------------------------ plain lines --
const HEADER_WORDS = /^(no\.?|#|name|names|surname|first ?name|class|list|form|grade|sex|gender|register|dob|date|phone|total|learners?|pupils?|students?|staff|term|year)$/i;
/** One learner or staff member per line: numbering, gender, dates and phone numbers are picked out. */
export function parseLines(text: string, kind: ImportKind): Row[] {
  const out: Row[] = [];
  let pageClass = ''; // "FORM 1A CLASS LIST" at the top applies to everyone below it
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/[|_*•·]+/g, ' ').replace(/^\s*\(?\d{1,3}[.)\]:-]?\s+/, '').trim(); // "12." "3)" numbering
    if (!line) continue;
    const row: Row = {};
    const phone = line.match(/(\+?263|0)\s?7\d[\d\s-]{6,10}\d/);
    if (phone) { row[kind === 'students' ? 'guardianPhone' : 'phone'] = phone[0].replace(/[\s-]/g, ''); line = line.replace(phone[0], ' '); }
    const email = line.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (email && kind === 'staff') { row.email = email[0]; line = line.replace(email[0], ' '); }
    const date = line.match(/\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
    if (date && kind === 'students') { row.dob = date[0]; line = line.replace(date[0], ' '); }
    const g = line.match(/(?:^|[\s,;])(m|f|male|female|boy|girl)(?=$|[\s,;])/i);
    if (g) { row.gender = /^(m|male|boy)$/i.test(g[1]!) ? 'M' : 'F'; line = line.replace(g[0], ' '); }
    const cls = line.match(/\b(ecd\s?[ab]|grade\s?\d\s?[a-z]?|form\s?\d\s?[a-z]?)\b/i);
    if (cls && kind === 'students') { row.className = cls[0].replace(/\s+/g, ' '); line = line.replace(cls[0], ' '); }
    const parts = line.split(/\t|\s{2,}|;/).map((p) => p.trim()).filter(Boolean);
    let namePart = parts[0] ?? '';
    // "Mr Brian Sibanda, Teacher" → name + extra; "Ncube, Rutendo" stays one name (surname first)
    const comma = namePart.indexOf(',');
    if (comma > 0 && namePart.slice(0, comma).trim().split(/\s+/).length >= 2) { parts.splice(1, 0, namePart.slice(comma + 1).trim()); namePart = namePart.slice(0, comma); }
    const words = namePart.replace(/,/g, ' , ').split(/\s+/).filter((w) => w === ',' || /^[A-Za-z'’.-]{2,}$/.test(w));
    const nameWords = words.filter((w) => w !== ',' && !HONORIFIC.test(w));
    if (nameWords.length < 2 || nameWords.some((w) => HEADER_WORDS.test(w))) { if (row.className && !out.length) pageClass = row.className; continue; }
    Object.assign(row, splitName(words.join(' ').replace(/\s+,\s+/, ', ')));
    if (kind === 'staff' && parts[1]) row.position = parts[1];
    if (kind === 'students' && parts[1] && !row.guardianName && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(parts[1])) row.guardianName = parts[1];
    out.push(row);
  }
  if (pageClass && kind === 'students') out.forEach((r) => { r.className ??= pageClass; });
  return out;
}

// ---------------------------------------------------------------- photos ---
const b64 = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(f); });

/** Shrink big phone photos before sending/reading them (faster, and OCR likes ~2000px). */
async function shrink(file: File, max = 2200): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  if (k === 1) return file;
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), 'image/jpeg', 0.9));
}

export const photoEngine: 'ai' | 'ocr' = aiAvailable ? 'ai' : 'ocr';

export async function readPhoto(file: File, kind: ImportKind, onProgress?: (pct: number, label: string) => void): Promise<Row[]> {
  const blob = await shrink(file);
  if (aiAvailable) {
    onProgress?.(15, 'Reading the page…');
    const fields = FIELDS[kind];
    const schema = {
      type: Type.OBJECT,
      properties: {
        rows: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: Object.fromEntries(fields.map((f) => [f.key, { type: Type.STRING }])) },
        },
      },
      required: ['rows'],
    };
    const mime = file.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg';
    const data = await b64(blob);
    const sys = `You transcribe Zimbabwean school ${kind === 'students' ? 'class lists, registers and enrolment forms' : 'staff lists'} into rows. `
      + 'Read handwriting carefully. One row per person. Split names into first name and surname (Zimbabwean registers often write SURNAME first in capitals). '
      + 'Gender as M or F only if shown. Dates as YYYY-MM-DD. Leave a field empty when it is not on the page — never guess.';
    const res = await callJSON([{ text: `Extract every ${kind === 'students' ? 'learner' : 'staff member'} on this page. Fields: ${fields.map((f) => `${f.key} (${f.label})`).join(', ')}.` }, { inlineData: { mimeType: mime, data } }], sys, schema);
    onProgress?.(100, 'Done');
    return ((res?.rows ?? []) as Row[]).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()]))).filter((r) => r.firstName || r.lastName);
  }
  if (file.type === 'application/pdf') throw new Error('Reading PDFs needs the AI reader. Take a photo or screenshot of the page instead.');
  onProgress?.(5, 'Loading the text reader…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    // served from our own site (see scripts/copy-ocr.mjs) so it works without a CDN
    workerPath: '/tesseract/worker.min.js', corePath: '/tesseract/', langPath: '/tesseract/lang', gzip: true,
    logger: (m: any) => { if (m.status === 'recognizing text') onProgress?.(10 + Math.round(m.progress * 85), 'Reading the page…'); },
  });
  try {
    const { data } = await worker.recognize(blob);
    onProgress?.(100, 'Done');
    return parseLines(data.text, kind);
  } finally {
    await worker.terminate();
  }
}
