import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {GraduationCap, LogOut, Menu, Moon, Sun, X, Search, ChevronDown, FlaskConical} from 'lucide-react';
import { navFor } from '../nav';
import { useAuth, useSettings } from '../context/AuthContext';
import { ROLE_LABELS, Role } from '../types';
import { Avatar, Badge } from './ui';
import { MusaMark } from './Logo';
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

const Sidebar: React.FC<{ onNavigate?: () => void }> = ({ onNavigate }) => {
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
                    {i.badge && <span className="rounded bg-marigold-400/15 px-1.5 py-px text-[10px] font-bold text-marigold-300">{i.badge}</span>}
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

export const Layout: React.FC = () => {
  const { profile } = useAuth();
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
        <Sidebar />
      </aside>
      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-[90] lg:hidden">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-2xl animate-slide-up">
            <button onClick={() => setDrawer(false)} aria-label="Close menu" className="absolute right-3 top-5 z-10 rounded-lg p-2 text-white/60"><X size={18} /></button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
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
      </div>
    </div>
  );
};
