import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {AlertTriangle, Award, Download, Plus, ShieldAlert, Star, ThumbsDown, ThumbsUp, Trash2, Trophy} from 'lucide-react';
import { Incident } from '../types';
import { useAuth, useSettings } from '../context/AuthContext';
import { store, useCollection, useIndex } from '../lib/store';
import { useCan, useClasses } from '../lib/hooks';
import { currentTerm, cx, download, fmtDate, fullName, staffName, studentMatches, toCSV, todayISO } from '../lib/utils';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Segmented, Select, StatCard, TableWrap, Textarea, useUI } from '../components/ui';

const MERIT_CATS = ['Academic excellence', 'Leadership', 'Community service', 'Sportsmanship', 'Helpfulness', 'Good attendance', 'Creativity'];
const DEMERIT_CATS = ['Late coming', 'Incomplete homework', 'Improper uniform', 'Disruptive behaviour', 'Bunking lessons', 'Bullying', 'Use of phone', 'Vandalism'];
const ACTIONS = ['Verbal warning', 'Detention', 'Parent notified', 'Litter duty', 'Referred to HOD', 'Referred to Head', 'Certificate awarded', 'Assembly recognition'];

type Draft = { studentId: string; sq: string; kind: 'merit' | 'demerit'; category: string; custom: string; description: string; action: string; points: string; date: string };

export default function Conduct() {
  const { profile } = useAuth();
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const can = useCan('incidents');
  const isAdmin = profile?.role === 'admin';
  const { data: incidents } = useCollection('incidents');
  const { data: students } = useCollection('students');
  const studentIdx = useIndex('students');
  const staff = useIndex('staff');
  const classes = useClasses();
  const classIdx = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const term = currentTerm(settings);
  const today = todayISO();

  const [classId, setClassId] = useState('');
  const [kind, setKind] = useState<'all' | 'merit' | 'demerit'>('all');
  const [from, setFrom] = useState(term?.start ?? '');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // ---- term stats
  const termInc = useMemo(() => incidents.filter((i) => !term || (i.date >= term.start && i.date <= term.end)), [incidents, term]);
  const termStats = useMemo(() => {
    const merits = termInc.filter((i) => i.kind === 'merit');
    const dem = termInc.filter((i) => i.kind === 'demerit');
    const perStudent = new Map<string, number>();
    dem.forEach((i) => perStudent.set(i.studentId, (perStudent.get(i.studentId) ?? 0) + 1));
    return {
      merits: merits.length, demerits: dem.length,
      net: termInc.reduce((a, i) => a + (i.points || 0), 0),
      repeat: [...perStudent.values()].filter((n) => n >= 3).length,
    };
  }, [termInc]);

  // ---- filtered log
  const rows = useMemo(() => incidents.filter((i) => {
    const s = studentIdx.get(i.studentId);
    if (classId && s?.classId !== classId) return false;
    if (kind !== 'all' && i.kind !== kind) return false;
    if (from && i.date < from) return false;
    if (to && i.date > to) return false;
    if (q) {
      const hay = `${s ? `${s.firstName} ${s.lastName} ${s.admissionNo}` : ''} ${i.category} ${i.description} ${i.action ?? ''}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0)), [incidents, studentIdx, classId, kind, from, to, q]);

  // ---- leaderboard/watchlist (respect class + date filters, ignore kind/search)
  const scoped = useMemo(() => incidents.filter((i) => {
    const s = studentIdx.get(i.studentId);
    return (!classId || s?.classId === classId) && (!from || i.date >= from) && (!to || i.date <= to);
  }), [incidents, studentIdx, classId, from, to]);
  const perStudent = useMemo(() => {
    const m = new Map<string, { id: string; merit: number; demerit: number; meritPts: number; demeritPts: number }>();
    scoped.forEach((i) => {
      const e = m.get(i.studentId) ?? { id: i.studentId, merit: 0, demerit: 0, meritPts: 0, demeritPts: 0 };
      if (i.kind === 'merit') { e.merit++; e.meritPts += i.points || 0; } else { e.demerit++; e.demeritPts += i.points || 0; }
      m.set(i.studentId, e);
    });
    return [...m.values()];
  }, [scoped]);
  const leaders = useMemo(() => perStudent.filter((p) => p.meritPts + p.demeritPts > 0).sort((a, b) => (b.meritPts + b.demeritPts) - (a.meritPts + a.demeritPts) || b.merit - a.merit).slice(0, 10), [perStudent]);
  const watch = useMemo(() => perStudent.filter((p) => p.demerit > 0).sort((a, b) => b.demerit - a.demerit || a.demeritPts - b.demeritPts).slice(0, 10), [perStudent]);

  // ---- add
  const openNew = (studentId = '') => setDraft({ studentId, sq: '', kind: 'merit', category: MERIT_CATS[0]!, custom: '', description: '', action: '', points: '1', date: today });
  const setKindDraft = (k: 'merit' | 'demerit') => setDraft((d) => d && ({ ...d, kind: k, category: (k === 'merit' ? MERIT_CATS : DEMERIT_CATS)[0]!, points: k === 'merit' ? '1' : '-1' }));
  const pickerOptions = useMemo(() => (draft && !draft.studentId
    ? students.filter((s) => s.status === 'active' && studentMatches(s, draft.sq)).sort((a, b) => a.lastName.localeCompare(b.lastName)).slice(0, 8) : []), [students, draft]);

  const save = async () => {
    if (!draft) return;
    const category = draft.category === '__custom' ? draft.custom.trim() : draft.category;
    if (!draft.studentId) { toast('Choose a learner', 'error'); return; }
    if (!category) { toast('Enter a category', 'error'); return; }
    if (!draft.description.trim()) { toast('Add a short description', 'error'); return; }
    let pts = parseInt(draft.points, 10);
    if (!Number.isFinite(pts)) pts = draft.kind === 'merit' ? 1 : -1;
    pts = draft.kind === 'merit' ? Math.abs(pts) : -Math.abs(pts);
    setSaving(true);
    try {
      const data: Omit<Incident, 'id'> = { studentId: draft.studentId, date: draft.date || today, kind: draft.kind, category, description: draft.description.trim(), points: pts };
      if (draft.action.trim()) data.action = draft.action.trim();
      const by = profile?.staffId ?? profile?.id;
      if (by) data.recordedBy = by;
      await store.add('incidents', data);
      toast(`${draft.kind === 'merit' ? 'Merit' : 'Demerit'} recorded for ${fullName(studentIdx.get(draft.studentId))}`);
      setDraft(null);
    } catch (e: any) { toast(e.message ?? 'Could not save', 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (i: Incident) => {
    if (!(await confirm({ title: 'Delete this record?', body: `${i.category} — ${fullName(studentIdx.get(i.studentId))}`, confirmText: 'Delete', danger: true }))) return;
    await store.remove('incidents', i.id);
    toast('Record deleted', 'info');
  };

  const exportCSV = () => download(`conduct-${today}.csv`, toCSV(rows.map((i) => {
    const s = studentIdx.get(i.studentId);
    return { Date: i.date, 'Admission No': s?.admissionNo ?? '', Learner: fullName(s), Class: classIdx.get(s?.classId ?? '')?.name ?? '', Kind: i.kind, Category: i.category, Description: i.description, Action: i.action ?? '', Points: i.points, 'Recorded by': staffName(staff.get(i.recordedBy ?? '')) };
  })));

  const selStudent = draft?.studentId ? studentIdx.get(draft.studentId) : undefined;
  const cats = draft?.kind === 'demerit' ? DEMERIT_CATS : MERIT_CATS;

  return (
    <div>
      <PageHeader eyebrow="Pastoral care" title="Conduct" subtitle="Merits, demerits and behaviour trends across the school."
        actions={can && <Button variant="secondary" icon={<Plus size={16} />} onClick={() => openNew()}>Record incident</Button>} />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Merits this term" value={termStats.merits} icon={<ThumbsUp size={18} />} tone="green" onClick={() => setKind('merit')} />
        <StatCard label="Demerits this term" value={termStats.demerits} icon={<ThumbsDown size={18} />} tone="rose" onClick={() => setKind('demerit')} />
        <StatCard label="Net points" value={termStats.net > 0 ? `+${termStats.net}` : termStats.net} sub={term?.name} icon={<Star size={18} />} tone={termStats.net >= 0 ? 'brand' : 'amber'} />
        <StatCard label="3+ demerits" value={termStats.repeat} sub="learners this term" icon={<ShieldAlert size={18} />} tone={termStats.repeat ? 'amber' : 'green'} />
      </div>

      <Card className="mb-5" bodyClass="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_auto_150px_150px_1fr] lg:items-end">
          <Field label="Class">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">All classes</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <div><span className="label">Kind</span><Segmented value={kind} onChange={setKind} options={[{ id: 'all', label: 'All' }, { id: 'merit', label: 'Merits' }, { id: 'demerit', label: 'Demerits' }]} /></div>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Search"><SearchInput value={q} onChange={setQ} placeholder="Learner, category…" /></Field>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Card title="Incident log" subtitle={`${rows.length} record${rows.length === 1 ? '' : 's'}`} className="min-w-0"
          actions={<Button size="sm" variant="outline" icon={<Download size={13} />} onClick={exportCSV} disabled={!rows.length}>CSV</Button>}>
          {rows.length === 0 ? <EmptyState title="No records match" icon={<Award size={22} />} /> : (
            <TableWrap>
              <thead><tr><th className="th pl-5">Date</th><th className="th">Learner</th><th className="th">Class</th><th className="th">Kind</th><th className="th">Category / description</th><th className="th">Action</th><th className="th text-right">Pts</th><th className="th">Recorded by</th>{isAdmin && <th className="th pr-5" />}</tr></thead>
              <tbody>
                {rows.map((i) => {
                  const s = studentIdx.get(i.studentId);
                  return (
                    <tr key={i.id} className="tr tr-hover">
                      <td className="td whitespace-nowrap pl-5 text-xs text-slate-500 dark:text-slate-400">{fmtDate(i.date, { day: 'numeric', month: 'short' })}</td>
                      <td className="td whitespace-nowrap">{s ? <Link to={`/students/${s.id}`} className="font-semibold text-slate-800 hover:underline dark:text-slate-100">{fullName(s)}</Link> : <span className="text-slate-400">Unknown</span>}</td>
                      <td className="td whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{classIdx.get(s?.classId ?? '')?.name ?? '—'}</td>
                      <td className="td">{i.kind === 'merit' ? <Badge tone="green"><ThumbsUp size={10} /> Merit</Badge> : <Badge tone="red"><ThumbsDown size={10} /> Demerit</Badge>}</td>
                      <td className="td max-w-[260px]"><p className="font-medium text-slate-800 dark:text-slate-100">{i.category}</p><p className="truncate text-xs text-slate-500 dark:text-slate-400" title={i.description}>{i.description}</p></td>
                      <td className="td text-xs text-slate-500 dark:text-slate-400">{i.action ?? '—'}</td>
                      <td className={cx('td text-right font-bold tabular-nums', i.points > 0 ? 'text-brand-600 dark:text-brand-400' : i.points < 0 ? 'text-rose-600 dark:text-rose-400' : '')}>{i.points > 0 ? `+${i.points}` : i.points}</td>
                      <td className="td whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{staffName(staff.get(i.recordedBy ?? ''))}</td>
                      {isAdmin && <td className="td pr-5 text-right"><button onClick={() => remove(i)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Delete"><Trash2 size={14} /></button></td>}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><Trophy size={15} className="text-slate-400 dark:text-slate-400" /> Leaderboard</span>} subtitle="Top 10 by net merit points" bodyClass="p-0">
            {leaders.length === 0 ? <p className="px-5 py-6 text-center text-sm text-slate-400">No merits yet.</p> : (
              <ol className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {leaders.map((p, idx) => {
                  const s = studentIdx.get(p.id);
                  const net = p.meritPts + p.demeritPts;
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className={cx('w-5 text-center text-xs font-bold', idx === 0 ? 'text-marigold-500 dark:text-marigold-300' : idx === 1 ? 'text-slate-400' : idx === 2 ? 'text-marigold-600 dark:text-marigold-300' : 'text-slate-400')}>{idx + 1}</span>
                      <Avatar name={fullName(s)} size={30} />
                      <div className="min-w-0 flex-1">
                        {s ? <Link to={`/students/${s.id}`} className="block truncate text-sm font-semibold text-slate-800 hover:underline dark:text-slate-100">{fullName(s)}</Link> : <span className="text-sm text-slate-400">Unknown</span>}
                        <p className="text-[11px] text-slate-400">{classIdx.get(s?.classId ?? '')?.name} · {p.merit} merit{p.merit === 1 ? '' : 's'}</p>
                      </div>
                      <Badge tone="green">+{net}</Badge>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
          <Card title={<span className="flex items-center gap-2"><AlertTriangle size={15} className="text-rose-500 dark:text-rose-300" /> Watchlist</span>} subtitle="Most demerits" bodyClass="p-0">
            {watch.length === 0 ? <p className="px-5 py-6 text-center text-sm text-slate-400">No demerits recorded.</p> : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {watch.map((p) => {
                  const s = studentIdx.get(p.id);
                  return (
                    <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Avatar name={fullName(s)} size={30} />
                      <div className="min-w-0 flex-1">
                        {s ? <Link to={`/students/${s.id}`} className="block truncate text-sm font-semibold text-slate-800 hover:underline dark:text-slate-100">{fullName(s)}</Link> : <span className="text-sm text-slate-400">Unknown</span>}
                        <p className="text-[11px] text-slate-400">{classIdx.get(s?.classId ?? '')?.name} · {p.demeritPts} pts</p>
                      </div>
                      <Badge tone={p.demerit >= 3 ? 'red' : 'amber'}>{p.demerit} demerit{p.demerit === 1 ? '' : 's'}</Badge>
                      {can && <button onClick={() => { openNew(p.id); }} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" title="Record incident"><Plus size={14} /></button>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title="Record incident" size="lg"
        footer={<><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button loading={saving} variant={draft?.kind === 'demerit' ? 'danger' : 'success'} onClick={save}>Save {draft?.kind}</Button></>}>
        {draft && (
          <div className="space-y-4">
            <div>
              <span className="label">Learner</span>
              {selStudent ? (
                <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 dark:border-white/10 dark:bg-white/[0.06]">
                  <Avatar name={fullName(selStudent)} size={32} />
                  <div className="flex-1"><p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{fullName(selStudent)}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{selStudent.admissionNo} · {classIdx.get(selStudent.classId)?.name}</p></div>
                  <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, studentId: '' })}>Change</Button>
                </div>
              ) : (
                <>
                  <SearchInput value={draft.sq} onChange={(v) => setDraft({ ...draft, sq: v })} placeholder="Search by name or admission no…" />
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {pickerOptions.map((s) => (
                      <li key={s.id}>
                        <button onClick={() => setDraft({ ...draft, studentId: s.id })} className="flex w-full items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]">
                          <Avatar name={fullName(s)} size={26} />
                          <span className="min-w-0"><span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{fullName(s)}</span><span className="block text-[11px] text-slate-400">{s.admissionNo} · {classIdx.get(s.classId)?.name}</span></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <span className="label">Kind</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button type="button" onClick={() => setKindDraft('merit')} className={cx('flex items-center justify-center gap-1.5 rounded-xl border-2 py-2 text-sm font-semibold transition', draft.kind === 'merit' ? 'border-slate-200 bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400')}><ThumbsUp size={14} /> Merit</button>
                  <button type="button" onClick={() => setKindDraft('demerit')} className={cx('flex items-center justify-center gap-1.5 rounded-xl border-2 py-2 text-sm font-semibold transition', draft.kind === 'demerit' ? 'border-slate-200 bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'border-slate-200 text-slate-500 dark:border-white/10 dark:text-slate-400')}><ThumbsDown size={14} /> Demerit</button>
                </div>
              </div>
              <Field label="Date"><Input type="date" max={today} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
              <Field label="Points" hint={draft.kind === 'merit' ? 'Positive' : 'Negative'}><Input type="number" value={draft.points} onChange={(e) => setDraft({ ...draft, points: e.target.value })} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category" required>
                <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="__custom">Other (custom)…</option>
                </Select>
              </Field>
              {draft.category === '__custom' ? (
                <Field label="Custom category" required><Input autoFocus value={draft.custom} onChange={(e) => setDraft({ ...draft, custom: e.target.value })} /></Field>
              ) : (
                <Field label="Action taken">
                  <Input list="conduct-actions" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} placeholder="e.g. Detention" />
                </Field>
              )}
            </div>
            {draft.category === '__custom' && (
              <Field label="Action taken"><Input list="conduct-actions" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} placeholder="e.g. Detention" /></Field>
            )}
            <datalist id="conduct-actions">{ACTIONS.map((a) => <option key={a} value={a} />)}</datalist>
            <Field label="Description" required><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What happened?" /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
