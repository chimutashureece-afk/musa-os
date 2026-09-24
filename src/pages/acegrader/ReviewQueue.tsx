import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {CheckCircle2, ClipboardCheck, FileText, Layers, PenLine, X} from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Select, Spinner, TableWrap, Tabs, useUI } from '../../components/ui';
import { useSettings } from '../../context/AuthContext';
import { useCan } from '../../lib/hooks';
import { store, useCollection, useIndex } from '../../lib/store';
import { cx, fmtDate, gradeFor, gradeColor } from '../../lib/utils';
import type { WriteOp } from '../../lib/backend';
import { approveOps, QUEUE_KEY, resultPct } from '../../lib/acegrader/helpers';
import { useAceSubmissions } from '../../lib/acegrader/hooks';
import type { SubmissionStatus } from '../../types';
import { SimBadge, StatusBadge } from './parts';

type Tab = SubmissionStatus | 'all';

export default function ReviewQueue() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const can = useCan('submissions');
  const { data: subs, loading } = useAceSubmissions();
  const classes = useIndex('classes');
  const assessments = useIndex('assessments');
  const marks = useIndex('marks');
  const { data: rubrics } = useCollection('rubrics');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const status = (params.get('status') as Tab) || 'pending-review';
  const classF = params.get('class') ?? '';
  const rubricF = params.get('rubric') ?? '';
  const q = params.get('q') ?? '';
  const assessmentF = params.get('assessment') ?? '';
  const since = Number(params.get('since') ?? 0);
  const batch = !!(assessmentF || since);

  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    v ? n.set(k, v) : n.delete(k);
    setParams(n, { replace: true });
  };

  const base = useMemo(() => subs.filter((s) =>
    (!classF || s.classId === classF) && (!rubricF || s.rubricId === rubricF) && (!assessmentF || s.assessmentId === assessmentF) && (!since || s.timestamp >= since)
    && (!q || `${s.studentName} ${s.rubricTitle} ${s.fileName ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [subs, classF, rubricF, assessmentF, since, q]);
  const rows = useMemo(() => base.filter((s) => status === 'all' || s.status === status), [base, status]);
  const count = (st: SubmissionStatus) => base.filter((s) => s.status === st).length;

  // remember queue order for prev/next on the detail page
  useEffect(() => { try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(rows.map((r) => r.id))); } catch { /* ignore */ } }, [rows]);
  useEffect(() => setSelected(new Set()), [status, classF, rubricF, q, assessmentF, since]);

  const classOptions = useMemo(() => [...new Set(subs.map((s) => s.classId))].map((id) => classes.get(id)).filter(Boolean).sort((a, b) => a!.levelOrder - b!.levelOrder || a!.name.localeCompare(b!.name)), [subs, classes]);
  const rubricOptions = useMemo(() => rubrics.filter((r) => subs.some((s) => s.rubricId === r.id)), [rubrics, subs]);

  const selectable = rows.filter((r) => r.status !== 'approved');
  const allSel = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulkApprove = async () => {
    const chosen = rows.filter((r) => selected.has(r.id));
    const ready = chosen.filter((s) => s.assessmentId && assessments.get(s.assessmentId));
    const skipped = chosen.length - ready.length;
    const ok = await confirm({
      title: `Approve ${ready.length} script${ready.length === 1 ? '' : 's'}?`,
      body: `Marks will be scaled and written to the gradebook.${skipped ? ` ${skipped} not linked to an assessment will be skipped — open them to link one.` : ''}`,
      confirmText: 'Approve & send',
    });
    if (!ok || !ready.length) return;
    setBusy(true);
    try {
      const ops: WriteOp[] = ready.flatMap((s) => { const a = assessments.get(s.assessmentId!)!; return approveOps(s, a, marks.get(`${a.id}_${s.studentId}`)); });
      for (let i = 0; i < ops.length; i += 400) await store.commit(ops.slice(i, i + 400));
      toast(`${ready.length} approved and posted to the gradebook`);
      setSelected(new Set());
    } catch (e: any) { toast(e?.message ?? 'Bulk approve failed', 'error'); }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader eyebrow="AceGrader" title="Review queue" subtitle="Check the marking, adjust where needed, then approve to post marks to the gradebook."
        actions={<Button variant="outline" icon={<PenLine size={15} />} onClick={() => nav('/acegrader/mark')}>New marking session</Button>} />

      {batch && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200">
          <Layers size={16} />
          Showing {since ? 'this marking batch' : 'one assessment'}{assessmentF && assessments.get(assessmentF) ? ` · ${assessments.get(assessmentF)!.name}` : ''}
          <button className="ml-auto flex items-center gap-1 font-semibold hover:underline" onClick={() => { const n = new URLSearchParams(params); n.delete('assessment'); n.delete('since'); setParams(n, { replace: true }); }}><X size={14} /> Show all</button>
        </div>
      )}

      <Tabs value={status} onChange={(v) => setParam('status', v === 'pending-review' ? '' : v)} className="mb-4"
        tabs={[{ id: 'pending-review', label: 'Pending review', count: count('pending-review') }, { id: 'approved', label: 'Approved', count: count('approved') }, { id: 'returned', label: 'Returned', count: count('returned') }, { id: 'all', label: 'All', count: base.length }]} />

      <Card bodyClass="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center dark:border-white/[0.06]">
          <SearchInput value={q} onChange={(v) => setParam('q', v)} placeholder="Search learner, rubric, file…" className="sm:max-w-xs sm:flex-1" />
          <Select value={classF} onChange={(e) => setParam('class', e.target.value)} className="sm:w-44">
            <option value="">All classes</option>
            {classOptions.map((c) => <option key={c!.id} value={c!.id}>{c!.name}</option>)}
          </Select>
          <Select value={rubricF} onChange={(e) => setParam('rubric', e.target.value)} className="sm:w-60">
            <option value="">All rubrics</option>
            {rubricOptions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </Select>
          {can && selected.size > 0 && (
            <Button variant="success" className="sm:ml-auto" icon={<CheckCircle2 size={15} />} loading={busy} onClick={bulkApprove}>Approve & send {selected.size} to gradebook</Button>
          )}
        </div>
        {loading ? <Spinner /> : !rows.length ? (
          <EmptyState icon={<ClipboardCheck size={22} />} title={status === 'pending-review' ? 'Nothing waiting for review' : 'No submissions'} body={status === 'pending-review' ? 'All caught up. Start a marking session to add scripts.' : 'Try a different filter.'}
            action={status === 'pending-review' && <Button onClick={() => nav('/acegrader/mark')}>Mark scripts</Button>} />
        ) : (
          <div className="px-5">
            <TableWrap>
              <thead>
                <tr>
                  {can && <th className="th w-8"><input type="checkbox" aria-label="Select all" checked={allSel} disabled={!selectable.length} onChange={() => setSelected(allSel ? new Set() : new Set(selectable.map((r) => r.id)))} /></th>}
                  <th className="th">Learner</th>
                  <th className="th">Class</th>
                  <th className="th">Rubric / assessment</th>
                  <th className="th text-right">Score</th>
                  <th className="th text-right">%</th>
                  <th className="th">Status</th>
                  <th className="th">Marked</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const p = resultPct(s.result);
                  const cls = classes.get(s.classId);
                  const g = gradeFor(p, cls, settings);
                  const a = s.assessmentId ? assessments.get(s.assessmentId) : undefined;
                  return (
                    <tr key={s.id} className={cx('tr tr-hover cursor-pointer', selected.has(s.id) && 'bg-slate-100 dark:bg-white/[0.06]')} onClick={() => nav(`/acegrader/review/${s.id}`)}>
                      {can && <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${s.studentName}`} disabled={s.status === 'approved'} checked={selected.has(s.id)} onChange={() => toggle(s.id)} /></td>}
                      <td className="td">
                        <Link to={`/acegrader/review/${s.id}`} className="font-semibold text-slate-900 hover:underline dark:text-white" onClick={(e) => e.stopPropagation()}>{s.studentName}</Link>
                        {s.fileName && <p className="flex items-center gap-1 truncate text-[11px] text-slate-400"><FileText size={11} />{s.fileName}</p>}
                      </td>
                      <td className="td text-slate-600 dark:text-slate-300">{cls?.name ?? '—'}</td>
                      <td className="td">
                        <p className="max-w-[260px] truncate text-slate-700 dark:text-slate-200">{s.rubricTitle}</p>
                        <p className="text-[11px] text-slate-400">{a ? `${a.name} · /${a.maxMark}` : <span className="text-marigold-600 dark:text-marigold-300">No assessment linked</span>}</p>
                      </td>
                      <td className="td text-right font-hand text-lg font-bold text-rose-700 dark:text-rose-300">{s.result.totalScore}/{s.result.maxTotalScore}</td>
                      <td className="td text-right"><span className={cx('font-bold', gradeColor(g?.grade))}>{p == null ? '—' : `${Math.round(p)}%`}</span>{g && <span className="ml-1 text-xs text-slate-400">{g.grade}</span>}</td>
                      <td className="td"><div className="flex flex-wrap gap-1"><StatusBadge status={s.status} />{s.result.simulated && <SimBadge />}{s.edited && <Badge tone="sky">Edited</Badge>}</div></td>
                      <td className="td whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{fmtDate(s.timestamp, { day: 'numeric', month: 'short' })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Card>
    </div>
  );
}
