import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {Copy, Library, ListChecks, PenLine, Plus, Trash2} from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Segmented, Select, Spinner, useUI } from '../../components/ui';
import { useAuth, useMyStaff } from '../../context/AuthContext';
import { useCan } from '../../lib/hooks';
import { newId, store, useCollection, useIndex } from '../../lib/store';
import { staffName } from '../../lib/utils';
import { rubricTotal } from '../../lib/acegrader/engine';
import { useRubricOwner } from '../../lib/acegrader/hooks';
import type { Rubric } from '../../types';

export default function RubricLibrary() {
  const { profile } = useAuth();
  const me = useMyStaff();
  const { toast, confirm } = useUI();
  const nav = useNavigate();
  const can = useCan('rubrics');
  const isOwner = useRubricOwner();
  const { data: rubrics, loading } = useCollection('rubrics');
  const { data: subs } = useCollection('submissions');
  const subjects = useIndex('subjects');
  const [q, setQ] = useState('');
  const [subject, setSubject] = useState('');
  const [scope, setScope] = useState<'all' | 'mine'>('all');

  const usage = useMemo(() => {
    const m = new Map<string, number>();
    subs.forEach((s) => m.set(s.rubricId, (m.get(s.rubricId) ?? 0) + 1));
    return m;
  }, [subs]);

  const usedSubjects = useMemo(() => [...new Set(rubrics.map((r) => r.subjectId).filter(Boolean) as string[])].map((id) => subjects.get(id)).filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name)), [rubrics, subjects]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rubrics
      .filter((r) => !subject || r.subjectId === subject)
      .filter((r) => scope === 'all' || r.ownerId === profile?.staffId)
      .filter((r) => !t || `${r.title} ${r.description} ${r.level ?? ''} ${r.ownerName ?? ''} ${r.criteria.map((c) => c.name).join(' ')}`.toLowerCase().includes(t))
      .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }, [rubrics, q, subject, scope, profile, usage]);

  const duplicate = async (r: Rubric) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = r;
    const id = newId();
    await store.set('rubrics', { ...rest, id, title: `${r.title} (copy)`, ownerId: profile?.staffId, ownerName: me ? staffName(me) : profile?.name });
    toast('Rubric duplicated');
    nav(`/acegrader/rubrics/${id}`);
  };
  const remove = async (r: Rubric) => {
    const n = usage.get(r.id) ?? 0;
    const ok = await confirm({ title: 'Delete rubric?', body: n ? `“${r.title}” has been used for ${n} marked script(s). Those submissions keep their results, but the rubric will no longer be available.` : `“${r.title}” will be permanently deleted.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    await store.remove('rubrics', r.id);
    toast('Rubric deleted');
  };

  return (
    <div>
      <PageHeader eyebrow="AceGrader" title="Rubric library" subtitle="Reusable marking schemes. AceGrader marks strictly against these criteria."
        actions={can && <Button icon={<Plus size={16} />} onClick={() => nav('/acegrader/rubrics/new')}>New rubric</Button>} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search rubrics, criteria, owners…" className="sm:max-w-xs sm:flex-1" />
        <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="sm:w-56">
          <option value="">All subjects</option>
          {usedSubjects.map((s) => <option key={s!.id} value={s!.id}>{s!.name}</option>)}
        </Select>
        <Segmented value={scope} onChange={setScope} options={[{ id: 'all', label: 'All' }, { id: 'mine', label: 'Mine' }]} />
      </div>
      {loading ? <Spinner /> : !list.length ? (
        <Card><EmptyState icon={<Library size={22} />} title={rubrics.length ? 'No rubrics match' : 'No rubrics yet'} body="Create a rubric from scratch or import an existing marking scheme with AI."
          action={can && <Button icon={<PenLine size={15} />} onClick={() => nav('/acegrader/rubrics/new')}>Create rubric</Button>} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => {
            const mine = isOwner(r.ownerId);
            const n = usage.get(r.id) ?? 0;
            return (
              <div key={r.id} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md">
                <Link to={`/acegrader/rubrics/${r.id}`} className="block flex-1">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {r.subjectId && <Badge tone="blue">{subjects.get(r.subjectId)?.name ?? 'Subject'}</Badge>}
                    {r.level && <Badge>{r.level}</Badge>}
                  </div>
                  <h3 className="font-display tracking-tight text-xl font-bold leading-snug text-slate-900 group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-300">{r.title}</h3>
                  {r.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{r.description}</p>}
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-paper-100/70 p-3 text-center dark:bg-white/[0.03]">
                    <div><p className="text-lg font-bold text-slate-900 dark:text-white">{r.criteria.length}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Criteria</p></div>
                    <div><p className="text-lg font-bold text-slate-900 dark:text-white">{rubricTotal(r)}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Marks</p></div>
                    <div><p className="text-lg font-bold text-slate-900 dark:text-white">{n}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Scripts</p></div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">By {r.ownerName ?? 'Unknown'}{r.ownerId === profile?.staffId && ' (you)'}</p>
                </Link>
                <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <Button size="sm" variant="secondary" icon={<PenLine size={13} />} onClick={() => nav(`/acegrader/mark?rubric=${r.id}`)}>Mark with this</Button>
                  <Button size="sm" variant="ghost" icon={<ListChecks size={13} />} onClick={() => nav(`/acegrader/rubrics/${r.id}`)}>{mine && can ? 'Edit' : 'View'}</Button>
                  {can && <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => duplicate(r)} title="Duplicate" aria-label="Duplicate" />}
                  {can && mine && <Button size="sm" variant="ghost" className="ml-auto text-rose-600 dark:text-rose-400" icon={<Trash2 size={13} />} onClick={() => remove(r)} title="Delete" aria-label="Delete" />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
