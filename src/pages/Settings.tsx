import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SchoolCrest, logoFromFile } from '../components/SchoolCrest';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import {ImageUp, Building2, CalendarRange, Award, KeyRound, Database, Plus, Trash2, Download, Upload, RotateCcw, Save, UserPlus, PenLine, CheckCircle2, XCircle} from 'lucide-react';
import { useAuth, useSettings } from '../context/AuthContext';
import { store, useCollection, useIndex } from '../lib/store';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Tabs, TableWrap, useUI } from '../components/ui';
import { ALL_COLLECTIONS, CollectionName, GradeBand, ROLE_LABELS, Role, SchoolSettings, ScaleKey, Term, UserProfile } from '../types';
import { DEFAULT_SCALES, cx, download, fmtDate, fullName, staffName } from '../lib/utils';
import { getSecondaryAuth } from '../lib/firebase';
import { WriteOp } from '../lib/backend';
import { aiAvailable } from '../lib/acegrader/engine';

type TabId = 'school' | 'terms' | 'grading' | 'users' | 'data';

export default function SettingsPage() {
  const settings = useSettings();
  const [tab, setTab] = useState<TabId>('school');
  if (!settings) return <><PageHeader title="Settings" /><EmptyState title="Settings not loaded" /></>;
  return (
    <div className="animate-fade-in">
      <PageHeader title="Settings" subtitle="School profile, academic calendar, grading, user access and data." />
      <Tabs className="mb-6" value={tab} onChange={setTab} tabs={[
        { id: 'school', label: <span className="flex items-center gap-2"><Building2 size={15} />School</span> },
        { id: 'terms', label: <span className="flex items-center gap-2"><CalendarRange size={15} />Terms & periods</span> },
        { id: 'grading', label: <span className="flex items-center gap-2"><Award size={15} />Grading</span> },
        { id: 'users', label: <span className="flex items-center gap-2"><KeyRound size={15} />Users & access</span> },
        { id: 'data', label: <span className="flex items-center gap-2"><Database size={15} />Data</span> },
      ]} />
      {tab === 'school' && <SchoolTab s={settings} />}
      {tab === 'terms' && <TermsTab s={settings} />}
      {tab === 'grading' && <GradingTab s={settings} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'data' && <DataTab />}
    </div>
  );
}

function useDraft<T>(initial: T) {
  const [d, setD] = useState(initial);
  useEffect(() => setD(initial), [initial]);
  return [d, setD] as const;
}

/** Upload, replace or remove the school's logo. Saved straight away (small image kept with the school). */
const LogoCard: React.FC<{ s: SchoolSettings }> = ({ s }) => {
  const { toast } = useUI();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try { const logo = await logoFromFile(file); await store.update('settings', 'main', { logo }); toast('Logo saved'); }
    catch (e: any) { toast(e?.message ?? 'Could not save the logo', 'error'); }
    setBusy(false);
  };
  const remove = async () => { setBusy(true); try { await store.update('settings', 'main', { logo: null as any }); toast('Logo removed'); } catch (e: any) { toast(e.message, 'error'); } setBusy(false); };
  return (
    <Card title="School logo" subtitle="Shown on report cards, receipts, statements and the menu">
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}
        className={cx('flex items-center gap-4 rounded-xl border border-dashed p-4 transition', drag ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-400/5' : 'border-slate-300 dark:border-white/15')}>
        <div className="paper flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200 dark:ring-white/10">
          <SchoolCrest settings={s} size={64} className="text-slate-800" />
        </div>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-slate-900 dark:text-white">{s.logo ? 'Your logo' : 'No logo yet'}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">PNG with a clear background works best. Drop it here or choose a file.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => ref.current?.click()} loading={busy} icon={<ImageUp size={14} />}>{s.logo ? 'Replace' : 'Upload logo'}</Button>
            {s.logo && <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>Remove</Button>}
          </div>
        </div>
      </div>
    </Card>
  );
};

const SchoolTab: React.FC<{ s: SchoolSettings }> = ({ s }) => {
  const { toast } = useUI();
  const [d, setD] = useDraft(s);
  const [busy, setBusy] = useState(false);
  const f = (k: keyof SchoolSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value });
  const save = async () => { setBusy(true); try { await store.update('settings', 'main', { name: d.name, motto: d.motto, address: d.address, phone: d.phone, email: d.email, website: d.website, headName: d.headName, ...(d.schoolType ? { schoolType: d.schoolType } : {}) }); toast('School profile saved'); } catch (e: any) { toast(e.message, 'error'); } setBusy(false); };
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card title="School profile" subtitle="Appears on report cards, invoices and receipts" className="lg:col-span-2"
        actions={<Button onClick={save} loading={busy} icon={<Save size={15} />}>Save</Button>}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="School name" required><Input value={d.name} onChange={f('name')} /></Field>
          <Field label="Motto"><Input value={d.motto} onChange={f('motto')} /></Field>
          <Field label="School type" hint="Sets which levels appear when you create classes and fee structures">
            <Select value={d.schoolType ?? ''} onChange={(e) => setD({ ...d, schoolType: (e.target.value || undefined) as SchoolSettings['schoolType'] })}>
              {!d.schoolType && <option value="">Not set — show every level</option>}
              <option value="primary">Primary · ECD A – Grade 7</option>
              <option value="secondary">Secondary · Form 1 – Form 6</option>
            </Select>
          </Field>
          <Field label="Address" className="md:col-span-2"><Input value={d.address} onChange={f('address')} /></Field>
          <Field label="Phone"><Input value={d.phone} onChange={f('phone')} /></Field>
          <Field label="Email"><Input value={d.email} onChange={f('email')} /></Field>
          <Field label="Website"><Input value={d.website ?? ''} onChange={f('website')} /></Field>
          <Field label="Head's name (signs reports)"><Input value={d.headName} onChange={f('headName')} /></Field>
        </div>
      </Card>
      <div className="space-y-6">
        <LogoCard s={s} />
        <Card title="Letterhead preview">
          <div className="paper rounded-xl border border-dashed border-slate-300 bg-white p-4 text-center dark:border-white/15">
            <div className="mb-2 flex justify-center"><SchoolCrest settings={{ ...s, name: d.name || s.name }} size={48} className="text-slate-800" /></div>
            <p className="font-display tracking-tight text-xl font-bold">{d.name || 'School name'}</p>
            {d.motto && <p className="text-xs italic text-slate-500 dark:text-slate-400">“{d.motto}”</p>}
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{[d.address, d.phone, d.email].filter(Boolean).join(' · ')}</p>
          </div>
        </Card>
        <Card title="AceGrader">
          <div className="flex items-start gap-3 text-sm">
            {aiAvailable ? <CheckCircle2 className="shrink-0 text-brand-500 dark:text-brand-300" size={18} /> : <XCircle className="shrink-0 text-marigold-500 dark:text-marigold-300" size={18} />}
            <div>
              <p className="font-semibold">{aiAvailable ? 'Full marking on' : 'Quick marking mode'}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{aiAvailable ? 'AceGrader reads typed, photographed and scanned scripts and marks them against your rubrics.' : 'Typed scripts get an estimated mark. To read handwritten and scanned scripts, add the marking service key (VITE_GEMINI_API_KEY) to the deployment settings.'}</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

const TermsTab: React.FC<{ s: SchoolSettings }> = ({ s }) => {
  const { toast } = useUI();
  const [terms, setTerms] = useDraft(s.terms);
  const [current, setCurrent] = useDraft(s.currentTermId);
  const [periods, setPeriods] = useDraft(s.periodTimes);
  const [busy, setBusy] = useState(false);
  const upd = (i: number, patch: Partial<Term>) => setTerms(terms.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const addTerm = () => {
    const last = terms[terms.length - 1];
    const number = last ? (last.number % 3) + 1 : 1;
    const year = last ? (last.number === 3 ? last.year + 1 : last.year) : new Date().getFullYear();
    setTerms([...terms, { id: `${year}-T${number}`, name: `Term ${number} ${year}`, year, number, start: '', end: '' }]);
  };
  const save = async () => {
    if (terms.some((t) => !t.start || !t.end || t.start > t.end)) { toast('Every term needs a valid start and end date', 'error'); return; }
    if (new Set(terms.map((t) => t.id)).size !== terms.length) { toast('Term ids must be unique', 'error'); return; }
    setBusy(true);
    try {
      const sorted = [...terms].sort((a, b) => a.start.localeCompare(b.start));
      await store.update('settings', 'main', { terms: sorted, currentTermId: sorted.some((t) => t.id === current) ? current : sorted[sorted.length - 1]!.id, periodTimes: periods, periodsPerDay: periods.length });
      toast('Academic calendar saved');
    } catch (e: any) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card title="Academic terms" subtitle="The current term drives dashboards, registers, marks and billing" className="lg:col-span-2"
        actions={<><Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={addTerm}>Add term</Button><Button size="sm" onClick={save} loading={busy} icon={<Save size={14} />}>Save</Button></>}>
        <div className="space-y-3">
          {terms.map((t, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-3 rounded-xl border border-slate-100 p-3 md:grid-cols-[1.5fr_1fr_1fr_auto_auto] dark:border-white/[0.06]">
              <Field label="Name"><Input value={t.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
              <Field label="Opens"><Input type="date" value={t.start} onChange={(e) => upd(i, { start: e.target.value })} /></Field>
              <Field label="Closes"><Input type="date" value={t.end} onChange={(e) => upd(i, { end: e.target.value })} /></Field>
              <label className="flex h-10 items-center gap-2 text-sm"><input type="radio" checked={current === t.id} onChange={() => setCurrent(t.id)} /> Current</label>
              <Button variant="ghost" size="sm" onClick={() => setTerms(terms.filter((_, j) => j !== i))} aria-label="Remove term"><Trash2 size={15} /></Button>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Daily periods" subtitle="Used by the timetable" actions={<Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={() => setPeriods([...periods, ''])}>Add</Button>}>
        <div className="space-y-2">
          {periods.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-16 text-xs font-semibold text-slate-500 dark:text-slate-400">Period {i + 1}</span>
              <Input value={p} onChange={(e) => setPeriods(periods.map((x, j) => (j === i ? e.target.value : x)))} placeholder="07:30–08:10" />
              <Button variant="ghost" size="sm" onClick={() => setPeriods(periods.filter((_, j) => j !== i))}><Trash2 size={14} /></Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

const SCALE_LABEL: Record<ScaleKey, string> = { primary: 'ECD & Primary (Grades 1–7)', olevel: 'O-Level (Forms 1–4)', alevel: 'A-Level (Forms 5–6)' };

const GradingTab: React.FC<{ s: SchoolSettings }> = ({ s }) => {
  const { toast } = useUI();
  const [scales, setScales] = useDraft(s.scales);
  const [pass, setPass] = useDraft(s.passMark);
  const upd = (k: ScaleKey, i: number, patch: Partial<GradeBand>) => setScales({ ...scales, [k]: scales[k].map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const save = async () => {
    try { await store.update('settings', 'main', { scales, passMark: pass }); toast('Grading scales saved'); } catch (e: any) { toast(e.message, 'error'); }
  };
  return (
    <div className="space-y-6">
      <Card title="General" actions={<Button size="sm" onClick={save} icon={<Save size={14} />}>Save all</Button>}>
        <div className="max-w-xs"><Field label="Pass mark (%)" hint="Used for pass-rate statistics"><Input type="number" min={0} max={100} value={pass} onChange={(e) => setPass(Number(e.target.value))} /></Field></div>
      </Card>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {(Object.keys(SCALE_LABEL) as ScaleKey[]).map((k) => (
          <Card key={k} title={SCALE_LABEL[k]} actions={<>
            <Button variant="ghost" size="sm" onClick={() => setScales({ ...scales, [k]: DEFAULT_SCALES[k] })}>Reset</Button>
            <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={() => setScales({ ...scales, [k]: [...scales[k], { grade: '', min: 0, remark: '' }] })}>Band</Button>
          </>}>
            <div className="space-y-2">
              <div className="grid grid-cols-[60px_70px_1fr_32px] gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"><span>Grade</span><span>From %</span><span>Remark</span><span /></div>
              {[...scales[k]].map((b, i) => (
                <div key={i} className="grid grid-cols-[60px_70px_1fr_32px] gap-2">
                  <Input value={b.grade} onChange={(e) => upd(k, i, { grade: e.target.value })} />
                  <Input type="number" value={b.min} onChange={(e) => upd(k, i, { min: Number(e.target.value) })} />
                  <Input value={b.remark} onChange={(e) => upd(k, i, { remark: e.target.value })} />
                  <button className="text-slate-400 hover:text-rose-500" onClick={() => setScales({ ...scales, [k]: scales[k].filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ users --
const UsersTab: React.FC = () => {
  const { mode, profile } = useAuth();
  const { toast, confirm } = useUI();
  const { data: users } = useCollection('users');
  const staff = useIndex('staff');
  const { data: staffList } = useCollection('staff');
  const { data: students } = useCollection('students');
  const studentIdx = useIndex('students');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ name: string; email: string; password: string; role: Role; staffId: string; studentIds: string[] }>({ name: '', email: '', password: '', role: 'teacher', staffId: '', studentIds: [] });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => q.length < 2 ? [] : students.filter((s) => `${s.firstName} ${s.lastName} ${s.admissionNo}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6), [q, students]);

  const create = async () => {
    if (!form.name || !form.email) { toast('Name and email are required', 'error'); return; }
    if ((form.role === 'parent' || form.role === 'student') && !form.studentIds.length) { toast('Link at least one learner', 'error'); return; }
    setBusy(true);
    try {
      let uid = `u-${Date.now().toString(36)}`;
      if (mode === 'firebase') {
        if (form.password.length < 6) throw new Error('Temporary password must be at least 6 characters');
        const sec = getSecondaryAuth();
        const cred = await createUserWithEmailAndPassword(sec, form.email, form.password);
        uid = cred.user.uid;
        await signOut(sec);
      }
      const classIds = [...new Set(form.studentIds.map((id) => studentIdx.get(id)?.classId).filter(Boolean) as string[])];
      const p: UserProfile = {
        id: uid, name: form.name, email: form.email, role: form.role, schoolId: profile!.schoolId,
        staffId: ['admin', 'teacher', 'bursar'].includes(form.role) ? form.staffId || undefined : undefined,
        studentIds: ['parent', 'student'].includes(form.role) ? form.studentIds : undefined,
        classIds: classIds.length ? classIds : undefined,
      };
      await store.set('users', p);
      toast(mode === 'firebase' ? `Account created. Share the temporary password with ${form.name}.` : 'User added');
      setOpen(false);
      setForm({ name: '', email: '', password: '', role: 'teacher', staffId: '', studentIds: [] });
    } catch (e: any) {
      toast(e.code === 'auth/email-already-in-use' ? 'That email already has an account' : e.message, 'error');
    }
    setBusy(false);
  };

  const refreshClassLinks = async () => {
    const ops: WriteOp[] = users.filter((u) => u.studentIds?.length).map((u) => ({
      op: 'update', col: 'users', id: u.id,
      data: { classIds: [...new Set(u.studentIds!.map((id) => studentIdx.get(id)?.classId).filter(Boolean) as string[])] },
    }));
    await store.commit(ops);
    toast('Parent & student class links refreshed');
  };

  return (
    <div className="space-y-6">
      <Card title="User accounts" subtitle="Everyone who can sign in to this school"
        actions={<>
          <Button variant="outline" size="sm" onClick={refreshClassLinks}>Refresh class links</Button>
          <Button size="sm" icon={<UserPlus size={14} />} onClick={() => setOpen(true)}>Add user</Button>
        </>} bodyClass="p-0 pt-0">
        <div className="px-5"><TableWrap>
          <thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Linked to</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="tr">
                <td className="td font-medium">{u.name}</td>
                <td className="td text-slate-500 dark:text-slate-400">{u.email}</td>
                <td className="td"><Badge tone={u.role === 'admin' ? 'violet' : u.role === 'teacher' ? 'blue' : u.role === 'bursar' ? 'green' : 'slate'}>{ROLE_LABELS[u.role]}</Badge></td>
                <td className="td text-xs text-slate-500 dark:text-slate-400">{u.staffId ? staffName(staff.get(u.staffId)) : u.studentIds?.map((id) => fullName(studentIdx.get(id))).join(', ') || '—'}</td>
                <td className="td">{u.disabled ? <Badge tone="red">Disabled</Badge> : <Badge tone="green">Active</Badge>}</td>
                <td className="td text-right">
                  {u.id !== profile?.id && (
                    <Button variant="ghost" size="sm" onClick={async () => {
                      if (await confirm({ title: u.disabled ? 'Enable account?' : 'Disable account?', body: u.disabled ? `${u.name} will be able to sign in again.` : `${u.name} will no longer be able to sign in.`, danger: !u.disabled }))
                        await store.update('users', u.id, { disabled: !u.disabled });
                    }}>{u.disabled ? 'Enable' : 'Disable'}</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap></div>
      </Card>
      <Card title="What each role can do">
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2 xl:grid-cols-5">
          {([
            ['admin', 'Everything: records, staff, classes, timetable, finance, publishing reports, settings.'],
            ['teacher', 'Registers, gradebook, report remarks, AceGrader, conduct, library, announcements. No fee data.'],
            ['bursar', 'Fee structures, invoices, payments, receipts, debtors. Read-only academic data.'],
            ['parent', 'Their own children only: results, published reports, attendance, fees, timetable, notices.'],
            ['student', 'Own timetable, published reports, results, fees, announcements.'],
          ] as [Role, string][]).map(([r, d]) => (
            <div key={r} className="rounded-xl border border-slate-100 p-3 dark:border-white/[0.06]"><p className="font-semibold">{ROLE_LABELS[r]}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{d}</p></div>
          ))}
        </div>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Add user"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={create} loading={busy}>Create account</Button></>}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Role" required>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          {['admin', 'teacher', 'bursar'].includes(form.role) && (
            <Field label="Staff record">
              <Select value={form.staffId} onChange={(e) => {
                const s = staff.get(e.target.value);
                setForm({ ...form, staffId: e.target.value, name: form.name || (s ? `${s.title} ${s.firstName} ${s.lastName}` : ''), email: form.email || s?.email || '' });
              }}>
                <option value="">— none —</option>
                {staffList.map((s) => <option key={s.id} value={s.id}>{s.title} {s.firstName} {s.lastName} · {s.position}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Full name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          {mode === 'firebase' && <Field label="Temporary password" required hint="They can change it with “Forgot password”"><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}
          {['parent', 'student'].includes(form.role) && (
            <div className="md:col-span-2">
              <Field label={form.role === 'parent' ? 'Children' : 'Learner record'}>
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search learner by name or admission no." />
              </Field>
              {matches.length > 0 && (
                <div className="mt-1 rounded-xl border border-slate-200 dark:border-white/10">
                  {matches.map((s) => (
                    <button key={s.id} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-white/5"
                      onClick={() => { setForm({ ...form, studentIds: form.role === 'student' ? [s.id] : [...new Set([...form.studentIds, s.id])], name: form.name || (form.role === 'student' ? fullName(s) : s.guardians[0]?.name ?? ''), email: form.email || (form.role === 'parent' ? s.guardians[0]?.email ?? '' : '') }); setQ(''); }}>
                      <span>{fullName(s)}</span><span className="text-xs text-slate-500 dark:text-slate-400">{s.admissionNo}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {form.studentIds.map((id) => <Badge key={id} tone="blue">{fullName(studentIdx.get(id))} <button onClick={() => setForm({ ...form, studentIds: form.studentIds.filter((x) => x !== id) })}>×</button></Badge>)}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

// ------------------------------------------------------------------- data --
const DataTab: React.FC = () => {
  const { profile } = useAuth();
  const { toast, confirm } = useUI();
  const [busy, setBusy] = useState<string | null>(null);
  const counts = ALL_COLLECTIONS.map((c) => [c, store.peek(c).length] as const);

  const exportAll = () => {
    const data: Record<string, any[]> = {};
    for (const c of ALL_COLLECTIONS) data[c] = store.peek(c);
    download(`musa-os-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, exportedAt: Date.now(), data }), 'application/json');
  };

  // force-load every collection so export is complete
  ALL_COLLECTIONS.forEach((c) => useCollection(c)); // eslint-disable-line react-hooks/rules-of-hooks

  const importAll = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      const data = json.data as Record<CollectionName, any[]>;
      if (!data?.settings) throw new Error('Not a Musa OS backup file');
      if (!(await confirm({ title: 'Restore backup?', body: `This writes ${Object.values(data).reduce((a, b) => a + b.length, 0)} records into the school. Existing records with the same ids are overwritten.`, confirmText: 'Restore', danger: true }))) return;
      setBusy('import');
      const ops: WriteOp[] = [];
      for (const [col, docs] of Object.entries(data) as [CollectionName, any[]][]) {
        if (!ALL_COLLECTIONS.includes(col)) continue;
        for (const d of docs) ops.push({ op: 'set', col, id: d.id, data: col === 'users' ? { ...d, schoolId: profile!.schoolId } : d });
      }
      await store.commit(ops);
      toast('Backup restored');
    } catch (e: any) { toast(e.message, 'error'); }
    setBusy(null);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card title="Records" className="lg:col-span-2" subtitle="Stored in Firebase Cloud Firestore">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {counts.map(([c, n]) => (
            <div key={c} className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/[0.03]"><p className="text-[11px] text-slate-500 dark:text-slate-400">{c}</p><p className="font-bold">{n.toLocaleString()}</p></div>
          ))}
        </div>
      </Card>
      <div className="space-y-6">
        <Card title="Backup & restore">
          <div className="space-y-3">
            <Button variant="outline" className="w-full" icon={<Download size={15} />} onClick={exportAll}>Download full backup (JSON)</Button>
            <label className="block">
              <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
              <span className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5">{busy === 'import' ? 'Restoring…' : <><Upload size={15} /> Restore from backup</>}</span>
            </label>
          </div>
        </Card>
        <p className="text-xs text-slate-400">Last loaded {fmtDate(Date.now())}</p>
      </div>
    </div>
  );
};
