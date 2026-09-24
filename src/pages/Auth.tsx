import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Moon, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button, Field, Input } from '../components/ui';
import { useTheme } from '../components/Layout';
import { MusaLogo } from '../components/Logo';
import { SCHOOL_TYPES } from '../lib/defaults';
import { Section } from '../types';
import { cx } from '../lib/utils';

function friendly(e: any): string {
  const c = e?.code as string | undefined;
  if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found') return 'Incorrect email or password.';
  if (c === 'auth/invalid-email') return 'That email address doesn’t look right.';
  if (c === 'auth/email-already-in-use') return 'An account with this email already exists. Sign in instead.';
  if (c === 'auth/weak-password') return 'Use a password of at least 6 characters.';
  if (c === 'auth/too-many-requests') return 'Too many attempts. Wait a few minutes and try again.';
  if (c === 'auth/network-request-failed') return 'No connection. Check your internet and try again.';
  if (c === 'auth/operation-not-allowed') return 'Email sign-in is not enabled for this Firebase project yet.';
  if (c === 'permission-denied' || /insufficient permissions/i.test(e?.message ?? '')) return 'The database refused the request. Make sure the Firestore security rules are deployed.';
  return e?.message ?? 'Something went wrong. Please try again.';
}

// --------------------------------------------------------------- frame --
const Frame: React.FC<{ children: React.ReactNode; aside: React.ReactNode }> = ({ children, aside }) => {
  const { dark, toggle } = useTheme();
  return (
    <div className="grid min-h-screen bg-paper-50 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] dark:bg-ink-900">
      <div className="flex min-h-screen flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/login" aria-label="Musa OS home"><MusaLogo size={32} /></Link>
          <button onClick={toggle} aria-label="Toggle theme" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
        </div>
        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">{children}</main>
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">Musa OS · School management from ECD to A-Level</p>
      </div>
      <aside className="relative hidden overflow-hidden bg-brand-950 lg:block dark:bg-[#0a1a14]">{aside}</aside>
    </div>
  );
};

/** Right-hand panel: a single sheet of ruled paper on the dark green desk. */
const PaperAside: React.FC<{ title: string; lines: string[] }> = ({ title, lines }) => (
  <div className="absolute inset-0 flex items-center justify-center p-12">
    <div aria-hidden="true" className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:22px_22px]" />
    <div className="paper relative w-full max-w-[440px] rotate-[-1.5deg] rounded-[4px] bg-[#fdfcf7] px-10 pb-10 pt-12 text-[#1f2a26] shadow-[0_40px_80px_-30px_rgba(0,0,0,.7)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,#dfe6ee_31px,#dfe6ee_32px)] [background-position:0_40px]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-8 w-px bg-[#e8a3a3]" />
      <div className="relative pl-2">
        <p className="font-serif text-[22px] font-bold leading-[32px] tracking-tight">{title}</p>
        <ul className="mt-2">
          {lines.map((l, i) => (
            <li key={l} style={{ animationDelay: `${300 + i * 220}ms` }} className="flex animate-ink items-center gap-3 font-hand text-[18px] leading-[32px] text-[#1d3a8a]">
              <span className="text-[#1f7a45]">✓</span>{l}
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);

const Notice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p role="alert" className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">{children}</p>
);

const PasswordInput: React.FC<{ value: string; onChange: (v: string) => void; autoComplete: string }> = ({ value, onChange, autoComplete }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input type={show ? 'text' : 'password'} autoComplete={autoComplete} minLength={6} required value={value} onChange={(e) => onChange(e.target.value)} className="pr-10" />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
    </div>
  );
};

const NotConfigured: React.FC = () => (
  <Notice>Sign-in isn’t available yet: this copy of Musa OS has no Firebase project keys. Add them to the <code>.env</code> file and rebuild.</Notice>
);

// -------------------------------------------------------------- sign in --
export function SignIn() {
  const { login, resetPassword, error: authError, configured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try { await login(email, password); } catch (x) { setErr(friendly(x)); setBusy(false); }
  };
  const forgot = async () => {
    setErr(null); setInfo(null);
    if (!email.trim()) { setErr('Type your email above first, then press “Forgot password?”.'); return; }
    try { await resetPassword(email); setInfo(`We’ve sent a reset link to ${email.trim()}.`); } catch (x) { setErr(friendly(x)); }
  };

  return (
    <Frame aside={<PaperAside title="Today at school" lines={['Registers marked by 08:00', 'Test 2 marks in the gradebook', 'Fees receipted and emailed', 'Reports ready for parents']} />}>
      <h1 className="font-display text-[2rem] font-bold tracking-[-0.03em] text-slate-900 dark:text-white">Welcome back</h1>
      <p className="mt-1.5 text-[15px] text-slate-500 dark:text-slate-400">Sign in with the email your school registered for you.</p>
      {!configured ? <div className="mt-8"><NotConfigured /></div> : (
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Email"><Input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@school.co.zw" /></Field>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label !mb-0">Password</span>
              <button type="button" onClick={forgot} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">Forgot password?</button>
            </div>
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
          </div>
          {(err || authError) && <Notice>{err || authError}</Notice>}
          {info && <Notice>{info}</Notice>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
        </form>
      )}
      <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
        Setting up a new school? <Link to="/signup" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Create an account</Link>
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-400 dark:text-slate-500">Teachers, parents and learners get their login from the school office — they don’t need to sign up.</p>
    </Frame>
  );
}

// -------------------------------------------------------------- sign up --
export function SignUp() {
  const { registerSchool, configured } = useAuth();
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<Section | null>(null);
  const [f, setF] = useState({ schoolName: '', name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!type) { setStep(1); return; }
    setErr(null); setBusy(true);
    try { await registerSchool({ ...f, schoolName: f.schoolName.trim(), name: f.name.trim(), schoolType: type }); nav('/', { replace: true }); }
    catch (x) { setErr(friendly(x)); setBusy(false); }
  };

  const aside = type === 'primary'
    ? <PaperAside title="Your primary school" lines={['ECD A to Grade 7 classes', 'Primary grading scale', '10 primary subjects to start', 'Registers, fees and reports']} />
    : type === 'secondary'
      ? <PaperAside title="Your secondary school" lines={['Form 1 to Form 6 classes', 'O-Level and A-Level grading', '17 ZIMSEC subjects to start', 'AceGrader for marking scripts']} />
      : <PaperAside title="New school checklist" lines={['Choose primary or secondary', 'Name your school', 'Create the admin login', 'Invite staff and parents']} />;

  return (
    <Frame aside={aside}>
      <div className="mb-6 flex items-center gap-2 text-xs font-medium text-slate-400">
        <span className={cx(step === 1 ? 'text-slate-900 dark:text-white' : '')}>1 · School type</span>
        <span className="h-px w-6 bg-slate-300 dark:bg-white/15" />
        <span className={cx(step === 2 ? 'text-slate-900 dark:text-white' : '')}>2 · Your details</span>
      </div>

      {step === 1 ? (
        <>
          <h1 className="font-display text-[2rem] font-bold leading-tight tracking-[-0.03em] text-slate-900 dark:text-white">What kind of school is it?</h1>
          <p className="mt-1.5 text-[15px] text-slate-500 dark:text-slate-400">This sets up the right classes, subjects and grading. You can change it later in Settings.</p>
          <div role="radiogroup" aria-label="School type" className="mt-7 space-y-3">
            {(Object.keys(SCHOOL_TYPES) as Section[]).map((k) => {
              const t = SCHOOL_TYPES[k];
              const on = type === k;
              return (
                <button key={k} type="button" role="radio" aria-checked={on} onClick={() => setType(k)}
                  className={cx('flex w-full items-start gap-4 rounded-xl border bg-white p-4 text-left transition dark:bg-white/[0.03]',
                    on ? 'border-brand-600 ring-[3px] ring-brand-600/15 dark:border-brand-400 dark:ring-brand-400/15' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20')}>
                  <span className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] transition',
                    on ? 'border-brand-700 bg-brand-700 text-white dark:border-brand-400 dark:bg-brand-400 dark:text-ink-950' : 'border-slate-300 dark:border-white/25')}>
                    {on && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-display text-[16px] font-semibold tracking-tight text-slate-900 dark:text-white">{t.label}</span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">{t.levels}</span>
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-slate-500 dark:text-slate-400">{t.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <Button size="lg" className="mt-6 w-full" disabled={!type} onClick={() => setStep(2)} icon={<ArrowRight size={16} />}>Continue</Button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => { setStep(1); setErr(null); }} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"><ArrowLeft size={15} /> {type && SCHOOL_TYPES[type].label}</button>
          <h1 className="font-display text-[2rem] font-bold leading-tight tracking-[-0.03em] text-slate-900 dark:text-white">Create your school</h1>
          <p className="mt-1.5 text-[15px] text-slate-500 dark:text-slate-400">You’ll be the administrator. You can add staff, parents and learners once you’re in.</p>
          {!configured ? <div className="mt-8"><NotConfigured /></div> : (
            <form onSubmit={submit} className="mt-7 space-y-4">
              <Field label="School name"><Input required autoFocus value={f.schoolName} onChange={set('schoolName')} placeholder={type === 'primary' ? 'e.g. Chipo Junior School' : 'e.g. Greenfield High School'} /></Field>
              <Field label="Your full name"><Input required autoComplete="name" value={f.name} onChange={set('name')} placeholder="e.g. Mrs R. Moyo" /></Field>
              <Field label="Email"><Input type="email" required autoComplete="email" value={f.email} onChange={set('email')} placeholder="head@school.co.zw" /></Field>
              <Field label="Password" hint="At least 6 characters"><PasswordInput value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" /></Field>
              {err && <Notice>{err}</Notice>}
              <Button type="submit" size="lg" className="w-full" loading={busy}>Create school</Button>
            </form>
          )}
        </>
      )}
      <p className="mt-8 text-sm text-slate-500 dark:text-slate-400">
        Already have an account? <Link to="/signin" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">Sign in</Link>
      </p>
    </Frame>
  );
}
