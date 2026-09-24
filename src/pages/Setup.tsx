// "Get started" — the head's setup space. Share the school code, answer join
// requests the moment they arrive, create logins directly, and tick off setup.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Eye, EyeOff, Inbox, KeyRound, Link2, UserPlus, X } from 'lucide-react';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCollection } from '../lib/store';
import { Avatar, Button, Card, Field, Input, PageHeader, Select, useUI } from '../components/ui';
import { REQUEST_ROLES, acceptRequest, createAccount, declineRequest, ensureJoinCode, usePendingRequests } from '../lib/joinRequests';
import { friendlyAuthError } from '../lib/authErrors';
import { JoinRequest, ROLE_LABELS, Student } from '../types';
import { cx, fullName } from '../lib/utils';

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// ------------------------------------------------------------- learner picker --
const LearnerPicker: React.FC<{ value: string[]; onChange: (v: string[]) => void; single?: boolean }> = ({ value, onChange, single }) => {
  const { data: students } = useCollection('students');
  const [q, setQ] = useState('');
  const list = useMemo(() => students.filter((s) => s.status === 'active' && (!q || fullName(s).toLowerCase().includes(q.toLowerCase()) || s.admissionNo?.toLowerCase().includes(q.toLowerCase()))).slice(0, 6), [students, q]);
  const picked = value.map((id) => students.find((s) => s.id === id)).filter(Boolean) as Student[];
  if (!students.length) return <p className="text-xs text-slate-500 dark:text-slate-400">No learners enrolled yet — <Link to="/students" className="link">enrol one first</Link>, then link them here.</p>;
  return (
    <div>
      {picked.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{picked.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium dark:border-white/10 dark:bg-white/[0.04]">
          {fullName(s)}<button onClick={() => onChange(value.filter((x) => x !== s.id))} aria-label={`Remove ${fullName(s)}`} className="text-slate-400 hover:text-slate-700"><X size={12} /></button>
        </span>))}</div>}
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search learners by name or admission no." className="h-9" />
      <div className="mt-1 max-h-40 overflow-y-auto">
        {list.filter((s) => !value.includes(s.id)).map((s) => (
          <button key={s.id} type="button" onClick={() => onChange(single ? [s.id] : [...value, s.id])} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/5">
            <span>{fullName(s)}</span><span className="text-xs text-slate-400">{s.admissionNo}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

// --------------------------------------------------------------- one request --
const RequestRow: React.FC<{ r: JoinRequest }> = ({ r }) => {
  const { toast } = useUI();
  const { data: staff } = useCollection('staff');
  const [role, setRole] = useState<JoinRequest['role']>(r.role);
  const [staffId, setStaffId] = useState('');
  const [studentIds, setStudentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<'ok' | 'no' | null>(null);
  const family = role === 'parent' || role === 'student';

  const accept = async () => {
    if (family && !studentIds.length) { toast(role === 'parent' ? 'Link their child first' : 'Link the learner record first', 'error'); return; }
    setBusy('ok');
    try { await acceptRequest(r, { role, staffId: staffId || undefined, studentIds }); toast(`${r.name} can now sign in as ${ROLE_LABELS[role].toLowerCase()}`); }
    catch (e) { toast(friendlyAuthError(e), 'error'); setBusy(null); }
  };
  const decline = async () => {
    setBusy('no');
    try { await declineRequest(r); toast(`Declined ${r.name}`); } catch (e) { toast(friendlyAuthError(e), 'error'); setBusy(null); }
  };

  return (
    <li className="animate-slide-up rounded-xl border border-slate-200 p-4 dark:border-white/[0.08]">
      <div className="flex flex-wrap items-start gap-3">
        <Avatar name={r.name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-white">{r.name} <span className="font-normal text-slate-500 dark:text-slate-400">wants to join as {ROLE_LABELS[r.role].toLowerCase()}</span></p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{r.email} · {ago(r.createdAt)}</p>
          {r.note && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">“{r.note}”</p>}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Give them access as">
          <Select value={role} onChange={(e) => { setRole(e.target.value as JoinRequest['role']); setStudentIds([]); }}>
            {REQUEST_ROLES.map((x) => <option key={x.role} value={x.role}>{x.label}</option>)}
          </Select>
        </Field>
        {!family ? (
          <Field label="Staff record" hint="Leave as new and we’ll add them to the staff directory">
            <Select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              <option value="">New staff record for {r.name.split(' ')[0]}</option>
              {staff.filter((s) => s.status !== 'left').map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName} · {s.position}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label={role === 'parent' ? 'Their child(ren)' : 'Which learner are they?'}><LearnerPicker value={studentIds} onChange={setStudentIds} single={role === 'student'} /></Field>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={decline} loading={busy === 'no'} disabled={!!busy}>Decline</Button>
        <Button size="sm" onClick={accept} loading={busy === 'ok'} disabled={!!busy} icon={<Check size={14} />}>Accept</Button>
      </div>
    </li>
  );
};

// ------------------------------------------------------------ create a login --
const CreateLogin: React.FC<{ schoolId: string }> = ({ schoolId }) => {
  const { toast } = useUI();
  const [f, setF] = useState<{ name: string; email: string; password: string; role: JoinRequest['role'] | 'admin'; studentIds: string[] }>({ name: '', email: '', password: '', role: 'teacher', studentIds: [] });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const family = f.role === 'parent' || f.role === 'student';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    if (family && !f.studentIds.length) { toast('Link a learner first', 'error'); return; }
    setBusy(true);
    try {
      await createAccount(schoolId, f);
      toast(`Login created for ${f.name}. Give them their email and password.`);
      setF({ name: '', email: '', password: '', role: f.role, studentIds: [] });
    } catch (x) { toast(friendlyAuthError(x), 'error'); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Mr T. Ncube" /></Field>
      <Field label="Role">
        <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as typeof f.role, studentIds: [] })}>
          {REQUEST_ROLES.map((x) => <option key={x.role} value={x.role}>{x.label}</option>)}
          <option value="admin">Administrator (another head / deputy)</option>
        </Select>
      </Field>
      <Field label="Email"><Input required type="email" autoComplete="off" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@school.co.zw" /></Field>
      <Field label="Password you choose for them" hint="At least 6 characters — they can change it with “Forgot password”">
        <div className="relative">
          <Input required type={show ? 'text' : 'password'} autoComplete="new-password" minLength={6} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} className="pr-10" />
          <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-700">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
        </div>
      </Field>
      {family && <Field label={f.role === 'parent' ? 'Their child(ren)' : 'Learner record'} className="sm:col-span-2"><LearnerPicker value={f.studentIds} onChange={(v) => setF({ ...f, studentIds: v })} single={f.role === 'student'} /></Field>}
      <div className="flex justify-end sm:col-span-2"><Button type="submit" loading={busy} icon={<UserPlus size={15} />}>Create login</Button></div>
    </form>
  );
};

// -------------------------------------------------------------------- page --
export default function Setup() {
  const { profile, mode, configured } = useAuth();
  const settings = useSettings();
  const { toast } = useUI();
  const requests = usePendingRequests(profile);
  const counts = {
    classes: useCollection('classes').data.length,
    staff: useCollection('staff').data.length,
    students: useCollection('students').data.length,
    fees: useCollection('feeStructures').data.length,
    users: useCollection('users').data.length,
  };
  const [making, setMaking] = useState(false);
  const online = configured;
  const code = settings?.joinCode;
  const link = code ? `${location.origin}${location.pathname}#/signup?join=${code}` : '';

  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch { toast('Couldn’t copy — select it and copy by hand', 'error'); } };
  const makeCode = async () => {
    if (!settings || !profile) return;
    setMaking(true);
    try { await ensureJoinCode(profile.schoolId, settings.name, settings.joinCode); } catch (e) { toast(friendlyAuthError(e), 'error'); }
    setMaking(false);
  };

  const steps = [
    { done: !!settings?.logo || !!settings?.address || !!settings?.phone, label: 'School details', body: 'Logo, address, phone and head’s name for reports and receipts', to: '/settings' },
    { done: counts.users > 1 || counts.staff > 0, label: 'Staff logins', body: 'Share your code or create logins below', to: '#people' },
    { done: counts.classes > 0, label: 'Classes', body: 'Levels and streams', to: '/classes' },
    { done: counts.students > 0, label: 'Learners', body: 'Enrol or import from a spreadsheet', to: '/students' },
    { done: counts.fees > 0, label: 'Fees', body: 'This term’s fee structure', to: '/finance' },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="animate-fade-in">
      <PageHeader title={`Welcome${profile?.name && profile.name !== 'Demo user' ? `, ${profile.name.split(' ')[0]}` : ''}`} subtitle={`Let’s get ${settings?.name ?? 'your school'} ready. Invite your staff, answer requests, then set up classes and learners.`} />

      {/* progress */}
      <div className="mb-6 grid gap-2 sm:grid-cols-5">
        {steps.map((s, i) => {
          const inner = (
            <div className={cx('h-full rounded-xl border p-3 transition', s.done ? 'border-brand-600/30 bg-brand-50/60 dark:border-brand-400/25 dark:bg-brand-400/[0.06]' : 'border-slate-200 bg-white hover:border-slate-300 dark:border-white/[0.08] dark:bg-ink-800')}>
              <div className="flex items-center gap-2">
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', s.done ? 'bg-brand-700 text-white dark:bg-brand-400 dark:text-ink-950' : 'border border-slate-300 text-slate-500 dark:border-white/20 dark:text-slate-400')}>{s.done ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{s.label}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{s.body}</p>
            </div>
          );
          return s.to.startsWith('#') ? <a key={s.label} href={`#/setup`} onClick={(e) => { e.preventDefault(); document.getElementById('people')?.scrollIntoView({ behavior: 'smooth' }); }}>{inner}</a> : <Link key={s.label} to={s.to}>{inner}</Link>;
        })}
      </div>
      <p className="-mt-3 mb-6 text-xs text-slate-500 dark:text-slate-400">{doneCount} of {steps.length} done</p>

      <div id="people" className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <div className="space-y-6">
          <Card title={<span className="flex items-center gap-2"><Link2 size={16} /> Invite people with your school code</span>}
            subtitle="Teachers, the bursar, parents and learners sign up with this code. You approve each one.">
            {!online ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">School codes need the online version. In this browser-only demo, create logins on the right instead.</p>
            ) : code ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 dark:border-white/15 dark:bg-white/[0.03]">
                  <span className="font-mono text-[26px] font-bold tracking-[0.25em] text-slate-900 dark:text-white">{code}</span>
                  <Button variant="outline" size="sm" onClick={() => copy(code, 'Code')} icon={<Copy size={14} />}>Copy code</Button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Input readOnly value={link} className="h-9 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                  <Button size="sm" onClick={() => copy(link, 'Invite link')} icon={<Copy size={14} />}>Copy invite link</Button>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Send the link on WhatsApp or read the code out in a staff meeting. People who use it land in <b>Requests</b> — nobody gets in until you accept.</p>
              </>
            ) : (
              <Button onClick={makeCode} loading={making} icon={<KeyRound size={15} />}>Make a school code</Button>
            )}
          </Card>

          <Card title={<span className="flex items-center gap-2"><Inbox size={16} /> Requests to join {requests.length > 0 && <span className="rounded-full bg-marigold-400 px-2 py-0.5 text-[11px] font-bold text-slate-900">{requests.length}</span>}</span>}
            subtitle="New requests appear here the moment they’re sent.">
            {requests.length ? (
              <ul className="space-y-3">{requests.map((r) => <RequestRow key={r.id} r={r} />)}</ul>
            ) : (
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500 dark:bg-white/[0.03] dark:text-slate-400">
                <span className="relative flex h-2.5 w-2.5"><span className="absolute inset-0 animate-ping rounded-full bg-brand-500/50" /><span className="relative h-2.5 w-2.5 rounded-full bg-brand-500" /></span>
                No requests yet — waiting live. {online && mode === 'demo' && 'Try it: open the invite link on your phone and sign up as a teacher.'}
              </div>
            )}
          </Card>
        </div>

        <Card title={<span className="flex items-center gap-2"><UserPlus size={16} /> Create a login yourself</span>}
          subtitle="For staff who’d rather you set them up. You choose the password and hand it over.">
          {profile && <CreateLogin schoolId={profile.schoolId} />}
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-white/[0.07] dark:text-slate-400">Everyone with a login is listed in <Link to="/settings" className="link">Settings → Users &amp; access</Link>, where you can change roles or switch accounts off.</p>
        </Card>
      </div>
    </div>
  );
}
