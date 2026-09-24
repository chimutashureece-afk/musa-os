import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {ArrowLeft, ListTree, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, Plus, Printer, RotateCcw, Save, PenLine, Trash2, Undo2} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner, Textarea, useUI } from '../../components/ui';
import { useAuth, useMyStaff, useSettings } from '../../context/AuthContext';
import { useCan } from '../../lib/hooks';
import { newId, store, useCollection, useIndex } from '../../lib/store';
import { cx, fmtDate, gradeFor, gradeColor, staffName } from '../../lib/utils';
import type { WriteOp } from '../../lib/backend';
import { aiAvailable, gradeSubmission } from '../../lib/acegrader/engine';
import { approveOps, cloneResult, correctionsFor, QUEUE_KEY, resultPct, scaledScore } from '../../lib/acegrader/helpers';
import type { Assessment, GradingResult, TeacherCorrection } from '../../types';
import { MarkedDocument } from './MarkedDocument';
import { FeedbackSheet } from './FeedbackSheet';
import { LinkAssessmentModal, ScoreStamp, SimBadge, StatusBadge } from './parts';

const readQueue = (): string[] => { try { return JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } };

const clampPts = (v: number, max: number) => Math.round(Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0)) * 2) / 2;
const withTotal = (r: GradingResult): GradingResult => ({ ...r, totalScore: Math.round(r.breakdown.reduce((a, b) => a + b.pointsEarned, 0) * 10) / 10 });

type After = 'approve' | null;

export default function SubmissionDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const me = useMyStaff();
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const can = useCan('submissions');
  const { data: subs, loading } = useCollection('submissions');
  const { data: corrections } = useCollection('corrections');
  const assessments = useIndex('assessments');
  const marks = useIndex('marks');
  const classes = useIndex('classes');
  const subjects = useIndex('subjects');
  const rubrics = useIndex('rubrics');
  const staff = useIndex('staff');

  const sub = subs.find((s) => s.id === id);
  const [draft, setDraft] = useState<GradingResult | null>(null);
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const [reasonOpen, setReasonOpen] = useState<{ after: After } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [showLogic, setShowLogic] = useState(false);
  const [newTip, setNewTip] = useState('');

  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!sub) return;
    const fresh = loadedFor !== sub.id;
    if (fresh || !dirty) {
      setDraft(cloneResult(sub.result)); setNotes(sub.teacherNotes ?? ''); setLoadedFor(sub.id);
      if (fresh) setDirty(false);
    }
  }, [sub?.id, sub?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const queue = useMemo(() => {
    const q = readQueue();
    if (q.includes(id)) return q;
    return subs.filter((s) => s.status === 'pending-review').sort((a, b) => b.timestamp - a.timestamp).map((s) => s.id);
  }, [id, subs]);
  const pos = queue.indexOf(id);
  const prevId = pos > 0 ? queue[pos - 1] : undefined;
  const nextId = pos >= 0 && pos < queue.length - 1 ? queue[pos + 1] : undefined;

  if (loading) return <Spinner />;
  if (!sub) return <EmptyState title="Submission not found" action={<Button variant="outline" onClick={() => nav('/acegrader/review')}>Back to review queue</Button>} />;
  if (!draft || loadedFor !== sub.id) return <Spinner />;

  const cls = classes.get(sub.classId);
  const assessment = sub.assessmentId ? assessments.get(sub.assessmentId) : undefined;
  const p = resultPct(draft) ?? 0;
  const grade = gradeFor(p, cls, settings);
  const rubric = rubrics.get(sub.rubricId);
  const teacher = sub.teacherId ? staff.get(sub.teacherId) : undefined;

  const edit = (fn: (r: GradingResult) => GradingResult) => { setDraft((d) => (d ? withTotal(fn(cloneResult(d))) : d)); setDirty(true); };
  const setCrit = (i: number, patch: Partial<GradingResult['breakdown'][number]>) => edit((r) => { r.breakdown[i] = { ...r.breakdown[i]!, ...patch }; return r; });

  const go = (to?: string) => {
    if (!to) return;
    if (dirty) {
      confirm({ title: 'Discard unsaved changes?', body: 'Your edits to this submission have not been saved.', confirmText: 'Discard', danger: true }).then((ok) => ok && nav(`/acegrader/review/${to}`));
    } else nav(`/acegrader/review/${to}`);
  };

  /** Build ops that persist the draft + TeacherCorrection docs for every change vs the saved result. */
  const saveOps = (why: string): WriteOp[] => {
    const orig = sub.result;
    const ts = Date.now();
    const corr: TeacherCorrection[] = [];
    draft.breakdown.forEach((b, i) => {
      const o = orig.breakdown.find((x) => x.name === b.name) ?? orig.breakdown[i];
      if (!o) return;
      if (o.pointsEarned !== b.pointsEarned || o.justification.trim() !== b.justification.trim())
        corr.push({ id: newId(), rubricId: sub.rubricId, submissionId: sub.id, criterion: b.name, originalScore: o.pointsEarned, correctedScore: b.pointsEarned, originalFeedback: o.justification, correctedFeedback: b.justification, reason: why, timestamp: ts });
    });
    if (orig.feedback.trim() !== draft.feedback.trim())
      corr.push({ id: newId(), rubricId: sub.rubricId, submissionId: sub.id, criterion: 'Overall feedback', originalScore: orig.totalScore, correctedScore: draft.totalScore, originalFeedback: orig.feedback, correctedFeedback: draft.feedback, reason: why, timestamp: ts });
    const ops: WriteOp[] = [
      { op: 'update', col: 'submissions', id: sub.id, data: { result: draft, teacherNotes: notes, ...(corr.length ? { edited: true } : {}) } },
      ...corr.map((c) => ({ op: 'set' as const, col: 'corrections' as const, id: c.id, data: c })),
    ];
    // keep an already-posted gradebook mark in sync
    if (sub.status === 'approved' && assessment) ops.push(...approveOps({ ...sub, result: draft }, assessment, marks.get(`${assessment.id}_${sub.studentId}`)).filter((o) => o.col === 'marks'));
    return ops;
  };

  const scoreChanged = () => draft.breakdown.some((b, i) => { const o = sub.result.breakdown.find((x) => x.name === b.name) ?? sub.result.breakdown[i]; return !o || o.pointsEarned !== b.pointsEarned || o.justification.trim() !== b.justification.trim(); }) || draft.feedback.trim() !== sub.result.feedback.trim();

  const requestSave = (after: After) => {
    if (scoreChanged()) { setReason(''); setReasonOpen({ after }); }
    else doSave('', after);
  };

  const doSave = async (why: string, after: After) => {
    setReasonOpen(null);
    setBusy('save');
    try {
      await store.commit(saveOps(why.trim()));
      setDirty(false);
      if (after === 'approve') await approve(true);
      else toast(scoreChanged() ? 'Saved — AceGrader will learn from your corrections' : 'Saved');
    } catch (e: any) { toast(e?.message ?? 'Save failed', 'error'); }
    setBusy(null);
  };

  const approve = async (skipDirtyCheck = false, linked?: Assessment) => {
    if (!skipDirtyCheck && dirty) { requestSave('approve'); return; }
    const a = linked ?? assessment;
    if (!a) { setLinkOpen(true); return; }
    setBusy('approve');
    try {
      await store.commit(approveOps({ ...sub, result: draft }, a, marks.get(`${a.id}_${sub.studentId}`)));
      toast(`Approved — ${scaledScore(draft, a.maxMark)}/${a.maxMark} posted to the gradebook`);
      if (nextId) nav(`/acegrader/review/${nextId}`);
    } catch (e: any) { toast(e?.message ?? 'Could not approve', 'error'); }
    setBusy(null);
  };

  const returnIt = async () => {
    setBusy('return');
    await store.update('submissions', sub.id, { status: 'returned', teacherNotes: notes });
    toast('Marked as returned for re-mark', 'info');
    setBusy(null);
  };

  const remark = async () => {
    if (!sub.textExcerpt) { toast('The original file isn\'t stored — upload it again in a new marking session to re-mark.', 'info'); return; }
    if (!rubric) { toast('The rubric for this submission no longer exists.', 'error'); return; }
    if (!(await confirm({ title: 'Re-mark this script?', body: `The current marks and comments will be replaced with a fresh marking${dirty ? ' (unsaved edits are lost)' : ''}. Your saved corrections are used to calibrate the new marking.`, confirmText: 'Re-mark' }))) return;
    setBusy('remark');
    try {
      const s = sub.studentName.split(' ')[0];
      const result = await gradeSubmission({ rubric, submission: { type: 'text', content: sub.textExcerpt }, corrections: correctionsFor(corrections, rubric.id), level: cls?.level, subjectName: sub.subjectId ? subjects.get(sub.subjectId)?.name : undefined, studentFirstName: s });
      await store.update('submissions', sub.id, { result, status: 'pending-review', edited: false, timestamp: Date.now() });
      setDraft(cloneResult(result)); setDirty(false);
      toast('Re-marked');
    } catch (e: any) { toast(e?.message ?? 'Re-mark failed', 'error'); }
    setBusy(null);
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Delete this submission?', body: 'The marked script is removed. Any mark already posted to the gradebook stays.', confirmText: 'Delete', danger: true }))) return;
    await store.remove('submissions', sub.id);
    toast('Submission deleted');
    nav(nextId ? `/acegrader/review/${nextId}` : '/acegrader/review');
  };

  const subjName = sub.subjectId ? subjects.get(sub.subjectId)?.name : undefined;

  return (
    <div>
      <div className="no-print">
        <PageHeader eyebrow={`AceGrader · Review${pos >= 0 ? ` · ${pos + 1} of ${queue.length}` : ''}`} title={sub.studentName}
          subtitle={<span className="flex flex-wrap items-center gap-2">{sub.rubricTitle} · {cls?.name ?? '—'}{subjName ? ` · ${subjName}` : ''} · {fmtDate(sub.timestamp)} <StatusBadge status={sub.status} />{draft.simulated && <SimBadge />}{sub.edited && <Badge tone="sky">Teacher-edited</Badge>}</span>}
          actions={<>
            <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => nav('/acegrader/review')}>Queue</Button>
            <Button variant="outline" size="md" icon={<ChevronLeft size={16} />} disabled={!prevId} onClick={() => go(prevId)} aria-label="Previous" />
            <Button variant="outline" size="md" icon={<ChevronRight size={16} />} disabled={!nextId} onClick={() => go(nextId)} aria-label="Next" />
            <Button variant="outline" icon={<Printer size={15} />} onClick={() => window.print()}>Print feedback</Button>
          </>} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <MarkedDocument result={draft} text={sub.textExcerpt} studentName={sub.studentName} fileName={sub.fileName}
              subtitle={`${cls?.name ?? ''} · ${sub.rubricTitle}`}
              stamp={<ScoreStamp score={draft.totalScore} max={draft.maxTotalScore} grade={grade?.grade} size="sm" />} />
          </div>

          <div className="min-w-0 space-y-5">
            {/* score */}
            <div className="card relative overflow-hidden p-5">
              <div className="flex items-center gap-5">
                <ScoreStamp score={draft.totalScore} max={draft.maxTotalScore} grade={grade?.grade} className="-rotate-0 shrink-0" />
                <div className="min-w-0 space-y-1 text-sm">
                  <p className={cx('font-display tracking-tight text-3xl font-bold', gradeColor(grade?.grade))}>{grade ? `${grade.grade} · ${grade.remark}` : '—'}</p>
                  {assessment ? <p className="text-slate-500 dark:text-slate-400">Gradebook: <b className="text-slate-800 dark:text-slate-100">{scaledScore(draft, assessment.maxMark)}/{assessment.maxMark}</b> in {assessment.name}</p>
                    : <p className="text-marigold-600 dark:text-marigold-400">Not linked to a gradebook assessment yet.</p>}
                  {teacher && <p className="text-xs text-slate-400">Marked for {staffName(teacher)}</p>}
                </div>
              </div>
              {draft.summary && <p className="mt-4 rounded-xl bg-paper-100/70 p-3 text-sm italic text-slate-600 dark:bg-white/[0.03] dark:text-slate-300">{draft.summary}</p>}
            </div>

            {/* breakdown */}
            <Card title="Criterion breakdown" subtitle={can ? 'Override marks or wording — every change teaches AceGrader your standard.' : undefined} bodyClass="space-y-4">
              {draft.breakdown.map((b, i) => {
                const saved = sub.result.breakdown.find((x) => x.name === b.name) ?? sub.result.breakdown[i];
                const changed = saved && saved.pointsEarned !== b.pointsEarned;
                const bp = b.maxPoints ? (b.pointsEarned / b.maxPoints) * 100 : 0;
                return (
                  <div key={b.name} className="rounded-2xl border border-slate-100 p-3 dark:border-white/[0.06]">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 font-display tracking-tight text-lg font-bold leading-tight text-slate-900 dark:text-white">{b.name}</p>
                      <div className="flex shrink-0 items-center gap-1">
                        {can ? <Input type="number" min={0} max={b.maxPoints} step={0.5} value={b.pointsEarned} className="h-9 w-16 px-2 text-center font-bold"
                          onChange={(e) => setCrit(i, { pointsEarned: clampPts(Number(e.target.value), b.maxPoints) })} aria-label={`${b.name} score`} />
                          : <span className="font-bold">{b.pointsEarned}</span>}
                        <span className="text-sm text-slate-400">/ {b.maxPoints}</span>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className={cx('h-full rounded-full transition-all', bp >= 65 ? 'bg-brand-500' : bp >= 45 ? 'bg-marigold-500' : 'bg-rose-500')} style={{ width: `${bp}%` }} /></div>
                    {changed && <p className="mt-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400">Was: {saved!.pointsEarned} → you: {b.pointsEarned}</p>}
                    {can ? <Textarea rows={3} className="mt-2 min-h-0 text-[13px]" value={b.justification} onChange={(e) => setCrit(i, { justification: e.target.value })} />
                      : <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{b.justification}</p>}
                  </div>
                );
              })}
            </Card>

            {/* feedback */}
            <Card title="Feedback to learner" bodyClass="space-y-4">
              <Field label="Overall feedback"><Textarea rows={4} disabled={!can} value={draft.feedback} onChange={(e) => edit((r) => ({ ...r, feedback: e.target.value }))} className="font-hand text-lg leading-snug" /></Field>
              <div>
                <span className="label flex items-center gap-1"><Lightbulb size={12} /> Improvement tips</span>
                <ul className="space-y-2">
                  {draft.improvementTips.map((t, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="font-hand font-bold text-brand-600 dark:text-brand-300">{i + 1}.</span>
                      <Input disabled={!can} value={t} onChange={(e) => edit((r) => { r.improvementTips[i] = e.target.value; return r; })} className="h-9" />
                      {can && <button onClick={() => edit((r) => ({ ...r, improvementTips: r.improvementTips.filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-rose-500" aria-label="Remove tip"><Trash2 size={14} /></button>}
                    </li>
                  ))}
                </ul>
                {can && (
                  <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newTip.trim()) { edit((r) => ({ ...r, improvementTips: [...r.improvementTips, newTip.trim()] })); setNewTip(''); } }}>
                    <Input value={newTip} onChange={(e) => setNewTip(e.target.value)} placeholder="Add a tip…" className="h-9" />
                    <Button type="submit" size="sm" variant="outline" icon={<Plus size={14} />} disabled={!newTip.trim()}>Add</Button>
                  </form>
                )}
              </div>
              <Field label="Private teacher notes" hint="Not shown on the feedback sheet."><Textarea rows={2} className="min-h-0" disabled={!can} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} /></Field>
            </Card>

            {!!draft.thinkingProcess?.length && (
              <div className="card p-4">
                <button className="flex w-full items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200" onClick={() => setShowLogic((s) => !s)}>
                  <ListTree size={16} className="text-slate-400 dark:text-slate-400" /> Marker's reasoning <span className="ml-auto text-xs font-semibold text-brand-600 dark:text-brand-300">{showLogic ? 'Hide' : 'Show'}</span>
                </button>
                {showLogic && <ul className="mt-3 space-y-1.5">{draft.thinkingProcess.map((t, i) => <li key={i} className="flex gap-2 text-sm text-slate-600 dark:text-slate-300"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />{t}</li>)}</ul>}
              </div>
            )}

            {can && (
              <div className="card sticky bottom-20 z-10 flex flex-wrap gap-2 p-3 shadow-lg md:bottom-4">
                <Button variant="success" className="flex-1" icon={<CheckCircle2 size={16} />} loading={busy === 'approve'} onClick={() => approve()}>
                  {sub.status === 'approved' ? 'Re-post to gradebook' : 'Approve & post to gradebook'}
                </Button>
                {dirty && <Button icon={<Save size={15} />} loading={busy === 'save'} onClick={() => requestSave(null)}>Save</Button>}
                {dirty && <Button variant="ghost" icon={<Undo2 size={15} />} onClick={() => { setDraft(cloneResult(sub.result)); setNotes(sub.teacherNotes ?? ''); setDirty(false); }}>Undo</Button>}
                <div className="flex w-full flex-wrap gap-2">
                  <Button size="sm" variant="outline" icon={<RotateCcw size={13} />} loading={busy === 'return'} disabled={sub.status === 'returned'} onClick={returnIt}>Return for re-mark</Button>
                  <Button size="sm" variant="outline" icon={<PenLine size={13} />} loading={busy === 'remark'} onClick={remark} title={sub.textExcerpt ? '' : 'Only available for typed/text submissions'}>Re-mark</Button>
                  <Button size="sm" variant="ghost" className="ml-auto text-rose-600 dark:text-rose-300" icon={<Trash2 size={13} />} onClick={remove} aria-label="Delete" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="print-only">
        <FeedbackSheet settings={settings} result={draft} studentName={sub.studentName} className={cls?.name} subjectName={subjName} assessmentName={assessment?.name}
          rubricTitle={sub.rubricTitle} grade={grade?.grade} teacher={teacher ? staffName(teacher) : me ? staffName(me) : profile?.name} date={sub.timestamp} />
      </div>

      <Modal open={!!reasonOpen} onClose={() => setReasonOpen(null)} title="Why did you change the marking?" size="sm"
        footer={<><Button variant="ghost" onClick={() => doSave('', reasonOpen?.after ?? null)}>Skip</Button><Button onClick={() => doSave(reason, reasonOpen?.after ?? null)}>Save</Button></>}>
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Optional — a short reason helps AceGrader match your standard on the next scripts for this rubric.</p>
        <Textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Too generous on organisation — no paragraphing" />
      </Modal>

      {cls && (
        <LinkAssessmentModal open={linkOpen} onClose={() => setLinkOpen(false)} classId={cls.id} subjectId={sub.subjectId} termId={sub.termId} rubricId={sub.rubricId}
          defaultName={sub.rubricTitle} defaultMax={draft.maxTotalScore} subjects={[...subjects.values()].sort((a, b) => a.name.localeCompare(b.name))}
          onLinked={(a) => { setLinkOpen(false); approve(true, a); }} />
      )}
    </div>
  );
}

