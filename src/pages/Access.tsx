// Screens around access: finishing an emailed link, a demo whose day is over,
// waiting for Musa OS to approve a school, and the owners' sign-in.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Clock, Lock, MailCheck, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input, Textarea } from '../components/ui';
import { Frame, Notice, PaperAside } from './Auth';
import { SCHOOL_TYPES } from '../lib/defaults';
import { friendlyAuthError } from '../lib/authErrors';
import { isOwnerEmail } from '../lib/owner';
import { Section } from '../types';
import { cx } from '../lib/utils';

const H1: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h1 className="mt-5 font-display text-[2rem] font-bold leading-tight tracking-[-0.03em] text-slate-900 dark:text-white">{children}</h1>
);
const Lead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-2 text-[15px] leading-relaxed text-slate-500 dark:text-slate-400">{children}</p>
);
const Badge: React.FC<{ children: React.ReactNode; pulse?: boolean }> = ({ children, pulse }) => (
  <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">
    {children}{pulse && <span className="absolute right-1 top-1 h-2.5 w-2.5 animate-ping rounded-full bg-marigold-400" />}
  </div>
);

/** Type picker used by the demo forms. */
export const TypePicker: React.FC<{ value: Section; onChange: (v: Section) => void }> = ({ value, onChange }) => (
  <div role="radiogroup" aria-label="School type" className="grid grid-cols-2 gap-2">
    {(Object.keys(SCHOOL_TYPES) as Section[]).map((k) => (
      <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
        className={cx('rounded-xl border p-3 text-left transition', value === k ? 'border-brand-600 ring-[3px] ring-brand-600/15 dark:border-brand-400 dark:ring-brand-400/15' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20')}>
        <span className="block text-sm font-semibold text-slate-900 dark:text-white">{SCHOOL_TYPES[k].label.replace(' school', '')}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{SCHOOL_TYPES[k].levels}</span>
      </button>
    ))}
  </div>
);

// --------------------------------------------------- link opened elsewhere --
export function LinkEmail() {
  const { finishEmailLink } = useAuth();
  const [email, setEmail] = useState('');
  const [type, setType] = useState<Section>('secondary');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const owner = isOwnerEmail(email);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await finishEmailLink(email, owner ? undefined : type); } catch (x) { setErr(friendlyAuthError(x)); setBusy(false); }
  };
  return (
    <Frame aside={<PaperAside title="Nearly in" lines={['Confirm your email', 'Your demo opens', 'Good for one day']} />}>
      <Badge><MailCheck size={22} /></Badge>
      <H1>Confirm your email</H1>
      <Lead>You opened the sign-in link on a different device or browser. Type the email it was sent to.</Lead>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <Field label="Email"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {!owner && <Field label="If this is a new demo, which kind of school?"><TypePicker value={type} onChange={setType} /></Field>}
        {err && <Notice>{err}</Notice>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Continue</Button>
      </form>
    </Frame>
  );
}

// ---------------------------------------------------- demo day is over ------
export function DemoEnded() {
  const { locked, application, requestFullAccess, cancelApplication, logout } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', schoolName: '', phone: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!locked) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await requestFullAccess(f); } catch (x) { setErr(friendlyAuthError(x)); }
    setBusy(false);
  };
  const leave = async () => { await logout(); nav('/login'); };

  if (application) return <ApplicationStatus onLeave={leave} onCancel={cancelApplication} />;

  return (
    <Frame aside={<PaperAside title="Your demo" lines={['Lasted one day', 'Everything you added is kept', 'Musa OS can turn it into your real school']} />}>
      <Badge><Lock size={21} /></Badge>
      <H1>Your demo has ended</H1>
      <Lead>Demos last one day. Your classes, learners and marks are kept — ask for full access and, once the Musa OS team approves, this becomes your real school.</Lead>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <Field label="Your full name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Mrs R. Moyo" /></Field>
        <Field label="Your school’s name"><Input required value={f.schoolName} onChange={(e) => setF({ ...f, schoolName: e.target.value })} placeholder="e.g. Greenfield High School" /></Field>
        <Field label="Phone or WhatsApp"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0772 123 456" /></Field>
        <Field label="Anything we should know? (optional)"><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} className="min-h-[64px]" /></Field>
        {err && <Notice>{err}</Notice>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>Ask for full access</Button>
      </form>
      <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">Signed in as {locked.email}. <button onClick={leave} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Sign out</button></p>
    </Frame>
  );
}

// ----------------------------------------------- waiting for the owners -----
function ApplicationStatus({ onLeave, onCancel }: { onLeave: () => void; onCancel: () => Promise<void> }) {
  const { application } = useAuth();
  if (!application) return null;
  const declined = application.status === 'declined';
  const approved = application.status === 'approved';
  return (
    <Frame aside={<PaperAside title={declined ? 'Not approved' : 'Application sent'} lines={declined ? ['Check your details', 'Contact Musa OS'] : ['Sent to the Musa OS team', 'Usually approved within a day', 'This page opens your school by itself']} />}>
      <Badge pulse={!declined && !approved}>{declined ? <XCircle size={22} /> : approved ? <Check size={22} /> : <Clock size={22} />}</Badge>
      <H1>{declined ? 'Your application wasn’t approved' : approved ? 'Approved — opening your school' : 'Waiting for approval'}</H1>
      <Lead>
        {declined
          ? <>The Musa OS team didn’t approve <b className="text-slate-800 dark:text-slate-200">{application.schoolName}</b>. If you think that’s a mistake, get in touch and apply again.</>
          : <>Your application for <b className="text-slate-800 dark:text-slate-200">{application.schoolName}</b> is with the Musa OS team. Keep this page open, or sign in again later — your school opens as soon as it’s approved.</>}
      </Lead>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-slate-500 dark:text-slate-400">{application.kind === 'upgrade' ? 'Keeping your demo school' : `${SCHOOL_TYPES[application.schoolType].label} · ${SCHOOL_TYPES[application.schoolType].levels}`}</p>
        <p className="font-semibold text-slate-900 dark:text-white">{application.name} · {application.email}</p>
      </div>
      <div className="mt-6 flex gap-2">
        {!approved && <Button variant="outline" onClick={async () => { await onCancel(); }}>{declined ? 'Start again' : 'Withdraw application'}</Button>}
        <Button variant="ghost" onClick={onLeave}>Sign out</Button>
      </div>
    </Frame>
  );
}

/** Shown after applying for a brand-new school. */
export function ApplicationPending() {
  const { logout, cancelApplication } = useAuth();
  const nav = useNavigate();
  return <ApplicationStatus onLeave={async () => { await logout(); nav('/login'); }} onCancel={async () => { await cancelApplication(); nav('/login'); }} />;
}

// -------------------------------------------------------- owners' sign-in ---
export function OwnerSignIn() {
  const { sendOwnerLink, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await sendOwnerLink(email); setSent(true); } catch (x) { setErr(friendlyAuthError(x)); }
    setBusy(false);
  };
  return (
    <Frame aside={<PaperAside title="Musa OS console" lines={['Approve new schools', 'See every demo', 'Extend or end a demo']} />}>
      <Badge><Lock size={21} /></Badge>
      <H1>Owner sign-in</H1>
      {sent ? (
        <Lead>We’ve emailed a sign-in link to <b className="text-slate-800 dark:text-slate-200">{email}</b>. Open it on this device to get into the console. Check spam if it isn’t there in a minute.</Lead>
      ) : (
        <>
          <Lead>For the Musa OS team only. We’ll email you a one-time sign-in link.</Lead>
          {!configured ? <div className="mt-6"><Notice>Firebase isn’t set up in this build.</Notice></div> : (
            <form onSubmit={submit} className="mt-7 space-y-4">
              <Field label="Owner email"><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              {err && <Notice>{err}</Notice>}
              <Button type="submit" size="lg" className="w-full" loading={busy}>Email me a sign-in link</Button>
            </form>
          )}
        </>
      )}
    </Frame>
  );
}
