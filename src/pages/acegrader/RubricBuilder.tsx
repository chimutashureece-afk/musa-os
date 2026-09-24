import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {ArrowDown, ArrowLeft, ArrowUp, Copy, Lightbulb, PenLine, Plus, Save, Trash2, ListChecks} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea, useUI } from '../../components/ui';
import { useAuth, useMyStaff, useSettings } from '../../context/AuthContext';
import { useCan } from '../../lib/hooks';
import { newId, store, useCollection } from '../../lib/store';
import { levelsFor, cx, staffName } from '../../lib/utils';
import { aiAvailable, extractRubric, rubricTotal } from '../../lib/acegrader/engine';
import { useRubricOwner } from '../../lib/acegrader/hooks';
import type { Rubric, RubricCriterion } from '../../types';
import { FileDrop, FileChip, type DroppedFile } from './FileDrop';
import { AiChip } from './parts';

type Draft = Omit<Rubric, 'id'> & { id?: string };
const blank = (): Draft => ({ title: '', description: '', criteria: [{ name: '', maxPoints: 10, description: '' }], keyPointers: [], subjectId: '', level: '' });

export default function RubricBuilder() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const nav = useNavigate();
  const { profile } = useAuth();
  const me = useMyStaff();
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const can = useCan('rubrics');
  const isOwner = useRubricOwner();
  const { data: rubrics, loading } = useCollection('rubrics');
  const { data: subjects } = useCollection('subjects');
  const existing = isNew ? undefined : rubrics.find((r) => r.id === id);
  const editable = can && (isNew || isOwner(existing?.ownerId));

  const [draft, setDraft] = useState<Draft>(blank);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importFile, setImportFile] = useState<DroppedFile | null>(null);
  const [importing, setImporting] = useState(false);
  const [importOpen, setImportOpen] = useState(isNew);
  const [newPointer, setNewPointer] = useState('');

  useEffect(() => {
    if (existing && !dirty) setDraft({ ...existing, keyPointers: existing.keyPointers ?? [] });
  }, [existing]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (p: Partial<Draft>) => { setDraft((d) => ({ ...d, ...p })); setDirty(true); };
  const setCrit = (i: number, p: Partial<RubricCriterion>) => patch({ criteria: draft.criteria.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.criteria.length) return;
    const c = [...draft.criteria];
    [c[i], c[j]] = [c[j]!, c[i]!];
    patch({ criteria: c });
  };
  const total = rubricTotal(draft);
  const sortedSubjects = useMemo(() => [...subjects].sort((a, b) => a.name.localeCompare(b.name)), [subjects]);

  const runImport = async () => {
    if (!importFile) return;
    if (dirty && draft.criteria.some((c) => c.name)) {
      const ok = await confirm({ title: 'Replace current criteria?', body: 'The imported rubric will replace the criteria you have entered.', confirmText: 'Replace' });
      if (!ok) return;
    }
    setImporting(true);
    try {
      const r = await extractRubric(importFile.input);
      setDraft((d) => ({ ...d, title: d.title || r.title, description: d.description || r.description, criteria: r.criteria, keyPointers: r.keyPointers ?? [] }));
      setDirty(true);
      setImportOpen(false);
      toast(aiAvailable ? `Imported ${r.criteria.length} criteria — review before saving` : `Parsed ${r.criteria.length} criteria — review before saving`, 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Import failed', 'error');
    }
    setImporting(false);
  };

  const validate = (): string | null => {
    if (!draft.title.trim()) return 'Give the rubric a title.';
    const crit = draft.criteria.filter((c) => c.name.trim());
    if (!crit.length) return 'Add at least one criterion.';
    if (crit.some((c) => !(c.maxPoints > 0))) return 'Each criterion needs a maximum mark above 0.';
    const names = crit.map((c) => c.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return 'Criterion names must be unique.';
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) { toast(err, 'error'); return; }
    setSaving(true);
    try {
      const rid = existing?.id ?? newId();
      const doc: Rubric = {
        id: rid,
        title: draft.title.trim(),
        description: draft.description.trim(),
        criteria: draft.criteria.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), maxPoints: Number(c.maxPoints), description: c.description.trim() })),
        keyPointers: (draft.keyPointers ?? []).map((k) => k.trim()).filter(Boolean),
        subjectId: draft.subjectId || undefined,
        level: draft.level || undefined,
        ownerId: existing?.ownerId ?? profile?.staffId,
        ownerName: existing?.ownerName ?? (me ? staffName(me) : profile?.name),
        ...(existing?.createdAt ? { createdAt: existing.createdAt } : {}),
      };
      await store.set('rubrics', doc);
      setDirty(false);
      toast(existing ? 'Rubric updated' : 'Rubric saved');
      nav(isNew ? `/acegrader/rubrics/${rid}` : '/acegrader/rubrics', { replace: isNew });
    } catch (e: any) { toast(e?.message ?? 'Could not save', 'error'); }
    setSaving(false);
  };

  const duplicate = async () => {
    if (!existing) return;
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = existing;
    const nid = newId();
    await store.set('rubrics', { ...rest, id: nid, title: `${existing.title} (copy)`, ownerId: profile?.staffId, ownerName: me ? staffName(me) : profile?.name });
    toast('Duplicated — you can now edit your copy');
    nav(`/acegrader/rubrics/${nid}`);
  };

  const remove = async () => {
    if (!existing) return;
    if (!(await confirm({ title: 'Delete rubric?', body: `“${existing.title}” will be permanently deleted. Marked submissions keep their results.`, confirmText: 'Delete', danger: true }))) return;
    await store.remove('rubrics', existing.id);
    toast('Rubric deleted');
    nav('/acegrader/rubrics');
  };

  if (!isNew && loading) return <Spinner />;
  if (!isNew && !existing) return <EmptyState title="Rubric not found" action={<Button variant="outline" onClick={() => nav('/acegrader/rubrics')}>Back to library</Button>} />;

  return (
    <div>
      <PageHeader eyebrow="AceGrader · Rubric builder" title={isNew ? 'New rubric' : draft.title || 'Rubric'}
        subtitle={editable ? 'Define criteria and mark allocations. AceGrader marks each criterion separately.' : `Read-only — owned by ${existing?.ownerName ?? 'another teacher'}. Duplicate it to make your own version.`}
        actions={<>
          <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => nav('/acegrader/rubrics')}>Library</Button>
          {existing && <Button variant="outline" icon={<PenLine size={15} />} onClick={() => nav(`/acegrader/mark?rubric=${existing.id}`)}>Mark with this</Button>}
          {existing && can && <Button variant="outline" icon={<Copy size={15} />} onClick={duplicate}>Duplicate</Button>}
          {existing && editable && <Button variant="ghost" className="text-rose-600 dark:text-rose-300" icon={<Trash2 size={15} />} onClick={remove}>Delete</Button>}
          {editable && <Button icon={<Save size={16} />} loading={saving} onClick={save}>Save rubric</Button>}
        </>} />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {editable && (
            <section className="card overflow-hidden">
              <button onClick={() => setImportOpen((o) => !o)} className="flex w-full items-center gap-3 bg-marigold-500/10 px-5 py-4 text-left">
                <div className="rounded-lg border border-slate-200 p-2 text-slate-500 dark:border-white/10 dark:text-slate-400"><ListChecks size={16} /></div>
                <div className="flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">Import marking scheme <AiChip /></p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Upload or paste an existing marking scheme — criteria and marks are extracted for you to review.</p>
                </div>
                <span className="text-xs font-semibold text-brand-600 dark:text-brand-300">{importOpen ? 'Hide' : 'Show'}</span>
              </button>
              {importOpen && (
                <div className="space-y-3 p-5">
                  {importFile ? <FileChip file={importFile} onRemove={() => setImportFile(null)} /> : (
                    <FileDrop multiple={false} compact onFiles={(f) => setImportFile(f[0] ?? null)} textButton="Use pasted scheme"
                      textPlaceholder={'e.g.\nContent & relevance (10) – answers the topic with developed ideas\nOrganisation - 5 marks\nLanguage: 10'} />
                  )}
                  {!aiAvailable && <p className="text-xs text-marigold-600 dark:text-marigold-400">Tip: lines like “Criterion (10)”, “Name - 10 marks” or “Name: 10” are parsed. Files need Gemini.</p>}
                  <div className="flex justify-end"><Button variant="secondary" icon={<PenLine size={15} />} disabled={!importFile} loading={importing} onClick={runImport}>Extract rubric</Button></div>
                </div>
              )}
            </section>
          )}

          <Card title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" required className="sm:col-span-2"><Input value={draft.title} disabled={!editable} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Form 2 Argumentative essay" /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea rows={2} className="min-h-0" value={draft.description} disabled={!editable} onChange={(e) => patch({ description: e.target.value })} placeholder="Task, length, instructions for the marker…" /></Field>
              <Field label="Subject">
                <Select value={draft.subjectId ?? ''} disabled={!editable} onChange={(e) => patch({ subjectId: e.target.value })}>
                  <option value="">Any subject</option>
                  {sortedSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Level">
                <Select value={draft.level ?? ''} disabled={!editable} onChange={(e) => patch({ level: e.target.value })}>
                  <option value="">Any level</option>
                  {levelsFor(settings).map((l) => <option key={l.level} value={l.level}>{l.level}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card title="Criteria" subtitle="AceGrader awards marks for each criterion within its maximum and justifies every score."
            actions={<Badge tone="blue">{draft.criteria.length} criteria · {total} marks</Badge>}>
            <div className="space-y-3">
              {draft.criteria.map((c, i) => (
                <div key={i} className="rounded-2xl border border-slate-200 bg-paper-50/50 p-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
                  <div className="flex items-start gap-3">
                    <span className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 font-hand text-sm font-bold text-white dark:bg-white dark:text-slate-900">{i + 1}</span>
                    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_110px]">
                      <Field label="Criterion"><Input value={c.name} disabled={!editable} onChange={(e) => setCrit(i, { name: e.target.value })} placeholder="e.g. Content & relevance" /></Field>
                      <Field label="Max marks"><Input type="number" min={0} step={0.5} value={Number.isFinite(c.maxPoints) ? c.maxPoints : ''} disabled={!editable} onChange={(e) => setCrit(i, { maxPoints: Number(e.target.value) })} /></Field>
                      <Field label="What earns the marks" className="sm:col-span-2"><Textarea rows={2} className="min-h-0" value={c.description} disabled={!editable} onChange={(e) => setCrit(i, { description: e.target.value })} placeholder="Describe top-band performance and what loses marks…" /></Field>
                    </div>
                    {editable && (
                      <div className="flex flex-col gap-1 pt-6">
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-white/10" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={15} /></button>
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-white/10" disabled={i === draft.criteria.length - 1} onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={15} /></button>
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 dark:hover:bg-rose-500/10" disabled={draft.criteria.length === 1} onClick={() => patch({ criteria: draft.criteria.filter((_, j) => j !== i) })} aria-label="Remove"><Trash2 size={15} /></button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {editable && <Button variant="outline" icon={<Plus size={15} />} onClick={() => patch({ criteria: [...draft.criteria, { name: '', maxPoints: 5, description: '' }] })}>Add criterion</Button>}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <div className="card sticky top-4 overflow-hidden">
            <div className="bg-slate-900 px-5 py-4 text-white dark:bg-white/[0.06]">
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/60">Total</p>
              <p className="font-display tracking-tight text-5xl font-bold">{total}<span className="ml-1 text-lg text-white/50">marks</span></p>
            </div>
            <div className="space-y-2 p-5">
              {draft.criteria.filter((c) => c.name).map((c, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs"><span className="truncate pr-2 text-slate-600 dark:text-slate-300">{c.name}</span><span className="font-semibold text-slate-900 dark:text-white">{c.maxPoints || 0}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full rounded-full bg-brand-500" style={{ width: `${total ? ((c.maxPoints || 0) / total) * 100 : 0}%` }} /></div>
                </div>
              ))}
              {!draft.criteria.some((c) => c.name) && <p className="text-xs text-slate-400">Criteria weightings appear here.</p>}
            </div>
          </div>

          <Card title={<span className="flex items-center gap-2"><Lightbulb size={15} className="text-slate-400 dark:text-slate-400" /> Key pointers</span>} subtitle="What a strong answer must include — the AI checks for these.">
            <ul className="space-y-2">
              {(draft.keyPointers ?? []).map((k, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-slate-100 px-3 py-2 dark:bg-white/[0.06]">
                  <span className="font-hand text-base font-bold text-marigold-700 dark:text-marigold-400">{i + 1}.</span>
                  {editable ? <input className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none dark:text-slate-200" value={k} onChange={(e) => patch({ keyPointers: draft.keyPointers!.map((x, j) => (j === i ? e.target.value : x)) })} />
                    : <span className="flex-1 text-sm text-slate-700 dark:text-slate-200">{k}</span>}
                  {editable && <button onClick={() => patch({ keyPointers: draft.keyPointers!.filter((_, j) => j !== i) })} className="text-slate-400 hover:text-rose-500" aria-label="Remove pointer"><Trash2 size={13} /></button>}
                </li>
              ))}
              {!draft.keyPointers?.length && !editable && <p className="text-sm text-slate-400">None.</p>}
            </ul>
            {editable && (
              <form className={cx('mt-3 flex gap-2')} onSubmit={(e) => { e.preventDefault(); if (newPointer.trim()) { patch({ keyPointers: [...(draft.keyPointers ?? []), newPointer.trim()] }); setNewPointer(''); } }}>
                <Input value={newPointer} onChange={(e) => setNewPointer(e.target.value)} placeholder="e.g. Mentions land alienation" />
                <Button type="submit" variant="outline" icon={<Plus size={15} />} disabled={!newPointer.trim()}>Add</Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
