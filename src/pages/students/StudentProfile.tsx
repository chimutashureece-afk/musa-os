import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {ArrowLeft, Award, BedDouble, BookOpen, CalendarCheck, FileText, HeartPulse, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Printer, ShieldAlert, ThumbsDown, ThumbsUp, TrendingUp, UserX, Wallet} from 'lucide-react';
import { useAuth, useSettings } from '../../context/AuthContext';
import { useCan } from '../../lib/hooks';
import { store, useCollection, useIndex } from '../../lib/store';
import { AttendanceMark, Incident, Mark, Student } from '../../types';
import {
  Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, StatCard, TableWrap, Tabs, Textarea, useUI,
} from '../../components/ui';
import {
  ageFrom, avg, currentTerm, cx, fmtDate, fullName, gradeColor, gradeFor, money, pct, staffName, sum, termById, termPercent, todayISO,
} from '../../lib/utils';
import { StatusBadge, StudentFormModal } from './Students';

type TabId = 'overview' | 'attendance' | 'academics' | 'fees' | 'conduct' | 'library' | 'reports';

const MARK_LABEL: Record<AttendanceMark, string> = { P: 'Present', A: 'Absent', L: 'Late', E: 'Excused' };
const MARK_STYLE: Record<AttendanceMark, string> = {
  P: 'bg-brand-500',
  L: 'bg-marigold-400',
  E: 'bg-sky-400',
  A: 'bg-rose-500',
};

const digits = (p: string) => p.replace(/\D/g, '');

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">{children || <span className="text-slate-400">—</span>}</dd>
  </div>
);

export default function StudentProfile() {
  const { id = '' } = useParams();
  const { profile } = useAuth();
  const settings = useSettings();
  const role = profile?.role;
  const isFamily = role === 'parent' || role === 'student';
  const isStaff = role === 'admin' || role === 'teacher' || role === 'bursar';
  const canEditStudent = useCan('students');
  const canConduct = useCan('incidents') && isStaff;
  const canFinance = role === 'admin' || role === 'bursar' || isFamily;

  const { data: students, loading } = useCollection('students');
  const classIdx = useIndex('classes');
  const staffIdx = useIndex('staff');
  const subjectIdx = useIndex('subjects');
  const bookIdx = useIndex('books');
  const { data: attendance } = useCollection('attendance');
  const { data: assessments } = useCollection('assessments');
  const { data: marks } = useCollection('marks');
  const { data: invoices } = useCollection('invoices');
  const { data: payments } = useCollection('payments');
  const { data: incidents } = useCollection('incidents');
  const { data: loans } = useCollection('loans');
  const { data: reports } = useCollection('reports');

  const [tab, setTab] = useState<TabId>('overview');
  const [editing, setEditing] = useState(false);
  const [conductOpen, setConductOpen] = useState(false);

  const student = students.find((s) => s.id === id);
  const allowed = !isFamily || (profile?.studentIds ?? []).includes(id);
  const cls = student ? classIdx.get(student.classId) : undefined;
  const term = currentTerm(settings);
  const today = todayISO();

  // ------------------------------------------------------------ attendance
  const att = useMemo(() => {
    const regs = attendance.filter((r) => r.records?.[id] && (!term || (r.date >= term.start && r.date <= term.end))).sort((a, b) => a.date.localeCompare(b.date));
    const counts: Record<AttendanceMark, number> = { P: 0, A: 0, L: 0, E: 0 };
    regs.forEach((r) => { counts[r.records[id]!]++; });
    const total = regs.length;
    const rate = total ? ((counts.P + counts.L) / total) * 100 : null;
    const days = regs.map((r) => ({ date: r.date, mark: r.records[id]! }));
    return { counts, total, rate, days, exceptions: days.filter((d) => d.mark !== 'P').reverse() };
  }, [attendance, id, term]);

  // ------------------------------------------------------------- academics
  const marksIdx = useMemo(() => new Map<string, Mark>(marks.filter((m) => m.studentId === id).map((m) => [`${m.assessmentId}_${m.studentId}`, m])), [marks, id]);
  const academics = useMemo(() => {
    if (!student || !settings) return { terms: [] as { termId: string; name: string; rows: Map<string, { pct: number | null; classId: string }>; average: number | null }[], subjectIds: [] as string[] };
    const myMarks = [...marksIdx.values()];
    const subjectIds = new Set<string>();
    const out = [];
    for (const t of settings.terms) {
      const classIds = new Set(myMarks.filter((m) => m.termId === t.id).map((m) => m.classId));
      if (t.id === settings.currentTermId) classIds.add(student.classId);
      const ta = assessments.filter((a) => a.termId === t.id && classIds.has(a.classId));
      if (!ta.length) continue;
      const bySubject = new Map<string, typeof ta>();
      ta.forEach((a) => { const l = bySubject.get(a.subjectId) ?? []; l.push(a); bySubject.set(a.subjectId, l); });
      const rows = new Map<string, { pct: number | null; classId: string }>();
      bySubject.forEach((list, sid) => {
        const p = termPercent(list, marksIdx, id);
        rows.set(sid, { pct: p, classId: list[0]!.classId });
        subjectIds.add(sid);
      });
      const vals = [...rows.values()].map((r) => r.pct).filter((x): x is number => x != null);
      out.push({ termId: t.id, name: t.name, rows, average: avg(vals) });
    }
    const sorted = [...subjectIds].sort((a, b) => (subjectIdx.get(a)?.name ?? '').localeCompare(subjectIdx.get(b)?.name ?? ''));
    return { terms: out, subjectIds: sorted };
  }, [student, settings, assessments, marksIdx, id, subjectIdx]);

  const curAcad = academics.terms.find((t) => t.termId === settings?.currentTermId);
  const chartTerm = curAcad && curAcad.average != null ? curAcad : [...academics.terms].reverse().find((t) => t.average != null);
  const chartData = useMemo(() => {
    if (!chartTerm) return [];
    return [...chartTerm.rows.entries()]
      .filter(([, r]) => r.pct != null)
      .map(([sid, r]) => {
        const sub = subjectIdx.get(sid);
        const g = gradeFor(r.pct, classIdx.get(r.classId), settings);
        return { name: sub?.code && sub.code.length <= 6 && !/^\d+$/.test(sub.code) ? sub.code : (sub?.name ?? sid).split(' ')[0]!, full: sub?.name ?? sid, pct: Math.round(r.pct! * 10) / 10, grade: g?.grade ?? '' };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [chartTerm, subjectIdx, classIdx, settings]);

  const assessIdx = useMemo(() => new Map(assessments.map((a) => [a.id, a])), [assessments]);
  const recentMarks = useMemo(() =>
    [...marksIdx.values()]
      .map((m) => ({ m, a: assessIdx.get(m.assessmentId) }))
      .filter((x) => x.a && x.m.score != null)
      .sort((x, y) => (y.a!.date || '').localeCompare(x.a!.date || ''))
      .slice(0, 15), [marksIdx, assessIdx]);

  // ------------------------------------------------------------------ fees
  const fees = useMemo(() => {
    const inv = invoices.filter((i) => i.studentId === id);
    const pay = payments.filter((p) => p.studentId === id);
    type Row = { date: string; kind: 'invoice' | 'payment'; ref: string; desc: string; debit: number; credit: number; balance: number; termId: string };
    const rows: Row[] = [
      ...inv.map((i) => ({ date: i.issuedDate, kind: 'invoice' as const, ref: i.invoiceNo, desc: i.items.map((x) => x.name).join(', ') + (i.discount ? ` (less ${money(i.discount)} discount)` : ''), debit: i.total - (i.discount ?? 0), credit: 0, balance: 0, termId: i.termId })),
      ...pay.map((p) => ({ date: p.date, kind: 'payment' as const, ref: p.receiptNo, desc: `${p.method}${p.reference ? ` · ${p.reference}` : ''}`, debit: 0, credit: p.amount, balance: 0, termId: p.termId })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1));
    let bal = 0;
    rows.forEach((r) => { bal += r.debit - r.credit; r.balance = bal; });
    const termIds = [...new Set(rows.map((r) => r.termId))];
    const perTerm = termIds
      .map((tid) => {
        const invoiced = sum(rows.filter((r) => r.termId === tid).map((r) => r.debit));
        const paid = sum(rows.filter((r) => r.termId === tid).map((r) => r.credit));
        return { termId: tid, name: termById(settings, tid)?.name ?? tid, start: termById(settings, tid)?.start ?? tid, invoiced, paid, balance: invoiced - paid };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    return { rows, perTerm, balance: bal, invoiced: sum(rows.map((r) => r.debit)), paid: sum(rows.map((r) => r.credit)) };
  }, [invoices, payments, id, settings]);

  // --------------------------------------------------------------- conduct
  const myIncidents = useMemo(() => incidents.filter((i) => i.studentId === id).sort((a, b) => b.date.localeCompare(a.date)), [incidents, id]);
  const points = sum(myIncidents.map((i) => i.points));

  // --------------------------------------------------------------- library
  const myLoans = useMemo(() => loans.filter((l) => l.studentId === id).sort((a, b) => b.issued.localeCompare(a.issued)), [loans, id]);
  const loanStatus = (l: (typeof loans)[number]) => (l.returned ? 'returned' : l.due < today ? 'overdue' : 'out');

  // --------------------------------------------------------------- reports
  const myReports = useMemo(() => reports.filter((r) => r.studentId === id).sort((a, b) => (termById(settings, b.termId)?.start ?? '').localeCompare(termById(settings, a.termId)?.start ?? '')), [reports, id, settings]);

  if (loading) return <Spinner label="Loading student…" />;
  if (!student || !allowed) {
    return (
      <div>
        <PageHeader title="Student profile" />
        <Card><EmptyState icon={<UserX size={22} />} title="Student not found" body="This student record does not exist or you do not have access to it."
          action={isStaff ? <Link to="/students"><Button variant="outline" icon={<ArrowLeft size={16} />}>Back to register</Button></Link> : <Link to="/"><Button variant="outline">Go to dashboard</Button></Link>} /></Card>
      </div>
    );
  }

  const name = fullName(student);
  const classTeacher = cls?.classTeacherId ? staffIdx.get(cls.classTeacherId) : undefined;

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'academics', label: 'Academics' },
    ...(canFinance ? [{ id: 'fees' as const, label: 'Fees' }] : []),
    { id: 'conduct', label: 'Conduct', count: myIncidents.length || undefined },
    { id: 'library', label: 'Library', count: myLoans.filter((l) => !l.returned).length || undefined },
    { id: 'reports', label: 'Reports', count: myReports.length || undefined },
  ];
  const activeTab: TabId = tabs.some((t) => t.id === tab) ? tab : 'overview';

  return (
    <div className="space-y-6">
      <div className="no-print">
        <PageHeader eyebrow={isStaff ? 'Student profile' : 'My learner'} title={name}
          subtitle={<>{student.admissionNo} · {cls?.name ?? 'No class'}{classTeacher ? ` · Class teacher ${staffName(classTeacher)}` : ''}</>}
          actions={<>
            {isStaff && <Link to="/students"><Button variant="ghost" icon={<ArrowLeft size={16} />}>Register</Button></Link>}
            {canEditStudent && <Button variant="outline" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>}
          </>} />
      </div>

      {/* header card */}
      <div className="card no-print overflow-hidden">
        <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
          <Avatar name={name} size={72} className="ring-4 ring-white dark:ring-ink-800" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{name}</h2>
              <StatusBadge status={student.status} />
              {student.boarding === 'boarder' ? <Badge tone="blue"><BedDouble size={11} />Boarder</Badge> : <Badge>Day scholar</Badge>}
              {student.medical && <Badge tone="amber"><HeartPulse size={11} />Medical note</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
              <span className="font-mono">{student.admissionNo}</span>
              <span>{cls?.name ?? '—'}</span>
              <span>{student.gender === 'M' ? 'Male' : 'Female'}</span>
              <span>{student.dob ? `${ageFrom(student.dob)} years · born ${fmtDate(student.dob)}` : '—'}</span>
              <span>Enrolled {fmtDate(student.enrollDate)}</span>
            </div>
          </div>
        </div>
        <div className={cx('grid grid-cols-2 border-t border-slate-100 dark:border-white/[0.06]', canFinance ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
          <QuickStat icon={<CalendarCheck size={16} />} label="Attendance this term" value={pct(att.rate, 1)} sub={att.total ? `${att.counts.A} absent of ${att.total} days` : 'No registers yet'}
            tone={att.rate == null ? undefined : att.rate >= 90 ? 'good' : att.rate >= 80 ? 'warn' : 'bad'} onClick={() => setTab('attendance')} />
          <QuickStat icon={<TrendingUp size={16} />} label="Term average" value={pct(curAcad?.average, 1)}
            sub={curAcad?.average != null ? `Grade ${gradeFor(curAcad.average, cls, settings)?.grade ?? '—'} · ${term?.name ?? ''}` : 'No marks recorded yet'} onClick={() => setTab('academics')} />
          {canFinance && (
            <QuickStat icon={<Wallet size={16} />} label="Fee balance" value={money(fees.balance)} sub={fees.balance > 0 ? 'Outstanding' : fees.balance < 0 ? 'In credit' : 'Fully paid'}
              tone={fees.balance > 0 ? 'bad' : 'good'} onClick={() => setTab('fees')} />
          )}
          <QuickStat icon={<Award size={16} />} label="Merit points" value={points > 0 ? `+${points}` : String(points)} sub={`${myIncidents.filter((i) => i.kind === 'merit').length} merits · ${myIncidents.filter((i) => i.kind === 'demerit').length} demerits`}
            tone={points > 0 ? 'good' : points < 0 ? 'bad' : undefined} onClick={() => setTab('conduct')} />
        </div>
      </div>

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Personal details" className="lg:col-span-2">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="First name">{student.firstName}</Detail>
              <Detail label="Surname">{student.lastName}</Detail>
              <Detail label="Gender">{student.gender === 'M' ? 'Male' : 'Female'}</Detail>
              <Detail label="Date of birth">{student.dob ? `${fmtDate(student.dob)} (${ageFrom(student.dob)} yrs)` : ''}</Detail>
              <Detail label="Birth cert / ID">{student.nationalId}</Detail>
              <Detail label="Admission no.">{<span className="font-mono">{student.admissionNo}</span>}</Detail>
              <Detail label="Class">{cls?.name}</Detail>
              <Detail label="Class teacher">{classTeacher ? `${staffName(classTeacher)}` : ''}</Detail>
              <Detail label="Enrolled">{fmtDate(student.enrollDate)}</Detail>
              <Detail label="Boarding">{student.boarding === 'boarder' ? 'Boarder' : 'Day scholar'}</Detail>
              <Detail label="Status"><StatusBadge status={student.status} /></Detail>
              <Detail label="Room">{cls?.room}</Detail>
            </dl>
            <div className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-2 dark:border-white/[0.06]">
              <div className="flex gap-3">
                <MapPin size={18} className="mt-0.5 shrink-0 text-slate-400" />
                <Detail label="Home address">{student.address}</Detail>
              </div>
              <div className="flex gap-3">
                <HeartPulse size={18} className={cx('mt-0.5 shrink-0', student.medical ? 'text-marigold-500 dark:text-marigold-300' : 'text-slate-400')} />
                <Detail label="Medical">{student.medical ? <span className="font-medium text-marigold-700 dark:text-marigold-400">{student.medical}</span> : 'No known conditions'}</Detail>
              </div>
            </div>
            {student.notes && (
              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">
                <p className="label">Notes</p>{student.notes}
              </div>
            )}
          </Card>
          <Card title="Parents & guardians" subtitle={`${student.guardians.length} on record`}>
            {student.guardians.length === 0 ? <EmptyState title="No guardian on record" /> : (
              <div className="space-y-4">
                {student.guardians.map((g, i) => (
                  <div key={i} className={cx(i > 0 && 'border-t border-slate-100 pt-4 dark:border-white/[0.06]')}>
                    <div className="flex items-center gap-3">
                      <Avatar name={g.name} size={40} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900 dark:text-white">{g.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{g.relation}{g.occupation ? ` · ${g.occupation}` : ''}</p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm">
                      {g.phone && <a href={`tel:+${digits(g.phone)}`} className="flex items-center gap-2 text-slate-600 hover:text-brand-600 dark:text-slate-300"><Phone size={14} className="text-slate-400" />{g.phone}</a>}
                      {g.email && <a href={`mailto:${g.email}`} className="flex items-center gap-2 truncate text-slate-600 hover:text-brand-600 dark:text-slate-300"><Mail size={14} className="text-slate-400" />{g.email}</a>}
                    </div>
                    {g.phone && (
                      <div className="mt-3 flex gap-2">
                        <a href={`tel:+${digits(g.phone)}`} className="flex-1"><Button size="sm" variant="outline" icon={<Phone size={14} />} className="w-full">Call</Button></a>
                        <a href={`https://wa.me/${digits(g.phone)}`} target="_blank" rel="noreferrer" className="flex-1"><Button size="sm" variant="success" icon={<MessageCircle size={14} />} className="w-full">WhatsApp</Button></a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'attendance' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {(['P', 'A', 'L', 'E'] as AttendanceMark[]).map((m) => (
              <StatCard key={m} label={MARK_LABEL[m]} value={att.counts[m]} sub={att.total ? pct((att.counts[m] / att.total) * 100) + ' of days' : undefined}
                tone={m === 'P' ? 'green' : m === 'A' ? 'rose' : m === 'L' ? 'amber' : 'brand'} />
            ))}
          </div>
          <Card title={`Daily register · ${term?.name ?? 'This term'}`} subtitle={att.total ? `${att.total} school days recorded · attendance ${pct(att.rate, 1)}` : undefined}>
            {att.total === 0 ? <EmptyState icon={<CalendarCheck size={22} />} title="No registers taken yet this term" /> : (
              <>
                <div className="flex flex-wrap gap-1">
                  {att.days.map((d) => (
                    <div key={d.date} title={`${fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })} — ${MARK_LABEL[d.mark]}`}
                      className={cx('flex h-8 w-8 flex-col items-center justify-center rounded-md text-[10px] font-bold text-white', MARK_STYLE[d.mark])}>
                      <span className="leading-none">{parseInt(d.date.slice(8), 10)}</span>
                      <span className="text-[8px] font-medium leading-none opacity-80">{fmtDate(d.date, { month: 'short' })}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                  {(['P', 'L', 'E', 'A'] as AttendanceMark[]).map((m) => <span key={m} className="flex items-center gap-1.5"><span className={cx('h-3 w-3 rounded', MARK_STYLE[m])} />{MARK_LABEL[m]}</span>)}
                </div>
              </>
            )}
          </Card>
          <Card title="Days not marked present" subtitle={att.exceptions.length ? `${att.exceptions.length} this term` : undefined}>
            {att.exceptions.length === 0 ? <EmptyState title={att.total ? 'Perfect attendance this term' : 'Nothing to show yet'} /> : (
              <TableWrap>
                <thead><tr><th className="th pl-5">Date</th><th className="th">Day</th><th className="th pr-5">Mark</th></tr></thead>
                <tbody>
                  {att.exceptions.map((d) => (
                    <tr key={d.date} className="tr">
                      <td className="td pl-5">{fmtDate(d.date)}</td>
                      <td className="td">{fmtDate(d.date, { weekday: 'long' })}</td>
                      <td className="td pr-5"><Badge tone={d.mark === 'A' ? 'red' : d.mark === 'L' ? 'amber' : 'sky'}>{MARK_LABEL[d.mark]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'academics' && (
        academics.terms.length === 0 ? <Card><EmptyState icon={<BookOpen size={22} />} title="No assessments recorded yet" body="Term marks will appear here once teachers enter assessment results." /></Card> : (
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-5">
              <Card title="Subject performance" subtitle={chartTerm ? chartTerm.name : undefined} className="lg:col-span-3">
                {chartData.length === 0 ? <EmptyState title="No marks for this term yet" /> : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-white/10" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8f9f97' }} axisLine={false} tickLine={false} interval={0} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#8f9f97' }} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                          contentStyle={{ borderRadius: 12, border: '1px solid rgba(148,163,184,0.3)', fontSize: 12 }}
                          formatter={(v: any, _n: any, item: any) => [`${v}% (${item?.payload?.grade ?? ''})`, item?.payload?.full ?? 'Mark']}
                          labelFormatter={() => ''} />
                        <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={44}>
                          {chartData.map((d) => <Cell key={d.full} fill={d.pct >= 75 ? '#16a04c' : d.pct >= 50 ? '#16a04c' : d.pct >= 40 ? '#f59e0b' : '#f43f5e'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>
              <Card title="Term averages" className="lg:col-span-2">
                <div className="space-y-3">
                  {academics.terms.map((t) => {
                    const g = gradeFor(t.average, cls, settings);
                    return (
                      <div key={t.termId} className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3 dark:border-white/[0.06]">
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{t.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{[...t.rows.values()].filter((r) => r.pct != null).length} subjects graded</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-slate-900 dark:text-white">{pct(t.average, 1)}</p>
                          {g && <p className={cx('text-xs font-bold', gradeColor(g.grade))}>{g.grade} · {g.remark}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>

            <Card title="Marks by term" subtitle="Weighted term percentage per subject">
              <TableWrap>
                <thead>
                  <tr>
                    <th className="th pl-5">Subject</th>
                    {academics.terms.map((t) => <th key={t.termId} className="th text-center">{t.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {academics.subjectIds.map((sid) => (
                    <tr key={sid} className="tr tr-hover">
                      <td className="td pl-5 font-medium">{subjectIdx.get(sid)?.name ?? sid}</td>
                      {academics.terms.map((t) => {
                        const r = t.rows.get(sid);
                        const g = gradeFor(r?.pct, r ? classIdx.get(r.classId) : cls, settings);
                        return (
                          <td key={t.termId} className="td text-center tabular-nums">
                            {r?.pct != null ? <><span>{pct(r.pct)}</span> <span className={cx('ml-1 font-bold', gradeColor(g?.grade))}>{g?.grade}</span></> : <span className="text-slate-300 dark:text-slate-600">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr className="tr bg-slate-50/70 dark:bg-white/[0.02]">
                    <td className="td pl-5 font-bold">Average</td>
                    {academics.terms.map((t) => {
                      const g = gradeFor(t.average, cls, settings);
                      return <td key={t.termId} className="td text-center font-bold tabular-nums">{pct(t.average, 1)} <span className={cx('ml-1', gradeColor(g?.grade))}>{g?.grade}</span></td>;
                    })}
                  </tr>
                </tbody>
              </TableWrap>
            </Card>

            <Card title="Recent assessment marks">
              {recentMarks.length === 0 ? <EmptyState title="No marks recorded yet" /> : (
                <TableWrap>
                  <thead><tr><th className="th pl-5">Date</th><th className="th">Assessment</th><th className="th">Subject</th><th className="th text-right">Score</th><th className="th text-right">%</th><th className="th pr-5">Teacher comment</th></tr></thead>
                  <tbody>
                    {recentMarks.map(({ m, a }) => {
                      const p = a!.maxMark ? (m.score! / a!.maxMark) * 100 : null;
                      const g = gradeFor(p, classIdx.get(a!.classId), settings);
                      return (
                        <tr key={m.id} className="tr tr-hover">
                          <td className="td whitespace-nowrap pl-5 text-slate-500 dark:text-slate-400">{fmtDate(a!.date)}</td>
                          <td className="td"><span className="font-medium">{a!.name}</span> <span className="text-xs capitalize text-slate-400">{a!.type}</span></td>
                          <td className="td">{subjectIdx.get(a!.subjectId)?.name ?? '—'}</td>
                          <td className="td text-right tabular-nums">{m.score}/{a!.maxMark}</td>
                          <td className={cx('td text-right font-semibold tabular-nums', gradeColor(g?.grade))}>{pct(p)}</td>
                          <td className="td pr-5 text-slate-600 dark:text-slate-300">{m.comment || <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrap>
              )}
            </Card>
          </div>
        )
      )}

      {activeTab === 'fees' && canFinance && (
        <div className="space-y-6">
          <div className="print-only mb-6 border-b-2 border-slate-800 pb-4 text-center">
            <h1 className="font-serif text-2xl font-bold">{settings?.name}</h1>
            <p className="text-xs">{settings?.address} · {settings?.phone} · {settings?.email}</p>
            <h2 className="mt-3 text-lg font-bold uppercase tracking-widest">Statement of account</h2>
            <p className="mt-1 text-sm">{name} · {student.admissionNo} · {cls?.name} · Printed {fmtDate(today)}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Total invoiced" value={money(fees.invoiced)} icon={<FileText size={20} />} />
            <StatCard label="Total paid" value={money(fees.paid)} icon={<Wallet size={20} />} tone="green" />
            <StatCard label="Balance" value={money(fees.balance)} icon={<Wallet size={20} />} tone={fees.balance > 0 ? 'rose' : 'green'} sub={fees.balance > 0 ? 'Amount due' : fees.balance < 0 ? 'Credit on account' : 'Account settled'} />
          </div>
          <Card title="Balance by term">
            {fees.perTerm.length === 0 ? <EmptyState title="No invoices yet" /> : (
              <TableWrap>
                <thead><tr><th className="th pl-5">Term</th><th className="th text-right">Invoiced</th><th className="th text-right">Paid</th><th className="th pr-5 text-right">Balance</th></tr></thead>
                <tbody>
                  {fees.perTerm.map((t) => (
                    <tr key={t.termId} className="tr">
                      <td className="td pl-5 font-medium">{t.name}</td>
                      <td className="td text-right tabular-nums">{money(t.invoiced)}</td>
                      <td className="td text-right tabular-nums">{money(t.paid)}</td>
                      <td className={cx('td pr-5 text-right font-semibold tabular-nums', t.balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-brand-600 dark:text-brand-400')}>{money(t.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </Card>
          <Card title="Statement" subtitle="Invoices and payments in date order"
            actions={<Button size="sm" variant="outline" icon={<Printer size={14} />} onClick={() => window.print()} className="no-print">Print statement</Button>}>
            {fees.rows.length === 0 ? <EmptyState icon={<Wallet size={22} />} title="No transactions yet" /> : (
              <TableWrap>
                <thead><tr><th className="th pl-5">Date</th><th className="th">Reference</th><th className="th">Details</th><th className="th text-right">Charges</th><th className="th text-right">Payments</th><th className="th pr-5 text-right">Balance</th></tr></thead>
                <tbody>
                  {fees.rows.map((r) => (
                    <tr key={r.kind + r.ref} className="tr">
                      <td className="td whitespace-nowrap pl-5">{fmtDate(r.date)}</td>
                      <td className="td whitespace-nowrap font-mono text-xs">{r.ref}</td>
                      <td className="td"><span className="text-xs text-slate-400">{termById(settings, r.termId)?.name}</span><br />{r.kind === 'invoice' ? 'Invoice: ' : 'Payment: '}{r.desc}</td>
                      <td className="td text-right tabular-nums">{r.debit ? money(r.debit) : ''}</td>
                      <td className="td text-right tabular-nums text-brand-600 dark:text-brand-400">{r.credit ? money(r.credit) : ''}</td>
                      <td className="td pr-5 text-right font-semibold tabular-nums">{money(r.balance)}</td>
                    </tr>
                  ))}
                  <tr className="tr bg-slate-50/70 dark:bg-white/[0.02]">
                    <td className="td pl-5 font-bold" colSpan={3}>Closing balance</td>
                    <td className="td text-right font-bold tabular-nums">{money(fees.invoiced)}</td>
                    <td className="td text-right font-bold tabular-nums">{money(fees.paid)}</td>
                    <td className={cx('td pr-5 text-right font-bold tabular-nums', fees.balance > 0 && 'text-rose-600 dark:text-rose-400')}>{money(fees.balance)}</td>
                  </tr>
                </tbody>
              </TableWrap>
            )}
          </Card>
          <p className="print-only text-xs">Payments can be made at the bursary, by bank transfer or EcoCash. Please quote the admission number {student.admissionNo} as the reference.</p>
        </div>
      )}

      {activeTab === 'conduct' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Net points" value={points > 0 ? `+${points}` : points} icon={<Award size={20} />} tone={points >= 0 ? 'green' : 'rose'} />
            <StatCard label="Merits" value={myIncidents.filter((i) => i.kind === 'merit').length} icon={<ThumbsUp size={20} />} tone="green"
              sub={`+${sum(myIncidents.filter((i) => i.kind === 'merit').map((i) => i.points))} points`} />
            <StatCard label="Demerits" value={myIncidents.filter((i) => i.kind === 'demerit').length} icon={<ThumbsDown size={20} />} tone="rose"
              sub={`${sum(myIncidents.filter((i) => i.kind === 'demerit').map((i) => i.points))} points`} />
          </div>
          <Card title="Conduct record" actions={canConduct ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setConductOpen(true)}>Record merit / demerit</Button> : undefined}>
            {myIncidents.length === 0 ? <EmptyState icon={<ShieldAlert size={22} />} title="No conduct entries" body="Merits and demerits recorded by staff will appear here." /> : (
              <ul className="space-y-3">
                {myIncidents.map((i) => (
                  <li key={i.id} className="flex gap-3 rounded-xl border border-slate-100 p-4 dark:border-white/[0.06]">
                    <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', i.kind === 'merit' ? 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200')}>
                      {i.kind === 'merit' ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-slate-900 dark:text-white">{i.category}</p>
                        <Badge tone={i.points >= 0 ? 'green' : 'red'}>{i.points > 0 ? `+${i.points}` : i.points} pts</Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{i.description}</p>
                      <p className="mt-1.5 text-xs text-slate-400">
                        {fmtDate(i.date)}{i.recordedBy && staffIdx.get(i.recordedBy) ? ` · ${staffName(staffIdx.get(i.recordedBy))}` : ''}{i.action ? ` · Action: ${i.action}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'library' && (
        <Card title="Library loans" subtitle={`${myLoans.filter((l) => !l.returned).length} currently borrowed · ${myLoans.filter((l) => loanStatus(l) === 'overdue').length} overdue`}>
          {myLoans.length === 0 ? <EmptyState icon={<BookOpen size={22} />} title="No library loans" /> : (
            <TableWrap>
              <thead><tr><th className="th pl-5">Book</th><th className="th">Issued</th><th className="th">Due</th><th className="th">Returned</th><th className="th pr-5">Status</th></tr></thead>
              <tbody>
                {myLoans.map((l) => {
                  const b = bookIdx.get(l.bookId);
                  const st = loanStatus(l);
                  return (
                    <tr key={l.id} className="tr tr-hover">
                      <td className="td pl-5"><p className="font-medium">{b?.title ?? 'Unknown title'}</p><p className="text-xs text-slate-400">{b?.author}</p></td>
                      <td className="td whitespace-nowrap">{fmtDate(l.issued)}</td>
                      <td className="td whitespace-nowrap">{fmtDate(l.due)}</td>
                      <td className="td whitespace-nowrap">{fmtDate(l.returned)}</td>
                      <td className="td pr-5">{st === 'returned' ? <Badge tone="green">Returned</Badge> : st === 'overdue' ? <Badge tone="red">Overdue</Badge> : <Badge tone="blue">On loan</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {activeTab === 'reports' && (
        <Card title="Published report cards">
          {myReports.length === 0 ? <EmptyState icon={<FileText size={22} />} title="No published reports yet" body="Report cards appear here once the school publishes them at the end of each term." /> : (
            <TableWrap>
              <thead><tr><th className="th pl-5">Term</th><th className="th">Class</th><th className="th text-right">Average</th><th className="th text-center">Position</th><th className="th text-center">Attendance</th><th className="th">Published</th><th className="th pr-5" /></tr></thead>
              <tbody>
                {myReports.map((r) => {
                  const g = gradeFor(r.average, classIdx.get(r.classId), settings);
                  return (
                    <tr key={r.id} className="tr tr-hover">
                      <td className="td pl-5 font-medium">{termById(settings, r.termId)?.name ?? r.termId}</td>
                      <td className="td">{r.className}</td>
                      <td className="td text-right tabular-nums">{pct(r.average, 1)} <span className={cx('ml-1 font-bold', gradeColor(g?.grade))}>{g?.grade}</span></td>
                      <td className="td text-center tabular-nums">{r.position != null ? `${r.position} / ${r.classSize}` : '—'}</td>
                      <td className="td text-center tabular-nums">{r.attendance.total ? `${r.attendance.present}/${r.attendance.total}` : '—'}</td>
                      <td className="td whitespace-nowrap text-slate-500 dark:text-slate-400">{fmtDate(r.publishedAt)}</td>
                      <td className="td pr-5 text-right"><Link className="link text-sm font-semibold" to={`/reports?student=${r.studentId}&term=${r.termId}`}>View</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {canEditStudent && <StudentFormModal open={editing} student={student} onClose={() => setEditing(false)} />}
      {canConduct && <ConductModal open={conductOpen} onClose={() => setConductOpen(false)} student={student} recordedBy={profile?.staffId} />}
    </div>
  );
}

// -------------------------------------------------------------- pieces ------
const QuickStat: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: 'good' | 'warn' | 'bad'; onClick?: () => void }> = ({ icon, label, value, sub, tone, onClick }) => (
  <button onClick={onClick} className="border-b border-r border-slate-100 p-4 text-left transition last:border-r-0 hover:bg-slate-50 lg:border-b-0 dark:border-white/[0.06] dark:hover:bg-white/[0.03]">
    <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{icon}{label}</p>
    <p className={cx('mt-1 text-xl font-bold tabular-nums',
      tone === 'good' ? 'text-brand-600 dark:text-brand-400' : tone === 'warn' ? 'text-marigold-600 dark:text-marigold-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white')}>{value}</p>
    {sub && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
  </button>
);

const MERIT_CATS = ['Academic excellence', 'Leadership', 'Community service', 'Sportsmanship', 'Helpfulness', 'Improvement', 'Cultural achievement'];
const DEMERIT_CATS = ['Late coming', 'Incomplete homework', 'Improper uniform', 'Disruptive behaviour', 'Bunking lessons', 'Disrespect', 'Bullying', 'Use of phone'];
const ACTIONS = ['', 'Verbal warning', 'Detention', 'Parent notified', 'Litter duty', 'Referred to Deputy Head', 'Suspension'];

const ConductModal: React.FC<{ open: boolean; onClose: () => void; student: Student; recordedBy?: string }> = ({ open, onClose, student, recordedBy }) => {
  const { toast } = useUI();
  const [kind, setKind] = useState<Incident['kind']>('merit');
  const [category, setCategory] = useState(MERIT_CATS[0]!);
  const [date, setDate] = useState(todayISO());
  const [pointsAbs, setPointsAbs] = useState(1);
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  const [saving, setSaving] = useState(false);

  const switchKind = (k: Incident['kind']) => { setKind(k); setCategory((k === 'merit' ? MERIT_CATS : DEMERIT_CATS)[0]!); if (k === 'merit') setAction(''); };

  const save = async () => {
    if (!description.trim()) { toast('Add a short description', 'error'); return; }
    setSaving(true);
    try {
      const pts = Math.max(1, Math.min(10, Math.round(pointsAbs || 1)));
      await store.add('incidents', {
        studentId: student.id, date, kind, category, description: description.trim(),
        action: kind === 'demerit' && action ? action : undefined,
        points: kind === 'merit' ? pts : -pts, recordedBy,
      });
      toast(`${kind === 'merit' ? 'Merit' : 'Demerit'} recorded for ${student.firstName}`);
      setDescription(''); setAction(''); setPointsAbs(1);
      onClose();
    } catch (e: any) {
      toast(e?.message ?? 'Could not save', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Conduct entry · ${fullName(student)}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving} variant={kind === 'merit' ? 'success' : 'danger'}>Record {kind}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {(['merit', 'demerit'] as const).map((k) => (
            <button key={k} onClick={() => switchKind(k)}
              className={cx('flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold capitalize transition',
                kind === k ? (k === 'merit' ? 'border-slate-200 bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200')
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5 dark:text-slate-400')}>
              {k === 'merit' ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}{k}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category"><Select value={category} onChange={(e) => setCategory(e.target.value)}>{(kind === 'merit' ? MERIT_CATS : DEMERIT_CATS).map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Date"><Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Points" hint={kind === 'merit' ? 'Added to the learner’s total' : 'Deducted from the learner’s total'}>
            <Input type="number" min={1} max={10} value={pointsAbs} onChange={(e) => setPointsAbs(Number(e.target.value))} />
          </Field>
          {kind === 'demerit' && (
            <Field label="Action taken"><Select value={action} onChange={(e) => setAction(e.target.value)}>{ACTIONS.map((a) => <option key={a} value={a}>{a || 'None'}</option>)}</Select></Field>
          )}
        </div>
        <Field label="Description" required><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === 'merit' ? 'e.g. Led the Form 3 team to first place in the maths olympiad' : 'e.g. Arrived 25 minutes late without a note'} /></Field>
      </div>
    </Modal>
  );
};
