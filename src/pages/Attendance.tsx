import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts';
import {AlertTriangle, CalendarCheck, Check, CheckCheck, ClipboardList, Download, Save, Users, X} from 'lucide-react';
import { AttendanceMark, AttendanceRegister, SchoolClass, Student } from '../types';
import { useAuth, useSettings } from '../context/AuthContext';
import { store, useCollection, useIndex } from '../lib/store';
import { useCan, useClassStudents, useClasses, useMyClasses } from '../lib/hooks';
import {
  addDays, currentTerm, cx, download, fmtDate, fullName, isWeekend, pct, staffName, studentMatches, toCSV, todayISO,
} from '../lib/utils';
import {
  Badge, Button, Card, EmptyState, Field, Input, PageHeader, Progress, SearchInput, Select, Spinner, StatCard, TableWrap, Tabs, useUI,
} from '../components/ui';

// ------------------------------------------------------------------ marks --
const MARKS: { id: AttendanceMark; label: string; long: string; on: string; off: string }[] = [
  { id: 'P', label: 'P', long: 'Present', on: 'bg-brand-600 text-white border-brand-600 shadow-sm shadow-brand-600/30', off: 'hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-400' },
  { id: 'A', label: 'A', long: 'Absent', on: 'bg-rose-600 text-white border-rose-600 shadow-sm shadow-rose-600/30', off: 'hover:border-rose-400 hover:text-rose-700 dark:hover:text-rose-400' },
  { id: 'L', label: 'L', long: 'Late', on: 'bg-marigold-500 text-white border-marigold-500 shadow-sm shadow-marigold-500/30', off: 'hover:border-marigold-400 hover:text-marigold-700 dark:hover:text-marigold-400' },
  { id: 'E', label: 'E', long: 'Excused', on: 'bg-sky-600 text-white border-sky-600 shadow-sm shadow-sky-600/30', off: 'hover:border-sky-400 hover:text-sky-700 dark:hover:text-sky-400' },
];

const CHRONIC = 85;

const lastSchoolDays = (from: string, n: number) => {
  const out: string[] = [];
  let d = from;
  let guard = 0;
  while (out.length < n && guard++ < 40) {
    if (!isWeekend(d)) out.push(d);
    d = addDays(d, -1);
  }
  return out.reverse();
};

const countMarks = (records: Record<string, AttendanceMark>) => {
  const c = { P: 0, A: 0, L: 0, E: 0 };
  Object.values(records).forEach((m) => { if (m in c) c[m]++; });
  return c;
};

type TabId = 'register' | 'reports' | 'today';

// ================================================================== page ===
export default function Attendance() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [tab, setTab] = useState<TabId>('register');
  const [jump, setJump] = useState<{ classId: string; date: string } | null>(null);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'register', label: 'Take register' },
    { id: 'reports', label: 'Reports' },
    ...(isAdmin ? [{ id: 'today' as TabId, label: 'Today overview' }] : []),
  ];

  return (
    <div>
      <PageHeader eyebrow="Daily registers" title="Attendance" subtitle="Mark class registers, track trends and spot chronic absence early." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5" />
      {tab === 'register' && <RegisterTab jump={jump} />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'today' && isAdmin && <TodayTab onOpen={(classId) => { setJump({ classId, date: todayISO() }); setTab('register'); }} />}
    </div>
  );
}

// ============================================================ register tab ==
function RegisterTab({ jump }: { jump: { classId: string; date: string } | null }) {
  const { profile } = useAuth();
  const { toast, confirm } = useUI();
  const can = useCan('attendance');
  const myClasses = useMyClasses();
  const allClasses = useClasses();
  const classes = profile?.role === 'admin' ? allClasses : myClasses;
  const staff = useIndex('staff');
  const { data: registers, loading } = useCollection('attendance');
  const regIndex = useMemo(() => new Map(registers.map((r) => [r.id, r])), [registers]);

  const [classId, setClassId] = useState(jump?.classId ?? '');
  const [date, setDate] = useState(jump?.date ?? todayISO());
  const [records, setRecords] = useState<Record<string, AttendanceMark>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState('');
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // default class: class teacher's own class, else first
  useEffect(() => {
    if (classId && classes.some((c) => c.id === classId)) return;
    if (!classes.length) return;
    const own = classes.find((c) => c.classTeacherId && c.classTeacherId === profile?.staffId);
    setClassId((own ?? classes[0]!).id);
  }, [classes, classId, profile?.staffId]);

  useEffect(() => { if (jump) { setClassId(jump.classId); setDate(jump.date); } }, [jump]);

  const students = useClassStudents(classId);
  const regId = `${classId}_${date}`;
  const existing = regIndex.get(regId);

  // load existing register when class/date changes (or when it arrives from the store)
  useEffect(() => {
    setRecords(existing ? { ...existing.records } : {});
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regId, existing?.updatedAt]);

  const counts = useMemo(() => {
    const c = { P: 0, A: 0, L: 0, E: 0 };
    students.forEach((s) => { const m = records[s.id]; if (m) c[m]++; });
    return c;
  }, [records, students]);
  const marked = counts.P + counts.A + counts.L + counts.E;
  const unmarked = students.length - marked;

  const setMark = (id: string, m: AttendanceMark) => {
    if (!can) return;
    setRecords((r) => ({ ...r, [id]: m }));
    setDirty(true);
  };
  const markAllPresent = () => {
    if (!can) return;
    setRecords((r) => {
      const next = { ...r };
      students.forEach((s) => { if (!next[s.id]) next[s.id] = 'P'; });
      return next;
    });
    setDirty(true);
  };
  const resetAll = () => {
    setRecords(Object.fromEntries(students.map((s) => [s.id, 'P' as AttendanceMark])));
    setDirty(true);
  };

  const save = async () => {
    if (!classId || !can) return;
    if (unmarked > 0) {
      const ok = await confirm({ title: 'Some learners are unmarked', body: `${unmarked} learner(s) have no mark. Save anyway? Unmarked learners will not count as recorded.`, confirmText: 'Save anyway' });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const clean: Record<string, AttendanceMark> = {};
      students.forEach((s) => { const m = records[s.id]; if (m) clean[s.id] = m; });
      // keep marks of students no longer in the class (historical)
      if (existing) Object.entries(existing.records).forEach(([k, v]) => { if (!(k in clean) && !students.some((s) => s.id === k)) clean[k] = v; });
      const doc: AttendanceRegister = { id: regId, classId, date, records: clean, takenBy: profile?.staffId ?? profile?.id };
      if (existing?.createdAt) doc.createdAt = existing.createdAt;
      await store.set('attendance', doc);
      setDirty(false);
      toast(`Register saved — ${counts.P + counts.L} of ${students.length} present`);
    } catch (e: any) {
      toast(e.message ?? 'Could not save register', 'error');
    } finally { setSaving(false); }
  };

  // keyboard: P/A/L/E (or 1-4) mark and move to next row, arrows move
  const onRowKey = (e: React.KeyboardEvent, idx: number, sid: string) => {
    const k = e.key.toUpperCase();
    const map: Record<string, AttendanceMark> = { P: 'P', A: 'A', L: 'L', E: 'E', '1': 'P', '2': 'A', '3': 'L', '4': 'E' };
    const focus = (i: number) => rowRefs.current[Math.max(0, Math.min(visible.length - 1, i))]?.focus();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (map[k]) { e.preventDefault(); setMark(sid, map[k]!); focus(idx + 1); }
    else if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); focus(idx + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); focus(idx - 1); }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) save(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const strip = useMemo(() => lastSchoolDays(todayISO(), 10), []);
  const visible = students.filter((s) => studentMatches(s, q));
  const cls = classes.find((c) => c.id === classId);
  const weekend = isWeekend(date);
  const future = date > todayISO();

  if (loading && !registers.length) return <Spinner />;
  if (!classes.length) return <Card><EmptyState title="No classes yet" body="Create classes first, then come back to take registers." /></Card>;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5 min-w-0">
        <Card bodyClass="p-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Field label="Class">
              <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.classTeacherId === profile?.staffId ? ' (my class)' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </Field>
          </div>
          {(weekend || future) && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">
              <AlertTriangle size={14} /> {future ? 'This date is in the future.' : `${fmtDate(date, { weekday: 'long' })} is a weekend — registers are normally only taken on school days.`}
            </div>
          )}
          <div className="mt-4">
            <p className="label">Last 10 school days</p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {strip.map((d) => {
                const has = regIndex.has(`${classId}_${d}`);
                const sel = d === date;
                return (
                  <button key={d} onClick={() => setDate(d)} title={`${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}${has ? ' — register taken' : ' — no register'}`}
                    className={cx('flex min-w-[52px] flex-col items-center rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition',
                      sel ? 'border-slate-900 bg-brand-800 text-white dark:border-white dark:bg-brand-600 dark:text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5')}>
                    <span className="opacity-70">{fmtDate(d, { weekday: 'short' })}</span>
                    <span>{fmtDate(d, { day: 'numeric', month: 'short' })}</span>
                    <span className={cx('mt-0.5 flex h-4 w-4 items-center justify-center rounded-full', has ? 'bg-brand-500 text-white' : sel ? 'bg-white/20' : 'bg-slate-100 text-slate-400 dark:bg-white/10')}>
                      {has ? <Check size={11} strokeWidth={3} /> : <X size={10} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        <Card
          title={<span className="flex items-center gap-2">{cls?.name ?? 'Register'} <span className="font-normal text-slate-400">· {fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span></span>}
          subtitle={existing
            ? <>Saved {existing.updatedAt ? new Date(existing.updatedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''} by {staffName(staff.get(existing.takenBy ?? '')) !== '—' ? staffName(staff.get(existing.takenBy ?? '')) : 'staff'}{dirty && <span className="ml-1 font-semibold text-marigold-600 dark:text-marigold-400">· unsaved changes</span>}</>
            : <>Not yet taken{dirty && <span className="ml-1 font-semibold text-marigold-600 dark:text-marigold-400">· unsaved changes</span>}</>}
          actions={can && students.length > 0 && (
            <>
              <Button variant="outline" size="sm" icon={<CheckCheck size={14} />} onClick={markAllPresent}>Mark all present</Button>
              {marked > 0 && <Button variant="ghost" size="sm" onClick={resetAll}>Reset to present</Button>}
            </>
          )}
          bodyClass="p-0"
        >
          {students.length === 0 ? (
            <EmptyState title="No active learners in this class" icon={<Users size={22} />} />
          ) : (
            <>
              <div className="border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
                <SearchInput value={q} onChange={setQ} placeholder="Filter learners…" />
                <p className="mt-2 hidden text-[11px] text-slate-400 sm:block">Tip: focus a row and press <kbd className="rounded bg-slate-100 px-1 dark:bg-white/10">P</kbd> <kbd className="rounded bg-slate-100 px-1 dark:bg-white/10">A</kbd> <kbd className="rounded bg-slate-100 px-1 dark:bg-white/10">L</kbd> <kbd className="rounded bg-slate-100 px-1 dark:bg-white/10">E</kbd> to mark and jump to the next learner; ↑/↓ to move; Ctrl+S to save.</p>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {visible.map((s, i) => {
                  const m = records[s.id];
                  return (
                    <div key={s.id} ref={(el) => { rowRefs.current[i] = el; }} tabIndex={0} onKeyDown={(e) => onRowKey(e, i, s.id)}
                      className={cx('flex flex-wrap items-center gap-3 px-4 py-2.5 outline-none transition focus:bg-brand-50/60 dark:focus:bg-brand-500/10',
                        m === 'A' && 'bg-slate-100 dark:bg-rose-500/[0.04]')}>
                      <span className="w-6 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                      <div className="min-w-[8rem] flex-1">
                        <Link to={`/students/${s.id}`} className="block truncate text-sm font-semibold text-slate-800 hover:underline dark:text-slate-100" tabIndex={-1}>{s.lastName}, {s.firstName}</Link>
                        <p className="text-[11px] text-slate-400">{s.admissionNo}{s.boarding === 'boarder' ? ' · Boarder' : ''}</p>
                      </div>
                      <div className="flex gap-1.5" role="radiogroup" aria-label={`Attendance for ${fullName(s)}`}>
                        {MARKS.map((mk) => (
                          <button key={mk.id} type="button" tabIndex={-1} disabled={!can} role="radio" aria-checked={m === mk.id} title={mk.long}
                            onClick={() => setMark(s.id, mk.id)}
                            className={cx('h-10 w-10 rounded-xl border-2 text-sm font-bold transition active:scale-95 disabled:cursor-not-allowed',
                              m === mk.id ? mk.on : cx('border-slate-200 bg-white text-slate-400 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-500', mk.off))}>
                            {mk.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* sidebar: live counts */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card title="Live count" bodyClass="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {MARKS.map((mk) => (
              <div key={mk.id} className="rounded-xl border border-slate-100 p-3 dark:border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span className={cx('flex h-6 w-6 items-center justify-center rounded-lg text-[11px] font-bold', mk.on)}>{mk.id}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{mk.long}</span>
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{counts[mk.id]}</p>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{marked}/{students.length} marked</span>
              <span>{marked ? pct(((counts.P + counts.L) / marked) * 100) : '—'} in class</span>
            </div>
            <Progress value={students.length ? (marked / students.length) * 100 : 0} tone={unmarked ? 'amber' : 'green'} />
          </div>
          {unmarked > 0 && <p className="text-xs text-marigold-600 dark:text-marigold-400">{unmarked} learner{unmarked === 1 ? '' : 's'} not yet marked</p>}
          {can ? (
            <Button className="w-full" size="lg" variant="secondary" icon={<Save size={16} />} loading={saving} disabled={!students.length || (!dirty && !!existing)} onClick={save}>
              {existing ? (dirty ? 'Update register' : 'Saved') : 'Save register'}
            </Button>
          ) : <p className="text-xs text-slate-400">You have read-only access to registers.</p>}
        </Card>
      </div>
    </div>
  );
}

// ============================================================= reports tab ==
function ReportsTab() {
  const settings = useSettings();
  const { profile } = useAuth();
  const myClasses = useMyClasses();
  const allClasses = useClasses();
  const classes = profile?.role === 'admin' ? allClasses : myClasses;
  const { data: registers, loading } = useCollection('attendance');
  const students = useIndex('students');
  const term = currentTerm(settings);
  const today = todayISO();

  const [classId, setClassId] = useState<string>('all');
  const [from, setFrom] = useState(term?.start ?? addDays(today, -30));
  const [to, setTo] = useState(term && term.end < today ? term.end : today);
  const [q, setQ] = useState('');
  const [watchOnly, setWatchOnly] = useState(false);

  useEffect(() => { if (term) { setFrom(term.start); setTo(term.end < today ? term.end : today); } }, [term?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const classIds = useMemo(() => new Set(classId === 'all' ? classes.map((c) => c.id) : [classId]), [classId, classes]);
  const inRange = useMemo(() => registers.filter((r) => classIds.has(r.classId) && r.date >= from && r.date <= to), [registers, classIds, from, to]);

  const rows = useMemo(() => {
    const map = new Map<string, { student: Student | undefined; sid: string; classId: string; P: number; A: number; L: number; E: number; n: number }>();
    for (const r of inRange) {
      for (const [sid, m] of Object.entries(r.records)) {
        let row = map.get(sid);
        if (!row) { row = { student: students.get(sid), sid, classId: r.classId, P: 0, A: 0, L: 0, E: 0, n: 0 }; map.set(sid, row); }
        row[m]++; row.n++;
      }
    }
    return [...map.values()].map((r) => ({ ...r, rate: r.n ? ((r.P + r.L) / r.n) * 100 : null }))
      .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101) || (a.student?.lastName ?? '').localeCompare(b.student?.lastName ?? ''));
  }, [inRange, students]);

  const classSummary = useMemo(() => {
    const byClass = new Map<string, { cls: SchoolClass; regs: number; present: number; total: number; chronic: number }>();
    classes.filter((c) => classIds.has(c.id)).forEach((c) => byClass.set(c.id, { cls: c, regs: 0, present: 0, total: 0, chronic: 0 }));
    inRange.forEach((r) => {
      const s = byClass.get(r.classId); if (!s) return;
      const c = countMarks(r.records);
      s.regs++; s.present += c.P + c.L; s.total += c.P + c.A + c.L + c.E;
    });
    rows.forEach((r) => { if (r.rate != null && r.rate < CHRONIC) { const s = byClass.get(r.classId); if (s) s.chronic++; } });
    return [...byClass.values()];
  }, [classes, classIds, inRange, rows]);

  const daily = useMemo(() => {
    const m = new Map<string, { p: number; t: number }>();
    inRange.forEach((r) => {
      const c = countMarks(r.records);
      const e = m.get(r.date) ?? { p: 0, t: 0 };
      e.p += c.P + c.L; e.t += c.P + c.A + c.L + c.E;
      m.set(r.date, e);
    });
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ date: d, label: fmtDate(d, { day: 'numeric', month: 'short' }), rate: v.t ? Math.round((v.p / v.t) * 1000) / 10 : null, present: v.p, total: v.t }));
  }, [inRange]);

  const totals = useMemo(() => {
    let p = 0, t = 0;
    daily.forEach((d) => { p += d.present; t += d.total; });
    return { rate: t ? (p / t) * 100 : null, chronic: rows.filter((r) => r.rate != null && r.rate < CHRONIC).length };
  }, [daily, rows]);

  const clsIndex = useMemo(() => new Map(allClasses.map((c) => [c.id, c])), [allClasses]);
  const shown = rows.filter((r) => (!watchOnly || (r.rate != null && r.rate < CHRONIC)) && (!q || (r.student ? studentMatches(r.student, q) : r.sid.includes(q))));

  const exportCSV = () => {
    const data = rows.map((r) => ({
      'Admission No': r.student?.admissionNo ?? '', Name: r.student ? fullName(r.student) : r.sid, Class: clsIndex.get(r.classId)?.name ?? '',
      'Days recorded': r.n, Present: r.P, Absent: r.A, Late: r.L, Excused: r.E, 'Attendance %': r.rate == null ? '' : r.rate.toFixed(1),
      Watchlist: r.rate != null && r.rate < CHRONIC ? 'Yes' : '',
    }));
    const label = classId === 'all' ? 'all-classes' : (clsIndex.get(classId)?.name ?? classId).replace(/\s+/g, '-');
    download(`attendance-${label}-${from}-to-${to}.csv`, toCSV(data));
  };

  if (loading && !registers.length) return <Spinner />;

  return (
    <div className="space-y-5">
      <Card bodyClass="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_170px_170px_auto] lg:items-end">
          <Field label="Class">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="all">All classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Button variant="outline" icon={<Download size={15} />} onClick={exportCSV} disabled={!rows.length}>Export CSV</Button>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Overall attendance" value={pct(totals.rate, 1)} sub={`${fmtDate(from)} – ${fmtDate(to)}`} icon={<CalendarCheck size={18} />} tone={totals.rate != null && totals.rate < CHRONIC ? 'rose' : 'green'} />
        <StatCard label="Registers taken" value={inRange.length} sub={`${daily.length} school day${daily.length === 1 ? '' : 's'} recorded`} icon={<ClipboardList size={18} />} />
        <StatCard label="Learners tracked" value={rows.length} icon={<Users size={18} />} tone="violet" />
        <StatCard label="Chronic absence" value={totals.chronic} sub={`below ${CHRONIC}% attendance`} icon={<AlertTriangle size={18} />} tone={totals.chronic ? 'rose' : 'green'} onClick={() => setWatchOnly(true)} />
      </div>

      <Card title="Daily attendance rate" subtitle="Present + late as a share of learners recorded each day">
        {daily.length < 1 ? <EmptyState title="No registers in this range" /> : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-white/10" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8f9f97' }} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis domain={[(min: number) => Math.max(0, Math.floor(min / 10) * 10 - 10), 100]} tick={{ fontSize: 11, fill: '#8f9f97' }} tickLine={false} axisLine={false} unit="%" />
                <ReferenceLine y={CHRONIC} stroke="#f43f5e" strokeDasharray="4 4" label={{ value: `${CHRONIC}%`, fill: '#f43f5e', fontSize: 10, position: 'insideBottomRight' }} />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid rgba(148,163,184,.3)', fontSize: 12, background: 'rgba(255,255,255,.96)', color: '#131b18' }}
                  formatter={(v: any, _n: any, item: any) => [`${v}% (${item?.payload?.present}/${item?.payload?.total})`, 'Attendance']}
                  labelFormatter={(_l: any, p: any) => (p?.[0]?.payload?.date ? fmtDate(p[0].payload.date, { weekday: 'short', day: 'numeric', month: 'short' }) : '')}
                />
                <Line type="monotone" dataKey="rate" stroke="#0e833e" strokeWidth={2} dot={daily.length < 40 ? { r: 3, strokeWidth: 0, fill: '#0e833e' } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {classSummary.length > 1 && (
        <div>
          <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-white">By class</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {classSummary.map((s) => {
              const rate = s.total ? (s.present / s.total) * 100 : null;
              return (
                <button key={s.cls.id} onClick={() => setClassId(s.cls.id)} className="card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{s.cls.name}</p>
                    {s.chronic > 0 && <Badge tone="red">{s.chronic} at risk</Badge>}
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{pct(rate, 1)}</p>
                  <Progress className="mt-2" value={rate ?? 0} tone={rate == null ? 'brand' : rate < CHRONIC ? 'rose' : rate < 92 ? 'amber' : 'green'} />
                  <p className="mt-2 text-[11px] text-slate-400">{s.regs} register{s.regs === 1 ? '' : 's'}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Card title="Learner attendance" subtitle={`Sorted by lowest attendance first · red = chronic absence (< ${CHRONIC}%)`}
        actions={
          <>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} className="accent-rose-600" /> Watchlist only
            </label>
            <SearchInput value={q} onChange={setQ} className="w-48" />
          </>
        }>
        {shown.length === 0 ? <EmptyState title={rows.length ? 'No learners match' : 'No attendance recorded in this range'} /> : (
          <TableWrap>
            <thead><tr>
              <th className="th pl-5">Learner</th><th className="th">Class</th><th className="th text-right">Recorded</th>
              <th className="th text-right">Present</th><th className="th text-right">Absent</th><th className="th text-right">Late</th><th className="th text-right">Excused</th>
              <th className="th pr-5 text-right">Attendance</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => {
                const chronic = r.rate != null && r.rate < CHRONIC;
                return (
                  <tr key={r.sid} className="tr tr-hover">
                    <td className="td pl-5">
                      {r.student ? <Link to={`/students/${r.sid}`} className="font-semibold text-slate-800 hover:underline dark:text-slate-100">{fullName(r.student)}</Link> : <span className="text-slate-400">Unknown learner</span>}
                      <p className="text-[11px] text-slate-400">{r.student?.admissionNo}</p>
                    </td>
                    <td className="td text-slate-500 dark:text-slate-400">{clsIndex.get(r.classId)?.name ?? '—'}</td>
                    <td className="td text-right tabular-nums">{r.n}</td>
                    <td className="td text-right tabular-nums text-brand-600 dark:text-brand-400">{r.P}</td>
                    <td className="td text-right tabular-nums text-rose-600 dark:text-rose-400">{r.A}</td>
                    <td className="td text-right tabular-nums text-marigold-600 dark:text-marigold-400">{r.L}</td>
                    <td className="td text-right tabular-nums text-sky-600 dark:text-sky-400">{r.E}</td>
                    <td className="td pr-5 text-right">
                      {chronic ? <Badge tone="red"><AlertTriangle size={11} /> {pct(r.rate, 1)}</Badge>
                        : <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{pct(r.rate, 1)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

// =============================================================== today tab ==
function TodayTab({ onOpen }: { onOpen: (classId: string) => void }) {
  const classes = useClasses();
  const staff = useIndex('staff');
  const { data: registers } = useCollection('attendance');
  const { data: students } = useCollection('students');
  const today = todayISO();

  const rows = useMemo(() => classes.map((c) => {
    const reg = registers.find((r) => r.id === `${c.id}_${today}`) ?? registers.find((r) => r.classId === c.id && r.date === today);
    const enrolled = students.filter((s) => s.classId === c.id && s.status === 'active').length;
    const cnt = reg ? countMarks(reg.records) : null;
    return { c, reg, enrolled, cnt };
  }), [classes, registers, students, today]);

  const taken = rows.filter((r) => r.reg).length;
  const present = sumBy(rows, (r) => (r.cnt ? r.cnt.P + r.cnt.L : 0));
  const recorded = sumBy(rows, (r) => (r.cnt ? r.cnt.P + r.cnt.A + r.cnt.L + r.cnt.E : 0));
  const absent = sumBy(rows, (r) => r.cnt?.A ?? 0);

  return (
    <div className="space-y-5">
      {isWeekend(today) && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">
          <AlertTriangle size={16} /> Today is a weekend — no registers are expected.
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Registers taken" value={`${taken}/${classes.length}`} sub={fmtDate(today, { weekday: 'long', day: 'numeric', month: 'long' })} icon={<ClipboardList size={18} />} tone={taken === classes.length ? 'green' : 'amber'} />
        <StatCard label="Outstanding" value={classes.length - taken} sub="classes not yet marked" icon={<AlertTriangle size={18} />} tone={classes.length - taken ? 'rose' : 'green'} />
        <StatCard label="Present today" value={`${present}/${recorded}`} sub={recorded ? pct((present / recorded) * 100, 1) : 'Nothing recorded yet'} icon={<Users size={18} />} />
        <StatCard label="Absent today" value={absent} icon={<X size={18} />} tone="violet" />
      </div>
      <Card title="Class registers today" bodyClass="p-0">
        <div className="px-5">
          <TableWrap>
            <thead><tr><th className="th pl-5">Class</th><th className="th">Class teacher</th><th className="th">Register</th><th className="th text-right">Present / total</th><th className="th">Taken by</th><th className="th pr-5" /></tr></thead>
            <tbody>
              {rows.sort((a, b) => Number(!!a.reg) - Number(!!b.reg)).map(({ c, reg, enrolled, cnt }) => {
                const tot = cnt ? cnt.P + cnt.A + cnt.L + cnt.E : 0;
                return (
                  <tr key={c.id} className="tr tr-hover">
                    <td className="td pl-5 font-semibold text-slate-800 dark:text-slate-100">{c.name}</td>
                    <td className="td text-slate-500 dark:text-slate-400">{staffName(staff.get(c.classTeacherId ?? ''))}</td>
                    <td className="td">{reg ? <Badge tone="green"><Check size={11} strokeWidth={3} /> Taken</Badge> : <Badge tone="red"><X size={11} strokeWidth={3} /> Not taken</Badge>}</td>
                    <td className="td text-right tabular-nums">{cnt ? <><span className="font-semibold">{cnt.P + cnt.L}</span><span className="text-slate-400">/{tot}</span></> : <span className="text-slate-400">—/{enrolled}</span>}</td>
                    <td className="td text-xs text-slate-500 dark:text-slate-400">{reg ? <>{staffName(staff.get(reg.takenBy ?? ''))}{reg.updatedAt ? ` · ${new Date(reg.updatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</> : '—'}</td>
                    <td className="td pr-5 text-right"><Button size="sm" variant={reg ? 'ghost' : 'outline'} onClick={() => onOpen(c.id)}>{reg ? 'View' : 'Take now'}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </div>
      </Card>
    </div>
  );
}

function sumBy<T>(xs: T[], f: (x: T) => number) { return xs.reduce((a, x) => a + f(x), 0); }
