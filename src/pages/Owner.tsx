// The Musa OS owners' console: approve school applications the moment they arrive,
// and see, extend or end every demo.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteField, doc, onSnapshot, updateDoc, writeBatch } from 'firebase/firestore';
import { Bell, Check, Clock, LogOut, Moon, School, Sun, TimerReset, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Button, Card, Tabs, useUI } from '../components/ui';
import { MusaLogo } from '../components/Logo';
import { useTheme } from '../components/Layout';
import { getFirebase } from '../lib/firebase';
import { makeJoinCode, newSchoolSettings, SCHOOL_TYPES, starterSubjects } from '../lib/defaults';
import { DEMO_MS, timeLeft } from '../lib/owner';
import { friendlyAuthError } from '../lib/authErrors';
import { SchoolRequest, Section, UserProfile } from '../types';
import { cx, fmtDate } from '../lib/utils';

interface SchoolDoc { id: string; name: string; schoolType?: Section; ownerUid?: string; createdAt?: number; demo?: boolean; demoExpiresAt?: number; demoEmail?: string }

const when = (t?: number) => (t ? `${fmtDate(new Date(t).toISOString().slice(0, 10))} ${new Date(t).toTimeString().slice(0, 5)}` : '—');

function useLive<T>(path: string): T[] {
  const [list, setList] = useState<T[]>([]);
  useEffect(() => {
    const { db } = getFirebase();
    return onSnapshot(collection(db, path), (s) => setList(s.docs.map((d) => ({ ...(d.data() as any), id: d.id }))), (e) => console.warn(path, e));
  }, [path]);
  return list;
}

/** Create the real school for a brand-new application, or turn a demo into a real school. */
async function approve(r: SchoolRequest) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  if (r.kind === 'upgrade' && r.schoolId) {
    b.update(doc(db, 'schools', r.schoolId), { demo: deleteField(), demoExpiresAt: deleteField(), name: r.schoolName, approvedAt: Date.now() });
    b.update(doc(db, 'schools', r.schoolId, 'settings', 'main'), { name: r.schoolName });
    b.update(doc(db, 'users', r.uid), { demo: deleteField(), demoExpiresAt: deleteField(), role: 'admin', name: r.name });
    b.update(doc(db, 'schoolRequests', r.uid), { status: 'approved', decidedAt: Date.now() });
    await b.commit();
    return;
  }
  const schoolId = `sch-${r.uid.slice(0, 10).toLowerCase()}`;
  const joinCode = makeJoinCode();
  b.set(doc(db, 'schools', schoolId), { name: r.schoolName, schoolType: r.schoolType, ownerUid: r.uid, createdAt: Date.now(), approvedAt: Date.now() });
  b.set(doc(db, 'schools', schoolId, 'settings', 'main'), { ...newSchoolSettings(r.schoolName, r.schoolType), joinCode, ...(r.phone ? { phone: r.phone } : {}) });
  b.set(doc(db, 'schoolCodes', joinCode), { schoolId, name: r.schoolName, createdAt: Date.now() });
  for (const s of starterSubjects(r.schoolType)) b.set(doc(db, 'schools', schoolId, 'subjects', s.id), s);
  const p: UserProfile = { id: r.uid, name: r.name, email: r.email, role: 'admin', schoolId, createdAt: Date.now() };
  b.set(doc(db, 'users', r.uid), p);
  b.update(doc(db, 'schoolRequests', r.uid), { status: 'approved', decidedAt: Date.now() });
  await b.commit();
}

async function setDemoEnd(s: SchoolDoc, until: number) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  b.update(doc(db, 'schools', s.id), { demoExpiresAt: until });
  if (s.ownerUid) b.update(doc(db, 'users', s.ownerUid), { demoExpiresAt: until });
  await b.commit();
}

export default function OwnerConsole() {
  const { owner, logout } = useAuth();
  const { toast } = useUI();
  const { dark, toggle } = useTheme();
  const requests = useLive<SchoolRequest>('schoolRequests');
  const schools = useLive<SchoolDoc>('schools');
  const [tab, setTab] = useState<'requests' | 'demos' | 'schools'>('requests');
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);

  const pending = useMemo(() => requests.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt - b.createdAt), [requests]);
  const decided = useMemo(() => requests.filter((r) => r.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0)).slice(0, 20), [requests]);
  const demos = useMemo(() => schools.filter((s) => s.demo).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), [schools]);
  const real = useMemo(() => schools.filter((s) => !s.demo).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), [schools]);

  // new applications: toast + desktop notification + tab title count
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(pending.map((r) => r.id));
    if (seen.current) {
      pending.filter((r) => !seen.current!.has(r.id)).forEach((r) => {
        toast(`New application: ${r.schoolName} (${r.name})`);
        try { if (Notification.permission === 'granted') new Notification('New school application', { body: `${r.schoolName} — ${r.name}`, icon: '/icon-192.png' }); } catch { /* ignore */ }
      });
    }
    seen.current = ids;
    document.title = pending.length ? `(${pending.length}) Musa OS console` : 'Musa OS console';
  }, [pending, toast]);
  const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'default';

  const act = async (key: string, fn: () => Promise<void>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); } catch (e) { toast(friendlyAuthError(e), 'error'); }
    setBusy(null);
  };
  const decline = (r: SchoolRequest) => act(`no-${r.id}`, async () => { await updateDoc(doc(getFirebase().db, 'schoolRequests', r.uid), { status: 'declined', decidedAt: Date.now() }); }, `Declined ${r.schoolName}`);

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-ink-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-paper-50/85 backdrop-blur-md dark:border-white/[0.06] dark:bg-ink-900/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-6">
          <MusaLogo size={30} />
          <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white dark:bg-white dark:text-slate-900">Console</span>
          <div className="ml-auto flex items-center gap-2">
            {canNotify && <Button size="sm" variant="outline" icon={<Bell size={14} />} onClick={() => Notification.requestPermission().then(() => tick((n) => n + 1))}>Notify me</Button>}
            <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">{owner?.email}</span>
            <button onClick={toggle} aria-label="Toggle theme" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <button onClick={() => logout()} aria-label="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"><LogOut size={17} /></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[['Waiting for you', pending.length], ['Demos running', demos.filter((d) => (d.demoExpiresAt ?? 0) > Date.now()).length], ['Real schools', real.length]].map(([k, v]) => (
            <div key={k as string} className="card p-4"><p className="text-xs text-slate-500 dark:text-slate-400">{k}</p><p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{v}</p></div>
          ))}
        </div>

        <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
          { id: 'requests', label: <span className="flex items-center gap-2">Applications {pending.length > 0 && <span className="rounded-full bg-marigold-400 px-1.5 text-[11px] font-bold text-slate-900">{pending.length}</span>}</span> },
          { id: 'demos', label: `Demos (${demos.length})` },
          { id: 'schools', label: `Schools (${real.length})` },
        ]} />

        {tab === 'requests' && (
          <div className="space-y-4">
            {pending.length === 0 && (
              <div className="card flex items-center gap-3 p-5 text-sm text-slate-500 dark:text-slate-400">
                <span className="relative flex h-2.5 w-2.5"><span className="absolute inset-0 animate-ping rounded-full bg-brand-500/50" /><span className="relative h-2.5 w-2.5 rounded-full bg-brand-500" /></span>
                No applications waiting — new ones appear here the moment they’re sent.
              </div>
            )}
            {pending.map((r) => (
              <div key={r.id} className="card animate-slide-up p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200"><School size={19} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[17px] font-semibold tracking-tight text-slate-900 dark:text-white">{r.schoolName}
                      <span className="ml-2 align-middle text-xs font-medium text-slate-500 dark:text-slate-400">{r.kind === 'upgrade' ? 'keep their demo' : `${SCHOOL_TYPES[r.schoolType].label} · ${SCHOOL_TYPES[r.schoolType].levels}`}</span></p>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{r.name} · {r.email}{r.phone ? ` · ${r.phone}` : ''}</p>
                    <p className="text-xs text-slate-400">Sent {when(r.createdAt)}</p>
                    {r.message && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:bg-white/[0.04] dark:text-slate-200">“{r.message}”</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" icon={<X size={14} />} loading={busy === `no-${r.id}`} disabled={!!busy} onClick={() => decline(r)}>Decline</Button>
                    <Button size="sm" icon={<Check size={14} />} loading={busy === `ok-${r.id}`} disabled={!!busy} onClick={() => act(`ok-${r.id}`, () => approve(r), `${r.schoolName} approved — ${r.name} can sign in now`)}>Approve</Button>
                  </div>
                </div>
              </div>
            ))}
            {decided.length > 0 && (
              <Card title="Recently decided">
                <ul className="divide-y divide-slate-100 text-sm dark:divide-white/[0.06]">
                  {decided.map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2"><span>{r.schoolName} <span className="text-slate-400">· {r.email}</span></span>
                      <span className={cx('text-xs font-semibold', r.status === 'approved' ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500')}>{r.status} {when(r.decidedAt)}</span></li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}

        {tab === 'demos' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr><th className="th">Email</th><th className="th">School</th><th className="th">Started</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {demos.map((d) => {
                  const live = (d.demoExpiresAt ?? 0) > Date.now();
                  return (
                    <tr key={d.id} className="tr">
                      <td className="td font-medium">{d.demoEmail || '(old demo)'}</td>
                      <td className="td">{d.name}</td>
                      <td className="td text-slate-500">{when(d.createdAt)}</td>
                      <td className="td"><span className={cx('inline-flex items-center gap-1.5 text-xs font-semibold', live ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500')}>
                        <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'bg-brand-500' : 'bg-slate-400')} />{live ? timeLeft(d.demoExpiresAt) : `ended ${when(d.demoExpiresAt)}`}</span></td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" icon={<TimerReset size={14} />} disabled={!!busy} onClick={() => act(`x-${d.id}`, () => setDemoEnd(d, Math.max(Date.now(), d.demoExpiresAt ?? 0) + DEMO_MS), 'Demo extended by a day')}>+1 day</Button>
                          {live && <Button size="sm" variant="ghost" icon={<Clock size={14} />} disabled={!!busy} onClick={() => act(`e-${d.id}`, () => setDemoEnd(d, Date.now() - 1000), 'Demo ended')}>End now</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!demos.length && <tr><td colSpan={5} className="td text-center text-slate-500">No demos yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'schools' && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr><th className="th">School</th><th className="th">Type</th><th className="th">Created</th><th className="th">Id</th></tr></thead>
              <tbody>
                {real.map((s) => (
                  <tr key={s.id} className="tr"><td className="td font-medium">{s.name}</td><td className="td">{s.schoolType ? SCHOOL_TYPES[s.schoolType].label : '—'}</td><td className="td text-slate-500">{when(s.createdAt)}</td><td className="td font-mono text-xs text-slate-400">{s.id}</td></tr>
                ))}
                {!real.length && <tr><td colSpan={4} className="td text-center text-slate-500">No schools approved yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
