import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {ArrowDown, ArrowUp, Award, CheckCircle2, Eye, FileText, Printer, Save, Send, PenLine, Trophy, Users, ListChecks} from 'lucide-react';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCan, useClassStudents, useMyChildren, useMyClasses } from '../lib/hooks';
import { isStaffRole } from '../lib/permissions';
import { store, useCollection, useIndex } from '../lib/store';
import type { WriteOp } from '../lib/backend';
import { autoHeadComment, autoTeacherComment, computeClassReports, ReportRow } from '../lib/reports';
import {
  avg, cx, DEFAULT_SCALES, download, fmtDate, fullName, gradeColor, gradeFor, pct, round1, scaleKeyForLevel, termById, toCSV,
} from '../lib/utils';
import type { GradeBand, Mark, PublishedReport, ReportRemark, SchoolSettings, Term } from '../types';
import {
  Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, StatCard, TableWrap, Tabs, Textarea, useUI,
} from '../components/ui';

// ============================================================================
// Normalised report-card shape (used for both live rows and published snapshots)
// ============================================================================
export interface CardData {
  studentId: string;
  studentName: string;
  admissionNo: string;
  className: string;
  levelOrder: number;
  termId: string;
  subjects: PublishedReport['subjects'];
  average: number | null;
  position: number | null;
  classSize: number;
  attendance: { present: number; total: number };
  remarks: { classTeacher?: string; head?: string; conduct?: string };
  publishedAt?: number;
}

const CONDUCT = ['Excellent', 'Very good', 'Good', 'Satisfactory', 'Needs improvement'];

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

function scaleFor(levelOrder: number, settings?: SchoolSettings): GradeBand[] {
  const key = scaleKeyForLevel(levelOrder);
  return [...(settings?.scales?.[key] ?? DEFAULT_SCALES[key])].sort((a, b) => b.min - a.min);
}

function nextTermAfter(settings: SchoolSettings | undefined, termId: string): Term | undefined {
  const t = termById(settings, termId);
  if (!settings || !t) return undefined;
  return [...settings.terms].sort((a, b) => a.start.localeCompare(b.start)).find((x) => x.start > t.start);
}

// ============================================================================
// Printable report card (A4, black & white friendly)
// ============================================================================
export function ReportCardDoc({ d, settings }: { d: CardData; settings?: SchoolSettings }) {
  const term = termById(settings, d.termId);
  const next = nextTermAfter(settings, d.termId);
  const scale = scaleFor(d.levelOrder, settings);
  const avgGrade = d.average == null ? null : scale.find((b) => d.average! >= b.min) ?? scale[scale.length - 1];
  const attPct = d.attendance.total ? (d.attendance.present / d.attendance.total) * 100 : null;
  const cell = 'border border-slate-400 px-2 py-1.5';
  return (
    <div className="paper mx-auto w-full max-w-[210mm] bg-white p-8 font-sans text-[12px] leading-snug text-slate-900 print:max-w-none print:p-0 dark:text-white">
      {/* letterhead */}
      <div className="flex items-center gap-4 border-b-[3px] border-double border-slate-800 pb-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-slate-800 font-display tracking-tight text-2xl font-bold">
          {(settings?.name ?? 'S').split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="font-serif text-[26px] font-bold uppercase leading-tight tracking-wide">{settings?.name ?? 'School'}</h1>
          {settings?.motto && <p className="font-display tracking-tight text-[13px] text-slate-700 dark:text-slate-200">“{settings.motto}”</p>}
          <p className="mt-1 text-[11px] text-slate-700 dark:text-slate-200">{[settings?.address, settings?.phone, settings?.email].filter(Boolean).join('  ·  ')}</p>
        </div>
        <div className="w-16 shrink-0" />
      </div>
      <div className="my-3 text-center">
        <h2 className="text-[15px] font-bold uppercase tracking-[0.18em]">Student Progress Report</h2>
        <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">{term?.name ?? d.termId}</p>
      </div>

      {/* student info */}
      <table className="mb-3 w-full border-collapse text-[12px]">
        <tbody>
          <tr>
            <td className={cx(cell, 'w-[16%] font-semibold')}>Name</td>
            <td className={cx(cell, 'w-[34%] font-bold uppercase')}>{d.studentName}</td>
            <td className={cx(cell, 'w-[16%] font-semibold')}>Admission No.</td>
            <td className={cx(cell, 'w-[34%]')}>{d.admissionNo}</td>
          </tr>
          <tr>
            <td className={cx(cell, 'font-semibold')}>Class</td>
            <td className={cell}>{d.className}</td>
            <td className={cx(cell, 'font-semibold')}>Position</td>
            <td className={cx(cell, 'font-bold')}>{d.position ? `${ordinal(d.position)} of ${d.classSize}` : `— of ${d.classSize}`}</td>
          </tr>
          <tr>
            <td className={cx(cell, 'font-semibold')}>Attendance</td>
            <td className={cell}>{d.attendance.total ? `${d.attendance.present} of ${d.attendance.total} days (${pct(attPct)})` : 'Not recorded'}</td>
            <td className={cx(cell, 'font-semibold')}>Average</td>
            <td className={cx(cell, 'font-bold')}>{d.average == null ? '—' : `${d.average.toFixed(1)}%`}{avgGrade ? `  (${avgGrade.grade} — ${avgGrade.remark})` : ''}</td>
          </tr>
        </tbody>
      </table>

      {/* subjects */}
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-slate-100 print:bg-slate-100">
            <th className={cx(cell, 'text-left')}>Subject</th>
            <th className={cx(cell, 'w-14 text-center')}>Mark %</th>
            <th className={cx(cell, 'w-12 text-center')}>Grade</th>
            <th className={cx(cell, 'w-24 text-left')}>Remark</th>
            <th className={cx(cell, 'w-28 text-left')}>Teacher</th>
            <th className={cx(cell, 'text-left')}>Comment</th>
          </tr>
        </thead>
        <tbody>
          {d.subjects.map((s) => (
            <tr key={s.subjectId}>
              <td className={cx(cell, 'font-semibold')}>{s.name}</td>
              <td className={cx(cell, 'text-center tabular-nums')}>{s.mark ?? '—'}</td>
              <td className={cx(cell, 'text-center font-bold')}>{s.grade}</td>
              <td className={cell}>{s.remark}</td>
              <td className={cell}>{s.teacher}</td>
              <td className={cx(cell, 'text-[11px] italic text-slate-700 dark:text-slate-200')}>{s.comment ?? ''}</td>
            </tr>
          ))}
          {!d.subjects.length && <tr><td className={cx(cell, 'text-center italic')} colSpan={6}>No subjects recorded.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50">
            <td className={cx(cell, 'font-bold uppercase')}>Average</td>
            <td className={cx(cell, 'text-center font-bold tabular-nums')}>{d.average == null ? '—' : d.average.toFixed(1)}</td>
            <td className={cx(cell, 'text-center font-bold')}>{avgGrade?.grade ?? '—'}</td>
            <td className={cell} colSpan={3}>{avgGrade?.remark ?? ''}</td>
          </tr>
        </tfoot>
      </table>

      {/* grade key */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-slate-700 dark:text-slate-200">
        <span className="font-bold uppercase tracking-wider">Grade key:</span>
        {scale.map((b, i) => {
          const hi = i === 0 ? 100 : scale[i - 1]!.min - 1;
          return <span key={b.grade}><b>{b.grade}</b> {b.min}–{hi}% {b.remark}</span>;
        })}
      </div>

      {/* remarks */}
      <div className="mt-4 space-y-2.5">
        {([
          ['Conduct', d.remarks.conduct],
          ["Class teacher's comment", d.remarks.classTeacher],
          [`Head's comment`, d.remarks.head],
        ] as const).map(([label, v]) => (
          <div key={label} className="rounded border border-slate-400 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">{label}</p>
            <p className="mt-0.5 min-h-[18px] font-display tracking-tight text-[14px]">{v || ' '}</p>
          </div>
        ))}
      </div>

      {/* signatures */}
      <div className="mt-8 grid grid-cols-3 gap-6 text-[11px]">
        <div><div className="h-8 border-b border-slate-800" /><p className="mt-1 font-semibold">Class teacher</p></div>
        <div><div className="h-8 border-b border-slate-800" /><p className="mt-1 font-semibold">{settings?.headName ?? 'Head'}</p><p className="text-slate-600 dark:text-slate-300">Head</p></div>
        <div><div className="flex h-8 items-end justify-center border-b border-dashed border-slate-500 text-[9px] uppercase tracking-widest text-slate-400">School stamp</div><p className="mt-1 font-semibold">Date</p></div>
      </div>

      <div className="mt-6 flex flex-wrap justify-between gap-2 border-t border-slate-300 pt-2 text-[10.5px] text-slate-600 dark:text-slate-300">
        <span>{next ? <>Next term ({next.name}) opens on <b className="text-slate-900 dark:text-white">{fmtDate(next.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b>.</> : term ? `Term closes ${fmtDate(term.end)}.` : ''}</span>
        <span>{d.publishedAt ? `Issued ${fmtDate(d.publishedAt)}` : `Printed ${fmtDate(Date.now())}`}</span>
      </div>
    </div>
  );
}

/** Preview wrapper showing the paper on screen. */
function CardPreview({ d, settings, onClose, extra }: { d: CardData | null; settings?: SchoolSettings; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <Modal open={!!d} onClose={onClose} size="xl" title={d ? `${d.studentName} — ${termById(settings, d.termId)?.name ?? d.termId}` : ''}
      footer={<>{extra}<Button variant="outline" onClick={onClose}>Close</Button></>}>
      <div className="-mx-5 -my-5 bg-slate-200/70 p-3 sm:p-6 dark:bg-black/40">
        {d && <div className="mx-auto max-w-[210mm] shadow-xl ring-1 ring-black/5"><ReportCardDoc d={d} settings={settings} /></div>}
      </div>
    </Modal>
  );
}

/** Renders cards into the print-only area then triggers the print dialog. */
function usePrintCards() {
  const [cards, setCards] = useState<CardData[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!tick) return;
    const t = setTimeout(() => window.print(), 80);
    return () => clearTimeout(t);
  }, [tick]);
  return {
    print: (c: CardData[]) => { setCards(c); setTick((x) => x + 1); },
    render: (settings?: SchoolSettings) => (
      <div className="print-only">
        {cards?.map((c) => <div key={c.studentId + c.termId} className="print-page"><ReportCardDoc d={c} settings={settings} /></div>)}
      </div>
    ),
  };
}

// ============================================================================
export default function ReportCards() {
  const { profile } = useAuth();
  return isStaffRole(profile?.role) ? <StaffReports /> : <FamilyReports />;
}

// ------------------------------------------------------------ staff view ----
type SortKey = 'pos' | 'name' | 'avg' | 'att' | string;

function StaffReports() {
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();
  const canRemarks = useCan('remarks');
  const canPublish = useCan('reports');

  const classes = useMyClasses();
  const classIdx = useIndex('classes');
  const [classId, setClassId] = useState('');
  const [termId, setTermId] = useState('');
  const [tab, setTab] = useState<'results' | 'remarks'>('results');

  const { data: allStudents } = useCollection('students');
  const studentIdx = useMemo(() => new Map(allStudents.map((s) => [s.id, s])), [allStudents]);

  // query params ?student=&term=
  const pendingOpen = useRef<string | null>(null);
  const handledParams = useRef('');
  useEffect(() => {
    const sid = params.get('student'), tid = params.get('term');
    const sig = `${sid}|${tid}`;
    if (handledParams.current === sig || (sid && !studentIdx.has(sid))) return;
    handledParams.current = sig;
    if (tid) setTermId(tid);
    if (sid) {
      const st = studentIdx.get(sid);
      if (st) { setClassId(st.classId); pendingOpen.current = sid; }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, studentIdx.size]);

  useEffect(() => { if (!termId && settings) setTermId((t) => t || settings.currentTermId); }, [settings, termId]);
  useEffect(() => {
    if (!classId && classes.length) setClassId((c) => c || (classes.find((x) => x.levelOrder >= 2) ?? classes[0]!).id);
  }, [classes, classId]);

  const cls = classIdx.get(classId);
  const students = useClassStudents(classId);
  const { data: allocations } = useCollection('allocations');
  const subjects = useIndex('subjects');
  const staff = useIndex('staff');
  const { data: assessments, loading: la } = useCollection('assessments');
  const { data: marksArr, loading: lm } = useCollection('marks');
  const { data: attendance } = useCollection('attendance');
  const { data: remarksArr } = useCollection('remarks');
  const { data: reports } = useCollection('reports');

  const marks = useMemo(() => new Map<string, Mark>(marksArr.map((m) => [`${m.assessmentId}_${m.studentId}`, m])), [marksArr]);
  const remarks = useMemo(() => new Map<string, ReportRemark>(remarksArr.map((r) => [`${r.studentId}_${r.termId}`, r])), [remarksArr]);

  const rows: ReportRow[] = useMemo(() => {
    if (!cls || !settings || !termId) return [];
    return computeClassReports({ cls, termId, students, allocations, subjects, staff, assessments, marks, attendance, remarks, settings });
  }, [cls, termId, students, allocations, subjects, staff, assessments, marks, attendance, remarks, settings]);

  // ---------------------------------------------------- remark drafts --
  type RemarkDraft = { classTeacher?: string; head?: string; conduct?: string };
  const [drafts, setDrafts] = useState<Record<string, RemarkDraft>>({});
  const [savingRem, setSavingRem] = useState(false);
  useEffect(() => { setDrafts({}); }, [classId, termId]);

  const remarkOf = (r: ReportRow): RemarkDraft => ({ ...r.remarks, ...drafts[r.studentId] });
  const dirtyIds = Object.keys(drafts).filter((sid) => {
    const r = rows.find((x) => x.studentId === sid);
    if (!r) return false;
    const d = drafts[sid]!;
    return (['classTeacher', 'head', 'conduct'] as const).some((k) => d[k] !== undefined && (d[k] ?? '') !== (r.remarks[k] ?? ''));
  });

  const setDraft = (sid: string, k: keyof RemarkDraft, v: string) => setDrafts((d) => ({ ...d, [sid]: { ...d[sid], [k]: v } }));

  const autoFill = () => {
    let n = 0;
    const next = { ...drafts };
    for (const r of rows) {
      const cur = remarkOf(r);
      const add: RemarkDraft = {};
      if (!cur.classTeacher?.trim()) { const c = autoTeacherComment(r.average, r.student.firstName); if (c) add.classTeacher = c; }
      if (!cur.head?.trim()) { const c = autoHeadComment(r.average); if (c) add.head = c; }
      if (Object.keys(add).length) { next[r.studentId] = { ...next[r.studentId], ...add }; n++; }
    }
    setDrafts(next);
    toast(n ? `Filled comments for ${n} student(s). Review, then save.` : 'All comments are already filled.', 'info');
  };

  const remarkOps = (): WriteOp[] => dirtyIds.map((sid) => {
    const id = `${sid}_${termId}`;
    const existing = remarks.get(id);
    const r = rows.find((x) => x.studentId === sid)!;
    const m = remarkOf(r);
    const data: ReportRemark = {
      ...(existing ?? {}), id, studentId: sid, termId,
      classTeacher: m.classTeacher?.trim() || undefined, head: m.head?.trim() || undefined, conduct: m.conduct?.trim() || undefined,
    };
    return { op: 'set', col: 'remarks', id, data };
  });

  const saveRemarks = async () => {
    const ops = remarkOps();
    if (!ops.length) return;
    setSavingRem(true);
    try { await store.commit(ops); setDrafts({}); toast(`Saved remarks for ${ops.length} student(s).`); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setSavingRem(false); }
  };

  // ------------------------------------------------------ card data ---
  const toCard = (r: ReportRow): CardData => ({
    studentId: r.studentId, studentName: fullName(r.student), admissionNo: r.student.admissionNo, className: r.className,
    levelOrder: cls?.levelOrder ?? 9, termId: r.termId, subjects: r.subjects, average: r.average, position: r.position,
    classSize: r.classSize, attendance: r.attendance, remarks: remarkOf(r),
  });

  const printer = usePrintCards();
  const [preview, setPreview] = useState<CardData | null>(null);

  useEffect(() => {
    const sid = pendingOpen.current;
    if (!sid || !rows.length) return;
    const r = rows.find((x) => x.studentId === sid);
    if (r) { setPreview(toCard(r)); pendingOpen.current = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const closePreview = () => {
    setPreview(null);
    if (params.get('student')) { params.delete('student'); setParams(params, { replace: true }); }
  };

  // ------------------------------------------------------- publish -----
  const published = reports.filter((r) => r.classId === classId && r.termId === termId);
  const lastPublished = published.length ? Math.max(...published.map((r) => r.publishedAt)) : null;
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    if (!rows.length) return;
    const missing = rows.filter((r) => !remarkOf(r).classTeacher?.trim()).length;
    const ok = await confirm({
      title: published.length ? 'Re-publish report cards?' : 'Publish report cards?',
      body: `This makes ${rows.length} report card(s) for ${cls?.name} · ${termById(settings, termId)?.name} visible to parents and students${published.length ? ', replacing the previously published versions' : ''}.${missing ? ` ${missing} student(s) have no class teacher comment.` : ''}${dirtyIds.length ? ' Unsaved remarks will be saved first.' : ''}`,
      confirmText: published.length ? 'Re-publish' : 'Publish',
    });
    if (!ok) return;
    setPublishing(true);
    const now = Date.now();
    const ops: WriteOp[] = [...remarkOps(), ...rows.map((r): WriteOp => {
      const { student, ...rest } = r;
      const data: PublishedReport = { ...rest, remarks: remarkOf(r), id: `${r.studentId}_${termId}`, publishedAt: now };
      return { op: 'set', col: 'reports', id: data.id, data };
    })];
    try { await store.commit(ops); setDrafts({}); toast(`Published ${rows.length} report card(s).`); }
    catch (e: any) { toast(e.message, 'error'); }
    finally { setPublishing(false); }
  };

  // ------------------------------------------------------ sorting -------
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pos', dir: 1 });
  const subjectCols = rows[0]?.subjects ?? [];
  const sorted = useMemo(() => {
    const val = (r: ReportRow): number | string | null => {
      switch (sort.key) {
        case 'pos': return r.position;
        case 'name': return `${r.student.lastName} ${r.student.firstName}`;
        case 'avg': return r.average == null ? null : -r.average;
        case 'att': return r.attendance.total ? -(r.attendance.present / r.attendance.total) : null;
        default: { const m = r.subjects.find((s) => s.subjectId === sort.key)?.mark; return m == null ? null : -m; }
      }
    };
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
    });
  }, [rows, sort]);
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  const SortTh = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cx('th cursor-pointer select-none hover:text-slate-800 dark:hover:text-white', className)} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">{children}{sort.key === k && (sort.dir === 1 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}</span>
    </th>
  );

  // ------------------------------------------------------- stats --------
  const classAvg = avg(rows.map((r) => r.average).filter((x): x is number => x != null));
  const best = rows.find((r) => r.position === 1);
  const subjAvgs = subjectCols.map((s) => ({
    name: s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name,
    full: s.name,
    avg: (() => { const v = avg(rows.map((r) => r.subjects.find((x) => x.subjectId === s.subjectId)?.mark).filter((x): x is number => x != null)); return v == null ? 0 : round1(v); })(),
  }));
  const passMark = settings?.passMark ?? 50;
  const passRate = (() => { const a = rows.filter((r) => r.average != null); return a.length ? (a.filter((r) => r.average! >= passMark).length / a.length) * 100 : null; })();

  const exportCSV = () => {
    const cols = ['Position', 'Admission No', 'Student', ...subjectCols.map((s) => s.name), 'Average', 'Attendance'];
    download(`results_${cls?.name}_${termId}.csv`.replace(/\s+/g, '-'), toCSV(rows.map((r) => ({
      Position: r.position ?? '', 'Admission No': r.student.admissionNo, Student: fullName(r.student),
      ...Object.fromEntries(r.subjects.map((s) => [s.name, s.mark ?? ''])),
      Average: r.average ?? '', Attendance: r.attendance.total ? `${r.attendance.present}/${r.attendance.total}` : '',
    })), cols));
  };

  const loading = la || lm;
  const term = termById(settings, termId);

  return (
    <div>
      <div className="no-print">
        <PageHeader eyebrow="Academics" title="Report cards" subtitle="Class results, remarks, printing and publishing to parents."
          actions={<>
            <Button variant="outline" icon={<FileText size={16} />} onClick={exportCSV} disabled={!rows.length}>Export CSV</Button>
            <Button variant="outline" icon={<Printer size={16} />} disabled={!rows.length} onClick={() => printer.print(rows.map(toCard))}>Print report cards</Button>
            {canPublish && <Button icon={<Send size={16} />} loading={publishing} disabled={!rows.length} onClick={publish}>{published.length ? 'Re-publish' : 'Publish'}</Button>}
          </>}
        />

        <div className="card mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <Field label="Class" className="sm:w-56">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Term" className="sm:w-56">
            <Select value={termId} onChange={(e) => setTermId(e.target.value)}>
              {(settings?.terms ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === settings?.currentTermId ? ' (current)' : ''}</option>)}
            </Select>
          </Field>
          <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end sm:pb-2">
            {published.length ? (
              <Badge tone="green"><CheckCircle2 size={12} /> Published {published.length}/{rows.length} · {fmtDate(lastPublished)}</Badge>
            ) : <Badge tone="amber">Not published</Badge>}
          </div>
        </div>

        {!classes.length ? <Card><EmptyState title="No classes available" /></Card> : loading ? <Spinner /> : !rows.length ? (
          <Card><EmptyState title="No students in this class" icon={<Users size={22} />} /></Card>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Class average" value={pct(classAvg, 1)} sub={gradeFor(classAvg, cls, settings)?.remark} icon={<Award size={18} />} />
              <StatCard label="Top student" value={<span className="text-lg">{best ? fullName(best.student) : '—'}</span>} sub={best ? `${pct(best.average, 1)} average` : undefined} icon={<Trophy size={18} />} tone="amber" />
              <StatCard label="Pass rate" value={pct(passRate)} sub={`Average ≥ ${passMark}%`} icon={<CheckCircle2 size={18} />} tone="green" />
              <StatCard label="Class size" value={rows.length} sub={`${subjectCols.length} subjects`} icon={<Users size={18} />} tone="violet" />
            </div>

            <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
              { id: 'results', label: 'Results' },
              { id: 'remarks', label: 'Remarks', count: dirtyIds.length || undefined },
            ]} />

            {tab === 'results' ? (
              <div className="grid gap-5">
                <Card title={`${cls?.name} · ${term?.name ?? termId}`} subtitle="Click a column to sort · click a student to view the report card" bodyClass="p-5 pt-0">
                  <TableWrap>
                    <thead>
                      <tr>
                        <SortTh k="pos" className="w-12">Pos</SortTh>
                        <SortTh k="name">Student</SortTh>
                        {subjectCols.map((s) => <SortTh key={s.subjectId} k={s.subjectId} className="text-center"><span title={s.name}>{subjects.get(s.subjectId)?.code ?? s.name.slice(0, 4)}</span></SortTh>)}
                        <SortTh k="avg" className="text-right">Avg</SortTh>
                        <SortTh k="att" className="text-right">Att.</SortTh>
                        <th className="th" />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r) => (
                        <tr key={r.studentId} className="tr tr-hover cursor-pointer" onClick={() => setPreview(toCard(r))}>
                          <td className="td font-bold tabular-nums text-slate-700 dark:text-slate-200">{r.position ?? '—'}</td>
                          <td className="td">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={fullName(r.student)} size={28} />
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-slate-800 dark:text-slate-100">{r.student.lastName}, {r.student.firstName}</div>
                                <div className="text-[11px] text-slate-400">{r.student.admissionNo}</div>
                              </div>
                            </div>
                          </td>
                          {r.subjects.map((s) => (
                            <td key={s.subjectId} className="td whitespace-nowrap text-center tabular-nums">
                              <span className="text-slate-700 dark:text-slate-200">{s.mark ?? '—'}</span>
                              <span className={cx('ml-1 text-[11px] font-bold', gradeColor(s.grade))}>{s.mark != null ? s.grade : ''}</span>
                            </td>
                          ))}
                          <td className={cx('td text-right font-bold tabular-nums', gradeColor(gradeFor(r.average, cls, settings)?.grade))}>{r.average == null ? '—' : r.average.toFixed(1)}</td>
                          <td className="td text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{r.attendance.total ? pct((r.attendance.present / r.attendance.total) * 100) : '—'}</td>
                          <td className="td text-right"><Eye size={15} className="inline text-slate-400" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                </Card>

                <Card title="Subject averages" subtitle={`${cls?.name} · ${term?.name ?? ''}`}>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={subjAvgs} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
                        <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fill: '#8f9f97', fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: '#8f9f97', fontSize: 11 }} />
                        <Tooltip cursor={{ fill: 'rgba(148,163,184,.12)' }} contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid #dfe5e2' }}
                          labelFormatter={(_l: any, p: any) => p?.[0]?.payload?.full ?? _l} formatter={(v: any) => [`${v}%`, 'Average']} />
                        <Bar dataKey="avg" fill="#16a04c" radius={[4, 4, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>
            ) : (
              <Card title="Remarks" subtitle="Class teacher and head comments, conduct"
                actions={canRemarks ? <>
                  <Button size="sm" variant="outline" icon={<ListChecks size={14} />} onClick={autoFill}>Auto-fill comments</Button>
                  <Button size="sm" variant="secondary" icon={<Save size={14} />} loading={savingRem} disabled={!dirtyIds.length} onClick={saveRemarks}>
                    Save{dirtyIds.length ? ` (${dirtyIds.length})` : ''}
                  </Button>
                </> : undefined}
                bodyClass="divide-y divide-slate-100 p-0 dark:divide-white/[0.05]">
                {rows.map((r) => {
                  const m = remarkOf(r);
                  const changed = dirtyIds.includes(r.studentId);
                  return (
                    <div key={r.studentId} className={cx('grid gap-3 px-5 py-4 lg:grid-cols-[200px_1fr_1fr_170px]', changed && 'bg-slate-100 dark:bg-marigold-500/[0.04]')}>
                      <div className="flex items-start gap-2.5">
                        <Avatar name={fullName(r.student)} size={32} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{fullName(r.student)}</p>
                          <p className="text-xs text-slate-400">Pos {r.position ?? '—'} · {pct(r.average, 1)}</p>
                          <button className="link mt-1 text-xs" onClick={() => setPreview(toCard(r))}>Preview</button>
                        </div>
                      </div>
                      <Field label="Class teacher">
                        <Textarea className="min-h-[64px] text-[13px]" value={m.classTeacher ?? ''} readOnly={!canRemarks}
                          onChange={(e) => setDraft(r.studentId, 'classTeacher', e.target.value)} placeholder="Comment…" />
                      </Field>
                      <Field label="Head">
                        <Textarea className="min-h-[64px] text-[13px]" value={m.head ?? ''} readOnly={!canRemarks}
                          onChange={(e) => setDraft(r.studentId, 'head', e.target.value)} placeholder="Comment…" />
                      </Field>
                      <Field label="Conduct">
                        <Input list="conduct-options" value={m.conduct ?? ''} readOnly={!canRemarks}
                          onChange={(e) => setDraft(r.studentId, 'conduct', e.target.value)} placeholder="e.g. Good" />
                      </Field>
                    </div>
                  );
                })}
                <datalist id="conduct-options">{CONDUCT.map((c) => <option key={c} value={c} />)}</datalist>
              </Card>
            )}
          </>
        )}
      </div>

      <CardPreview d={preview} settings={settings} onClose={closePreview}
        extra={preview && <Button icon={<Printer size={16} />} onClick={() => printer.print([preview])}>Print</Button>} />
      {printer.render(settings)}
    </div>
  );
}

// ---------------------------------------------------- parent/student view --
function FamilyReports() {
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const children = useMyChildren();
  const classIdx = useIndex('classes');
  const { data: reports, loading } = useCollection('reports');
  const printer = usePrintCards();
  const [preview, setPreview] = useState<CardData | null>(null);

  const termOrder = (tid: string) => {
    const t = termById(settings, tid);
    return t ? t.start : tid;
  };

  const toCard = (r: PublishedReport): CardData => {
    const st = children.find((c) => c.id === r.studentId);
    return {
      studentId: r.studentId, studentName: fullName(st), admissionNo: st?.admissionNo ?? '—', className: r.className,
      levelOrder: classIdx.get(r.classId)?.levelOrder ?? 9, termId: r.termId, subjects: r.subjects, average: r.average,
      position: r.position, classSize: r.classSize, attendance: r.attendance, remarks: r.remarks, publishedAt: r.publishedAt,
    };
  };

  const byChild = useMemo(() => children.map((c) => ({
    child: c,
    reports: reports.filter((r) => r.studentId === c.id).sort((a, b) => termOrder(b.termId).localeCompare(termOrder(a.termId))),
  })), [children, reports, settings]);

  useEffect(() => {
    const sid = params.get('student'), tid = params.get('term');
    if (!sid || !reports.length || !children.length) return;
    const r = reports.find((x) => x.studentId === sid && (!tid || x.termId === tid))
      ?? reports.filter((x) => x.studentId === sid).sort((a, b) => termOrder(b.termId).localeCompare(termOrder(a.termId)))[0];
    if (r) setPreview(toCard(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, reports.length, children.length]);

  const close = () => {
    setPreview(null);
    if (params.get('student')) { params.delete('student'); params.delete('term'); setParams(params, { replace: true }); }
  };

  return (
    <div>
      <div className="no-print">
        <PageHeader eyebrow="Academics" title="Report cards" subtitle="Published end-of-term reports." />
        {loading ? <Spinner /> : !children.length ? (
          <Card><EmptyState title="No linked learners" body="Your account is not linked to any student yet. Please contact the school office." /></Card>
        ) : (
          <div className="grid gap-5">
            {byChild.map(({ child, reports: rs }) => (
              <Card key={child.id}
                title={<span className="flex items-center gap-2.5"><Avatar name={fullName(child)} size={30} />{fullName(child)}</span>}
                subtitle={`${classIdx.get(child.classId)?.name ?? ''} · ${child.admissionNo}`}>
                {!rs.length ? (
                  <EmptyState title="No published reports yet" body="Report cards appear here once the school publishes them at the end of term." icon={<FileText size={22} />} />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {rs.map((r) => {
                      const g = gradeFor(r.average, classIdx.get(r.classId), settings);
                      return (
                        <button key={r.id} onClick={() => setPreview(toCard(r))}
                          className="group rounded-2xl border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-white/10 dark:hover:border-brand-500/40">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{r.className}</p>
                              <p className="mt-0.5 font-display tracking-tight text-xl font-bold text-slate-900 dark:text-white">{termById(settings, r.termId)?.name ?? r.termId}</p>
                            </div>
                            <span className={cx('text-2xl font-bold', gradeColor(g?.grade))}>{g?.grade ?? '—'}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
                            <span>Average <b>{pct(r.average, 1)}</b></span>
                            <span>Position <b>{r.position ?? '—'}</b> of {r.classSize}</span>
                          </div>
                          <p className="mt-2 flex items-center gap-1 text-xs text-slate-400"><PenLine size={12} /> Published {fmtDate(r.publishedAt)}
                            <span className="ml-auto font-semibold text-brand-600 opacity-0 transition group-hover:opacity-100 dark:text-brand-400">View →</span></p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
      <CardPreview d={preview} settings={settings} onClose={close}
        extra={preview && <Button icon={<Printer size={16} />} onClick={() => printer.print([preview])}>Print</Button>} />
      {printer.render(settings)}
    </div>
  );
}
