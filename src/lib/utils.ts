import { GradeBand, SchoolClass, SchoolSettings, ScaleKey, Student, Staff, Assessment, Mark, Term } from '../types';

// ------------------------------------------------------------- formatting --
export const fullName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : '—');
export const staffName = (s?: Staff | null) => (s ? `${s.title} ${s.lastName}` : '—');
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export const money = (n: number | null | undefined, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n ?? 0);

export const pct = (n: number | null | undefined, digits = 0) => (n == null || Number.isNaN(n) ? '—' : `${n.toFixed(digits)}%`);

export const round1 = (n: number) => Math.round(n * 10) / 10;

// ------------------------------------------------------------------ dates --
export const todayISO = () => toISO(new Date());
export const toISO = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const parseISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};
export const fmtDate = (s?: string | number | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (s == null || s === '') return '—';
  const d = typeof s === 'number' ? new Date(s) : parseISO(s);
  return d.toLocaleDateString('en-GB', opts);
};
export const addDays = (iso: string, n: number) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
export const isWeekend = (iso: string) => {
  const g = parseISO(iso).getDay();
  return g === 0 || g === 6;
};
export const schoolDaysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d)) out.push(d);
  return out;
};
export const ageFrom = (dob: string) => {
  const b = parseISO(dob), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
};
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// ---------------------------------------------------------------- grading --
export const LEVELS: { level: string; order: number; section: 'primary' | 'secondary' }[] = [
  { level: 'ECD A', order: 0, section: 'primary' },
  { level: 'ECD B', order: 1, section: 'primary' },
  ...[1, 2, 3, 4, 5, 6, 7].map((g) => ({ level: `Grade ${g}`, order: g + 1, section: 'primary' as const })),
  ...[1, 2, 3, 4, 5, 6].map((f) => ({ level: `Form ${f}`, order: f + 8, section: 'secondary' as const })),
];

/** The levels this school offers, from its primary/secondary setting. */
export const levelsFor = (settings?: { schoolType?: 'primary' | 'secondary' }) =>
  settings?.schoolType ? LEVELS.filter((l) => l.section === settings.schoolType) : LEVELS;

export const scaleKeyForLevel = (levelOrder: number): ScaleKey => (levelOrder >= 13 ? 'alevel' : levelOrder >= 9 ? 'olevel' : 'primary');

export const DEFAULT_SCALES: Record<ScaleKey, GradeBand[]> = {
  primary: [
    { grade: 'A', min: 80, remark: 'Excellent' },
    { grade: 'B', min: 70, remark: 'Very good' },
    { grade: 'C', min: 60, remark: 'Good' },
    { grade: 'D', min: 50, remark: 'Satisfactory' },
    { grade: 'E', min: 40, remark: 'Needs support' },
    { grade: 'U', min: 0, remark: 'Unsatisfactory' },
  ],
  olevel: [
    { grade: 'A', min: 75, remark: 'Distinction', points: 1 },
    { grade: 'B', min: 65, remark: 'Merit', points: 2 },
    { grade: 'C', min: 50, remark: 'Credit', points: 3 },
    { grade: 'D', min: 40, remark: 'Satisfactory', points: 4 },
    { grade: 'E', min: 30, remark: 'Weak', points: 5 },
    { grade: 'U', min: 0, remark: 'Ungraded', points: 9 },
  ],
  alevel: [
    { grade: 'A', min: 75, remark: 'Excellent', points: 5 },
    { grade: 'B', min: 65, remark: 'Very good', points: 4 },
    { grade: 'C', min: 55, remark: 'Good', points: 3 },
    { grade: 'D', min: 45, remark: 'Satisfactory', points: 2 },
    { grade: 'E', min: 40, remark: 'Pass', points: 1 },
    { grade: 'O', min: 35, remark: 'Subsidiary pass', points: 0 },
    { grade: 'F', min: 0, remark: 'Fail', points: 0 },
  ],
};

export function gradeFor(percent: number | null | undefined, cls: SchoolClass | undefined, settings: SchoolSettings | undefined): GradeBand | null {
  if (percent == null || Number.isNaN(percent)) return null;
  const key = scaleKeyForLevel(cls?.levelOrder ?? 9);
  const bands = [...(settings?.scales?.[key] ?? DEFAULT_SCALES[key])].sort((a, b) => b.min - a.min);
  return bands.find((b) => percent >= b.min) ?? bands[bands.length - 1] ?? null;
}

export const gradeColor = (g?: string | null) => {
  switch (g) {
    case 'A': return 'text-brand-700 dark:text-brand-300';
    case 'B': return 'text-sky-700 dark:text-sky-300';
    case 'C': return 'text-slate-700 dark:text-slate-200';
    case 'D': return 'text-marigold-600 dark:text-marigold-300';
    case 'E': case 'O': return 'text-marigold-800 dark:text-marigold-400';
    default: return 'text-rose-600 dark:text-rose-400';
  }
};

/**
 * Weighted term percentage for one student in one subject from the term's assessments.
 * Missing marks are skipped (weight re-normalised). Returns null if nothing recorded.
 */
export function termPercent(assessments: Assessment[], marksByKey: Map<string, Mark>, studentId: string): number | null {
  let wsum = 0, acc = 0;
  for (const a of assessments) {
    const m = marksByKey.get(`${a.id}_${studentId}`);
    if (m?.score == null || !a.maxMark) continue;
    const w = a.weight || 1;
    acc += (m.score / a.maxMark) * 100 * w;
    wsum += w;
  }
  return wsum ? acc / wsum : null;
}

/** Standard competition ranking (1,2,2,4). */
export function rank<T>(items: T[], score: (t: T) => number | null): Map<T, number> {
  const scored = items.map((t) => ({ t, s: score(t) })).filter((x) => x.s != null) as { t: T; s: number }[];
  scored.sort((a, b) => b.s - a.s);
  const out = new Map<T, number>();
  scored.forEach((x, i) => out.set(x.t, i > 0 && scored[i - 1]!.s === x.s ? out.get(scored[i - 1]!.t)! : i + 1));
  return out;
}

export const currentTerm = (s?: SchoolSettings): Term | undefined => s?.terms.find((t) => t.id === s.currentTermId) ?? s?.terms[s.terms.length - 1];
export const termById = (s: SchoolSettings | undefined, id: string) => s?.terms.find((t) => t.id === id);

export const studentMatches = (s: Student, q: string) => {
  if (!q) return true;
  const t = q.toLowerCase();
  return `${s.firstName} ${s.lastName} ${s.admissionNo}`.toLowerCase().includes(t);
};

// -------------------------------------------------------------------- csv --
export function toCSV(rows: Record<string, any>[], columns?: string[]): string {
  if (!rows.length) return '';
  const cols = columns ?? Object.keys(rows[0]!);
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export function download(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

export const classSort = (a: SchoolClass, b: SchoolClass) => a.levelOrder - b.levelOrder || a.name.localeCompare(b.name);

export const pad = (n: number, w = 4) => String(n).padStart(w, '0');

/** Next sequential number for a prefix, e.g. RCT-2026-0042 */
export function nextNumber(existing: string[], prefix: string): string {
  let max = 0;
  for (const e of existing) if (e.startsWith(prefix)) max = Math.max(max, parseInt(e.slice(prefix.length), 10) || 0);
  return `${prefix}${pad(max + 1)}`;
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
