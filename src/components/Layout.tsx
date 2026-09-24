import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {GraduationCap, LogOut, Menu, Moon, Sun, X, Search, ChevronDown, FlaskConical} from 'lucide-react';
import { navFor } from '../nav';
import { useAuth, useSettings } from '../context/AuthContext';
import { ROLE_LABELS, Role } from '../types';
import { Avatar, Badge, useUI } from './ui';
import { MusaMark } from './Logo';
import { Tour, restartTour } from './Tour';
import { usePendingRequests } from '../lib/joinRequests';
import { cx, currentTerm, fullName } from '../lib/utils';
import { useCollection, useIndex } from '../lib/store';
import { isStaffRole } from '../lib/permissions';

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const d = !dark;
    setDark(d);
    document.documentElement.classList.toggle('dark', d);
    try { localStorage.setItem('ace-theme', d ? 'dark' : 'light'); } catch { /* ignore */ }
  };
  return { dark, toggle };
}

const Brand: React.FC<{ name?: string }> = ({ name }) => (
  <div className="flex items-center gap-3">
    <MusaMark size={38} />
    <div className="min-w-0">
      <span className="line-clamp-2 block font-display text-[15px] font-bold leading-tight tracking-tight text-white">{name || 'Musa OS'}</span>
      <span className="block text-[11px] font-semibold text-white/45">Musa<span className="text-brand-400">OS</span></span>
    </div>
  </div>
);

const Sidebar: React.FC<{ onNavigate?: () => void; requests?: number }> = ({ onNavigate, requests = 0 }) => {
  const { profile, logout } = useAuth();
  const settings = useSettings();
  const groups = navFor(profile!.role);
  return (
    <div className="flex h-full flex-col bg-brand-950 text-white dark:bg-ink-950">
      <div className="px-4 pb-5 pt-5"><Brand name={settings?.name} /></div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6" aria-label="Main">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/35">{g.label}</p>
            <div className="space-y-px">
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={onNavigate}
                  className={({ isActive }) => cx('group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] font-medium transition',
                    isActive ? 'bg-white/[0.09] text-white' : 'text-white/65 hover:bg-white/[0.05] hover:text-white')}>
                  {({ isActive }) => (<>
                    {isActive && <span className="absolute -left-3 top-1.5 bottom-1.5 w-[3px] rounded-r bg-white/70" />}
                    <i.icon size={16} className={cx('shrink-0', isActive ? 'text-white' : 'text-white/45 group-hover:text-white/80')} />
                    <span className="flex-1 truncate">{i.label}</span>
                    {i.to === '/setup' && requests > 0
                      ? <span className="min-w-[18px] rounded-full bg-marigold-400 px-1.5 py-px text-center text-[10px] font-bold text-slate-900" aria-label={`${requests} requests`}>{requests}</span>
                      : i.badge && <span className="rounded bg-marigold-400/15 px-1.5 py-px text-[10px] font-bold text-marigold-300">{i.badge}</span>}
                  </>)}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/[0.08] p-3">
        <div className="flex items-center gap-3 rounded-lg p-2">
          <Avatar name={profile!.name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">{profile!.name}</p>
            <p className="truncate text-[11px] text-white/50">{ROLE_LABELS[profile!.role]}</p>
          </div>
          <button onClick={() => logout()} title="Sign out" aria-label="Sign out" className="rounded-md p-1.5 text-white/45 hover:bg-white/10 hover:text-white"><LogOut size={15} /></button>
        </div>
      </div>
    </div>
  );
};

const QuickSearch: React.FC = () => {
  const { data: students } = useCollection('students');
  const classes = useIndex('classes');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); ref.current?.querySelector('input')?.focus(); } };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const t = q.toLowerCase();
    return students.filter((s) => `${s.firstName} ${s.lastName} ${s.admissionNo}`.toLowerCase().includes(t)).slice(0, 8);
  }, [q, students]);
  return (
    <div ref={ref} className="relative hidden w-full max-w-sm md:block">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Find a student…  (Ctrl K)"
        className="input h-9 bg-white pl-9 dark:bg-white/[0.04]" />
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-11 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/10 dark:bg-ink-700">
          {results.map((s) => (
            <button key={s.id} onClick={() => { nav(`/students/${s.id}`); setOpen(false); setQ(''); }} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5">
              <Avatar name={fullName(s)} size={28} />
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fullName(s)}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{s.admissionNo} · {classes.get(s.classId)?.name ?? '—'}</p></div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const VIEW_AS: { role: Role; label: string }[] = [
  { role: 'admin', label: 'Head / admin' }, { role: 'teacher', label: 'Teacher' }, { role: 'bursar', label: 'Bursar' },
  { role: 'parent', label: 'Parent' }, { role: 'student', label: 'Learner' },
];

/** Strip across the top of a demo school: whose view you're in, switch it, restart or leave. */
const DemoBar: React.FC<{ onTour: () => void }> = ({ onTour }) => {
  const { profile, endDemo, switchRole, configured } = useAuth();
  const { toast, confirm } = useUI();
  const nav = useNavigate();
  const { data: students } = useCollection('students');
  const { data: staff } = useCollection('staff');
  const [busy, setBusy] = useState(false);

  const change = async (role: Role) => {
    if (!profile || role === profile.role) return;
    let v: Parameters<typeof switchRole>[0] = { role };
    if (role === 'parent' || role === 'student') {
      const own = profile.studentIds?.filter(Boolean) ?? [];
      const pool = own.length ? own : students.filter((s) => s.status === 'active').map((s) => s.id);
      const ids = pool.slice(0, role === 'parent' ? 2 : 1);
      if (!ids.length) { toast('Enrol a learner first — then you can see the school as their parent or as the learner.', 'error'); return; }
      const classIds = [...new Set(ids.map((id) => students.find((s) => s.id === id)?.classId).filter(Boolean) as string[])];
      v = { role, studentIds: ids, classIds: classIds.length ? classIds : profile.classIds ?? [] };
    } else if (role === 'teacher' || role === 'bursar') {
      const pick = profile.staffId ?? staff.find((s) => s.status !== 'left')?.id;
      v = { role, staffId: pick };
    }
    setBusy(true);
    try { await switchRole(v); nav('/'); toast(`Now viewing as ${VIEW_AS.find((x) => x.role === role)!.label.toLowerCase()}`); }
    catch (e: any) { toast(e?.message ?? 'Could not switch view', 'error'); }
    setBusy(false);
  };

  const leave = async (to: string) => {
    const ok = await confirm({
      title: 'Leave the demo?',
      body: configured ? 'You’ll be signed out of this demo account on this device, and it can’t be reopened afterwards.' : 'The demo school in this browser will be deleted.',
      confirmText: 'Leave demo', danger: true,
    });
    if (!ok) return;
    await endDemo(); nav(to);
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 bg-brand-950 px-4 py-2 text-center text-[13px] text-white/80 dark:bg-ink-950 dark:text-white/70 no-print">
      <span><b className="font-semibold text-white">Demo school</b> · {configured ? 'your own demo account — changes are saved' : 'saved in this browser'}</span>
      <label className="flex items-center gap-2">
        <span className="text-white/60">View as</span>
        <span className="relative">
          <select value={profile?.role} disabled={busy} onChange={(e) => change(e.target.value as Role)} aria-label="View the demo school as"
            className="appearance-none rounded-md bg-white/10 py-1 pl-2.5 pr-7 text-[13px] font-semibold text-white outline-none hover:bg-white/15 focus:ring-2 focus:ring-white/30 disabled:opacity-60 [&>option]:text-slate-900">
            {VIEW_AS.map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/70" />
        </span>
      </label>
      <span className="flex items-center gap-3">
        {profile?.role === 'admin' && <button onClick={onTour} className="font-semibold text-white underline-offset-4 hover:underline">Restart tour</button>}
        <button onClick={() => leave('/signup')} className="font-semibold text-marigold-300 underline-offset-4 hover:underline">Create my real school</button>
        <button onClick={() => leave('/login')} className="text-white/60 underline-offset-4 hover:text-white hover:underline">Leave</button>
      </span>
    </div>
  );
};

export const Layout: React.FC = () => {
  const { profile, mode, endDemo } = useAuth();
  const nav = useNavigate();
  const [tourKey, setTourKey] = useState(0);
  const requests = usePendingRequests(profile);
  const { toast } = useUI();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    // tell the head when someone new asks to join (not for the ones already waiting on load)
    const ids = new Set(requests.map((r) => r.id));
    if (seen.current) requests.filter((r) => !seen.current!.has(r.id)).forEach((r) => toast(`${r.name} asked to join as ${ROLE_LABELS[r.role].toLowerCase()} — see Get started`));
    seen.current = ids;
  }, [requests, toast]);
  const settings = useSettings();
  const { dark, toggle } = useTheme();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => { setDrawer(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const term = currentTerm(settings);

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 lg:block dark:border-r dark:border-white/[0.07]">
        <Sidebar requests={requests.length} />
      </aside>
      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[90] lg:hidden">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl animate-slide-up">
            <button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-3 top-5 z-10 rounded-lg p-2 text-white/60"><X size={18} /></button>
            <Sidebar requests={requests.length} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        {mode === 'demo' && <DemoBar onTour={() => { restartTour(); setTourKey((k) => k + 1); nav('/'); }} />}
        <header className="app-header sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-paper-50/85 px-4 backdrop-blur-md md:px-8 dark:border-white/[0.06] dark:bg-ink-900/85 no-print">
          <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-white/5 dark:text-slate-400" aria-label="Open menu"><Menu size={20} /></button>
          {profile && isStaffRole(profile.role) ? <QuickSearch /> : <div className="flex-1" />}
          <div className="ml-auto flex items-center gap-2">
            {term && <Badge tone="blue" className="hidden md:inline-flex">{term.name}</Badge>}
            <button onClick={toggle} className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5" aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
          </div>
        </header>
        <main className="mx-auto max-w-[1360px] px-4 py-6 md:px-8 md:py-9">
          <Outlet />
        </main>
        {mode === 'demo' && profile?.role === 'admin' && <Tour key={tourKey} onFinish={async () => { await endDemo(); nav('/signup'); }} />}
      </div>
    </div>
  );
};
