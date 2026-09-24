import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {Users, UserSquare2, ClipboardCheck, Wallet, AlertTriangle, CalendarDays, Megaphone, PenLine, BookOpenCheck, ArrowRight, Clock, Receipt, FileText, Pin} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from 'recharts';
import { useAuth, useMyStaff, useSettings } from '../context/AuthContext';
import { useCollection, useIndex } from '../lib/store';
import { useClasses, useMyChildren, useMyClasses } from '../lib/hooks';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Progress, StatCard } from '../components/ui';
import {
  addDays, avg, classSort, currentTerm, cx, fmtDate, fullName, gradeColor, gradeFor, money, pct, sum, todayISO, termPercent, DAY_NAMES, parseISO, staffName,
} from '../lib/utils';
import { Announcement, Role, Student } from '../types';

const tooltipStyle = { borderRadius: 12, border: '1px solid rgba(148,163,184,.25)', fontSize: 12 };
const axis = { fontSize: 11, fill: '#8f9f97' };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function useVisibleAnnouncements(role: Role, classIds: string[] = []) {
  const { data } = useCollection('announcements');
  return useMemo(() => data.filter((a) => {
    if (role === 'admin' || role === 'teacher' || role === 'bursar') return true;
    const aud = role === 'parent' ? 'parents' : 'students';
    if (!a.audience.includes('all') && !a.audience.includes(aud)) return false;
    return !a.classIds?.length || a.classIds.some((c) => classIds.includes(c));
  }).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date)), [data, role, classIds]);
}

const AnnouncementsCard: React.FC<{ items: Announcement[] }> = ({ items }) => (
  <Card title="Announcements" actions={<Link to="/announcements" className="link text-xs font-semibold">View all</Link>} bodyClass="p-0">
    {items.length === 0 ? <EmptyState title="No announcements" /> : (
      <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
        {items.slice(0, 4).map((a) => (
          <li key={a.id} className="px-5 py-3.5">
            <div className="flex items-center gap-2">
              {a.pinned && <Pin size={12} className="text-slate-400 dark:text-slate-400" />}
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{a.title}</p>
            </div>
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{a.body}</p>
            <p className="mt-1 text-[11px] text-slate-400">{fmtDate(a.date)}</p>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

const UpcomingCard: React.FC = () => {
  const { data: events } = useCollection('events');
  const today = todayISO();
  const up = events.filter((e) => (e.endDate ?? e.date) >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const tone: Record<string, any> = { exam: 'red', holiday: 'green', meeting: 'slate', sports: 'amber', academic: 'blue', cultural: 'amber', other: 'slate' };
  return (
    <Card title="Coming up" actions={<Link to="/calendar" className="link text-xs font-semibold">Calendar</Link>} bodyClass="p-0">
      {up.length === 0 ? <EmptyState title="Nothing scheduled" /> : (
        <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
          {up.map((e) => {
            const d = parseISO(e.date);
            return (
              <li key={e.id} className="flex items-center gap-4 px-5 py-3">
                <div className="w-11 shrink-0 rounded-xl bg-slate-50 py-1 text-center dark:bg-white/5">
                  <p className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">{d.toLocaleDateString('en-GB', { month: 'short' })}</p>
                  <p className="text-lg font-bold leading-tight">{d.getDate()}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{e.title}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{e.endDate ? `${fmtDate(e.date, { day: 'numeric', month: 'short' })} – ${fmtDate(e.endDate, { day: 'numeric', month: 'short' })}` : fmtDate(e.date, { weekday: 'long' })}{e.location ? ` · ${e.location}` : ''}</p>
                </div>
                <Badge tone={tone[e.type]}>{e.type}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

// ============================================================ ADMIN / BURSAR =
function useFinanceStats(termId?: string) {
  const { data: invoices } = useCollection('invoices');
  const { data: payments } = useCollection('payments');
  return useMemo(() => {
    const inv = invoices.filter((i) => i.termId === termId);
    const pay = payments.filter((p) => p.termId === termId);
    const billed = sum(inv.map((i) => i.total));
    const collected = sum(pay.map((p) => p.amount));
    const paidBy = new Map<string, number>();
    pay.forEach((p) => paidBy.set(p.studentId, (paidBy.get(p.studentId) ?? 0) + p.amount));
    const owing = inv.map((i) => ({ studentId: i.studentId, balance: i.total - (paidBy.get(i.studentId) ?? 0) })).filter((x) => x.balance > 0.5);
    // weekly collections
    const weeks = new Map<string, number>();
    pay.forEach((p) => {
      const d = parseISO(p.date); const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = mon.toISOString().slice(0, 10);
      weeks.set(k, (weeks.get(k) ?? 0) + p.amount);
    });
    const weekly = [...weeks.entries()].sort().map(([k, v]) => ({ week: fmtDate(k, { day: 'numeric', month: 'short' }), amount: Math.round(v) }));
    return { billed, collected, outstanding: billed - collected, rate: billed ? (collected / billed) * 100 : 0, owing, weekly, recent: [...pay].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 6) };
  }, [invoices, payments, termId]);
}

const AdminDashboard: React.FC<{ role: Role }> = ({ role }) => {
  const settings = useSettings();
  const term = currentTerm(settings);
  const nav = useNavigate();
  const { data: students } = useCollection('students');
  const { data: staff } = useCollection('staff');
  const { data: attendance } = useCollection('attendance');
  const classes = useClasses();
  const studentIdx = useIndex('students');
  const classIdx = useIndex('classes');
  const fin = useFinanceStats(term?.id);
  const active = students.filter((s) => s.status === 'active');

  const att = useMemo(() => {
    const byDate = new Map<string, { p: number; t: number }>();
    for (const r of attendance) {
      const x = byDate.get(r.date) ?? { p: 0, t: 0 };
      for (const m of Object.values(r.records)) { x.t++; if (m === 'P' || m === 'L') x.p++; }
      byDate.set(r.date, x);
    }
    const days = [...byDate.keys()].sort().slice(-12);
    const series = days.map((d) => ({ day: fmtDate(d, { day: 'numeric', month: 'short' }), rate: Math.round((byDate.get(d)!.p / byDate.get(d)!.t) * 1000) / 10 }));
    const today = todayISO();
    const todayRegs = attendance.filter((r) => r.date === today);
    const latest = days[days.length - 1];
    return { series, latestRate: latest ? (byDate.get(latest)!.p / byDate.get(latest)!.t) * 100 : null, latest, takenToday: todayRegs.length };
  }, [attendance]);

  const enrolment = useMemo(() => {
    const m = new Map<string, number>();
    classes.forEach((c) => m.set(c.level, 0));
    active.forEach((s) => { const c = classIdx.get(s.classId); if (c) m.set(c.level, (m.get(c.level) ?? 0) + 1); });
    return [...m.entries()].map(([level, n]) => ({ level: level.replace('Grade ', 'G').replace('Form ', 'F'), n }));
  }, [active, classes, classIdx]);

  const topDebtors = [...fin.owing].sort((a, b) => b.balance - a.balance).slice(0, 5);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {role === 'admin' ? (
          <>
            <StatCard label="Active learners" value={active.length} sub={`${active.filter((s) => s.gender === 'F').length} girls · ${active.filter((s) => s.gender === 'M').length} boys`} icon={<Users size={20} />} onClick={() => nav('/students')} />
            <StatCard label="Staff" value={staff.filter((s) => s.status === 'active').length} sub={`${classes.length} classes`} icon={<UserSquare2 size={20} />} tone="violet" onClick={() => nav('/staff')} />
            <StatCard label="Attendance" value={pct(att.latestRate, 1)} sub={att.latest ? `Last register day · ${fmtDate(att.latest, { day: 'numeric', month: 'short' })}` : 'No registers yet'} icon={<ClipboardCheck size={20} />} tone="green" onClick={() => nav('/attendance')} />
          </>
        ) : (
          <>
            <StatCard label="Billed this term" value={money(fin.billed)} icon={<Receipt size={20} />} />
            <StatCard label="Collected" value={money(fin.collected)} sub={pct(fin.rate, 1) + ' collection rate'} icon={<Wallet size={20} />} tone="green" />
            <StatCard label="Learners owing" value={fin.owing.length} icon={<AlertTriangle size={20} />} tone="amber" onClick={() => nav('/finance')} />
          </>
        )}
        <StatCard label="Fees outstanding" value={money(fin.outstanding)} sub={`${pct(fin.rate, 1)} of ${money(fin.billed)} collected`} icon={<Wallet size={20} />} tone="rose" onClick={() => nav('/finance')} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {role === 'admin' && (
            <Card title="Daily attendance" subtitle="Share of learners present or late, last 12 register days">
              <div className="h-56">
                <ResponsiveContainer>
                  <AreaChart data={att.series} margin={{ left: -18, right: 8, top: 8 }}>
                    <defs><linearGradient id="att" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a04c" stopOpacity={0.35} /><stop offset="100%" stopColor="#16a04c" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.15)" vertical={false} />
                    <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} />
                    <YAxis domain={[80, 100]} tick={axis} tickLine={false} axisLine={false} unit="%" />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`, 'Present']} />
                    <Area type="monotone" dataKey="rate" stroke="#0e833e" strokeWidth={2} fill="url(#att)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card title="Fee collections" subtitle={`${term?.name ?? ''} · by week`}>
              <div className="h-48">
                <ResponsiveContainer>
                  <BarChart data={fin.weekly} margin={{ left: -10, right: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.15)" vertical={false} />
                    <XAxis dataKey="week" tick={axis} tickLine={false} axisLine={false} />
                    <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [money(v), 'Collected']} />
                    <Bar dataKey="amount" fill="#16a04c" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3"><div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>Collection rate</span><span className="font-semibold">{pct(fin.rate, 1)}</span></div><Progress value={fin.rate} tone="green" /></div>
            </Card>
            {role === 'admin' ? (
              <Card title="Enrolment by level">
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={enrolment} margin={{ left: -22, right: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,.15)" vertical={false} />
                      <XAxis dataKey="level" tick={axis} tickLine={false} axisLine={false} interval={0} />
                      <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [v, 'Learners']} />
                      <Bar dataKey="n" fill="#0c6834" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            ) : (
              <Card title="Recent payments" bodyClass="p-0">
                <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {fin.recent.map((p) => (
                    <li key={p.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <div className="min-w-0"><p className="truncate font-medium">{fullName(studentIdx.get(p.studentId))}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{p.receiptNo} · {p.method} · {fmtDate(p.date)}</p></div>
                      <span className="font-semibold text-brand-600 dark:text-brand-300">{money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
          <Card title="Largest outstanding balances" actions={<Link to="/finance" className="link text-xs font-semibold">Debtors list</Link>} bodyClass="p-0">
            {topDebtors.length === 0 ? <EmptyState title="All fees settled" /> : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {topDebtors.map((d) => {
                  const s = studentIdx.get(d.studentId);
                  return (
                    <li key={d.studentId} className="flex items-center gap-3 px-5 py-2.5">
                      <Avatar name={fullName(s)} size={30} />
                      <div className="min-w-0 flex-1"><Link to={`/students/${d.studentId}`} className="truncate text-sm font-medium hover:underline">{fullName(s)}</Link><p className="text-[11px] text-slate-500 dark:text-slate-400">{classIdx.get(s?.classId ?? '')?.name} · {s?.guardians[0]?.phone}</p></div>
                      <span className="text-sm font-semibold text-rose-600 dark:text-rose-300">{money(d.balance)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <QuickActions role={role} />
          <UpcomingCard />
          <AnnouncementsCard items={useVisibleAnnouncements(role)} />
        </div>
      </div>
    </>
  );
};

const QuickActions: React.FC<{ role: Role }> = ({ role }) => {
  const actions: { to: string; label: string; icon: any }[] =
    role === 'admin' ? [
      { to: '/students', label: 'Admit a learner', icon: Users },
      { to: '/attendance', label: 'Attendance today', icon: ClipboardCheck },
      { to: '/reports', label: 'Report cards', icon: FileText },
      { to: '/acegrader', label: 'AceGrader', icon: PenLine },
    ] : role === 'bursar' ? [
      { to: '/finance', label: 'Record payment', icon: Receipt },
      { to: '/finance', label: 'Generate invoices', icon: FileText },
      { to: '/students', label: 'Find a learner', icon: Users },
      { to: '/announcements', label: 'Post a notice', icon: Megaphone },
    ] : [
      { to: '/attendance', label: 'Take register', icon: ClipboardCheck },
      { to: '/gradebook', label: 'Enter marks', icon: BookOpenCheck },
      { to: '/acegrader/mark', label: 'Auto-mark scripts', icon: PenLine },
      { to: '/timetable', label: 'My timetable', icon: CalendarDays },
    ];
  return (
    <Card title="Quick actions">
      <div className="grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <Link key={a.label} to={a.to} className="group flex flex-col gap-2 rounded-xl border border-slate-100 p-3 transition hover:border-brand-200 hover:bg-brand-50/50 dark:border-white/[0.06] dark:hover:border-brand-500/30 dark:hover:bg-brand-500/5">
            <a.icon size={18} className="text-slate-400 dark:text-slate-400" />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{a.label}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
};

// ================================================================= TEACHER ==
const TeacherDashboard: React.FC = () => {
  const { profile } = useAuth();
  const me = useMyStaff();
  const myClasses = useMyClasses();
  const { data: timetable } = useCollection('timetable');
  const { data: attendance } = useCollection('attendance');
  const { data: submissions } = useCollection('submissions');
  const { data: assessments } = useCollection('assessments');
  const { data: marks } = useCollection('marks');
  const { data: students } = useCollection('students');
  const subjects = useIndex('subjects');
  const classIdx = useIndex('classes');
  const settings = useSettings();
  const term = currentTerm(settings);
  const today = todayISO();
  const dow = ((new Date().getDay() + 6) % 7) + 1; // Mon=1
  const mySlots = timetable.filter((t) => t.teacherId === profile?.staffId && t.day === (dow > 5 ? 1 : dow)).sort((a, b) => a.period - b.period);
  const classTeacherOf = myClasses.filter((c) => c.classTeacherId === profile?.staffId);
  const pending = submissions.filter((s) => s.status === 'pending-review' && (s.teacherId === profile?.staffId || profile?.role === 'admin'));

  const myAssess = assessments.filter((a) => a.termId === term?.id && a.createdBy === profile?.staffId || (a.termId === term?.id && timetable.some((t) => t.teacherId === profile?.staffId && t.classId === a.classId && t.subjectId === a.subjectId)));
  const marksByAssess = useMemo(() => {
    const m = new Map<string, number>();
    marks.forEach((x) => x.score != null && m.set(x.assessmentId, (m.get(x.assessmentId) ?? 0) + 1));
    return m;
  }, [marks]);
  const classSize = (cid: string) => students.filter((s) => s.classId === cid && s.status === 'active').length;
  const incomplete = myAssess.filter((a) => (marksByAssess.get(a.id) ?? 0) < classSize(a.classId)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="My classes" value={myClasses.length} sub={classTeacherOf.length ? `Class teacher: ${classTeacherOf.map((c) => c.name).join(', ')}` : undefined} icon={<Users size={20} />} />
        <StatCard label="Lessons today" value={mySlots.length} sub={dow > 5 ? 'Weekend — showing Monday' : DAY_NAMES[dow - 1]} icon={<Clock size={20} />} tone="violet" />
        <StatCard label="Registers today" value={`${classTeacherOf.filter((c) => attendance.some((r) => r.classId === c.id && r.date === today)).length}/${classTeacherOf.length}`} sub="classes you register" icon={<ClipboardCheck size={20} />} tone="green" />
        <StatCard label="Scripts to review" value={pending.length} icon={<PenLine size={20} />} tone="amber" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title={`Today's lessons${me ? ` · ${staffName(me)}` : ''}`} actions={<Link to="/timetable" className="link text-xs font-semibold">Full timetable</Link>} bodyClass="p-0">
            {mySlots.length === 0 ? <EmptyState title="No lessons today" /> : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {mySlots.map((s) => (
                  <li key={s.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="w-24 shrink-0"><p className="text-xs font-bold text-slate-900 dark:text-white">Period {s.period}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{settings?.periodTimes[s.period - 1]}</p></div>
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{subjects.get(s.subjectId)?.name}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{classIdx.get(s.classId)?.name} · {s.room}</p></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Marks still to capture" subtitle={term?.name} actions={<Link to="/gradebook" className="link text-xs font-semibold">Gradebook</Link>} bodyClass="p-0">
            {incomplete.length === 0 ? <EmptyState title="All caught up" body="Every assessment this term has marks for all learners." /> : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {incomplete.map((a) => {
                  const done = marksByAssess.get(a.id) ?? 0, n = classSize(a.classId);
                  return (
                    <li key={a.id} className="flex items-center gap-4 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <Link to={`/gradebook?class=${a.classId}&subject=${a.subjectId}`} className="text-sm font-semibold hover:underline">{a.name} · {subjects.get(a.subjectId)?.name}</Link>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">{classIdx.get(a.classId)?.name} · {fmtDate(a.date)}</p>
                      </div>
                      <div className="w-32"><div className="mb-1 text-right text-[11px] text-slate-500 dark:text-slate-400">{done}/{n}</div><Progress value={(done / Math.max(1, n)) * 100} tone={done === 0 ? 'rose' : 'amber'} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {pending.length > 0 && (
            <div className="card flex flex-col items-start justify-between gap-4 border-brand-900 bg-brand-900 p-6 text-white md:flex-row md:items-center dark:border-white/10 dark:bg-brand-950">
              <div><p className="flex items-center gap-2 font-display tracking-tight text-2xl"><PenLine size={20} /> {pending.length} auto-marked script{pending.length > 1 ? 's' : ''} waiting</p><p className="mt-1 text-sm text-white/80">Review, adjust and post to the gradebook in one click.</p></div>
              <Link to="/acegrader/review"><Button variant="secondary">Open review queue <ArrowRight size={16} /></Button></Link>
            </div>
          )}
        </div>
        <div className="space-y-6">
          <QuickActions role="teacher" />
          <UpcomingCard />
          <AnnouncementsCard items={useVisibleAnnouncements('teacher')} />
        </div>
      </div>
    </>
  );
};

// =========================================================== PARENT/STUDENT =
const ChildCard: React.FC<{ s: Student }> = ({ s }) => {
  const settings = useSettings();
  const term = currentTerm(settings);
  const cls = useIndex('classes').get(s.classId);
  const { data: attendance } = useCollection('attendance');
  const { data: invoices } = useCollection('invoices');
  const { data: payments } = useCollection('payments');
  const { data: reports } = useCollection('reports');
  const { data: assessments } = useCollection('assessments');
  const { data: marks } = useCollection('marks');
  const subjects = useIndex('subjects');

  const regs = attendance.filter((r) => r.classId === s.classId && term && r.date >= term.start && r.records[s.id]);
  const present = regs.filter((r) => ['P', 'L'].includes(r.records[s.id]!)).length;
  const attRate = regs.length ? (present / regs.length) * 100 : null;
  const balance = sum(invoices.filter((i) => i.studentId === s.id).map((i) => i.total)) - sum(payments.filter((p) => p.studentId === s.id).map((p) => p.amount));
  const lastReport = reports.filter((r) => r.studentId === s.id).sort((a, b) => b.termId.localeCompare(a.termId))[0];
  const markIdx = useMemo(() => new Map(marks.map((m) => [`${m.assessmentId}_${m.studentId}`, m])), [marks]);
  const termSubjects = useMemo(() => {
    const as = assessments.filter((a) => a.classId === s.classId && a.termId === term?.id);
    const bySub = new Map<string, typeof as>();
    as.forEach((a) => bySub.set(a.subjectId, [...(bySub.get(a.subjectId) ?? []), a]));
    return [...bySub.entries()].map(([sid, list]) => ({ name: subjects.get(sid)?.name ?? '', p: termPercent(list, markIdx, s.id) })).filter((x) => x.p != null).sort((a, b) => b.p! - a.p!);
  }, [assessments, s, term, subjects, markIdx]);
  const termAvg = avg(termSubjects.map((x) => x.p!));
  const g = gradeFor(termAvg, cls, settings);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-4 border-b border-slate-100 bg-slate-100 p-5 dark:border-white/[0.06] dark:bg-white/[0.02]">
        <Avatar name={fullName(s)} size={52} />
        <div className="min-w-0 flex-1">
          <p className="font-display tracking-tight text-2xl font-bold">{fullName(s)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{cls?.name} · {s.admissionNo}</p>
        </div>
        <Link to={`/students/${s.id}`}><Button variant="outline" size="sm">Profile</Button></Link>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-100 text-center dark:divide-white/[0.06]">
        <div className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Attendance</p><p className="mt-1 text-xl font-bold">{pct(attRate)}</p><p className="text-[11px] text-slate-400">{present}/{regs.length} days</p></div>
        <div className="p-4"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Term average</p><p className={cx('mt-1 text-xl font-bold', gradeColor(g?.grade))}>{pct(termAvg)}</p><p className="text-[11px] text-slate-400">{g ? `Grade ${g.grade}` : 'No marks yet'}</p></div>
        <Link to="/fees" className="p-4 hover:bg-slate-50 dark:hover:bg-white/5"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Fee balance</p><p className={cx('mt-1 text-xl font-bold', balance > 0.5 ? 'text-rose-600 dark:text-rose-300' : 'text-brand-600 dark:text-brand-300')}>{money(Math.max(0, balance))}</p><p className="text-[11px] text-slate-400">{balance > 0.5 ? 'Outstanding' : 'Up to date'}</p></Link>
      </div>
      <div className="border-t border-slate-100 p-5 dark:border-white/[0.06]">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">This term so far</p>
        {termSubjects.length === 0 ? <p className="text-sm text-slate-400">No marks recorded yet this term.</p> : (
          <div className="h-44">
            <ResponsiveContainer>
              <BarChart data={termSubjects.map((x) => ({ ...x, p: Math.round(x.p!) }))} layout="vertical" margin={{ left: 10, right: 16 }}>
                <XAxis type="number" domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit="%" />
                <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={120} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`, 'Mark']} />
                <Bar dataKey="p" fill="#16a04c" radius={[0, 6, 6, 0]} barSize={12} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {lastReport && (
          <Link to={`/reports?student=${s.id}&term=${lastReport.termId}`} className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm hover:bg-slate-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
            <span className="flex items-center gap-2"><FileText size={16} className="text-slate-400 dark:text-slate-400" /> {settings?.terms.find((t) => t.id === lastReport.termId)?.name} report card</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">Position {lastReport.position ?? '—'} of {lastReport.classSize} · avg {pct(lastReport.average)} <ArrowRight size={12} className="inline" /></span>
          </Link>
        )}
      </div>
    </div>
  );
};

const FamilyDashboard: React.FC<{ role: Role }> = ({ role }) => {
  const kids = useMyChildren();
  const { profile } = useAuth();
  const { data: timetable } = useCollection('timetable');
  const subjects = useIndex('subjects');
  const staff = useIndex('staff');
  const settings = useSettings();
  const dow = ((new Date().getDay() + 6) % 7) + 1;
  const me = kids[0];
  const today = me ? timetable.filter((t) => t.classId === me.classId && t.day === (dow > 5 ? 1 : dow)).sort((a, b) => a.period - b.period) : [];
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        {kids.length === 0 ? <Card><EmptyState title="No learners linked" body="Ask the school office to link your account to your child's record." /></Card> : kids.map((k) => <ChildCard key={k.id} s={k} />)}
      </div>
      <div className="space-y-6">
        {role === 'student' && me && (
          <Card title={dow > 5 ? "Monday's lessons" : "Today's lessons"} bodyClass="p-0">
            <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              {today.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="w-16 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{settings?.periodTimes[s.period - 1]?.split('–')[0]}</span>
                  <span className="flex-1 font-medium">{subjects.get(s.subjectId)?.name}</span>
                  <span className="text-[11px] text-slate-400">{staffName(staff.get(s.teacherId ?? ''))}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <UpcomingCard />
        <AnnouncementsCard items={useVisibleAnnouncements(role, profile?.classIds)} />
      </div>
    </div>
  );
};

// =================================================================== PAGE ===
export default function Dashboard() {
  const { profile } = useAuth();
  const settings = useSettings();
  const term = currentTerm(settings);
  const role = profile!.role;
  const first = profile!.name.replace(/^(Mr|Mrs|Ms|Dr|Miss)\.?\s+/i, '').split(' ')[0];
  const weekOf = term ? Math.max(1, Math.ceil((Date.now() - parseISO(term.start).getTime()) / (7 * 86400000))) : null;
  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow={settings?.name}
        title={`${greeting()}, ${first}`}
        subtitle={<>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{term && weekOf && todayISO() <= term.end ? ` · ${term.name}, week ${weekOf}` : ''}</>}
      />
      {role === 'admin' || role === 'bursar' ? <AdminDashboard role={role} /> : role === 'teacher' ? <TeacherDashboard /> : <FamilyDashboard role={role} />}
    </div>
  );
}
