import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, ClipboardList, FileQuestion, Keyboard, Loader2, Play, RotateCw, PenLine, Square, Trash2, UserCheck, Users, XCircle} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Progress, Select, Textarea, useUI } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useCan, useClassStudents, useClassSubjects, useMyClasses } from '../../lib/hooks';
import { newId, store, useCollection, useIndex } from '../../lib/store';
import { cx, fullName } from '../../lib/utils';
import { aiAvailable, gradeSubmission, rubricTotal } from '../../lib/acegrader/engine';
import { correctionsFor, matchStudent, resultPct, TEXT_EXCERPT_CAP } from '../../lib/acegrader/helpers';
import { useCurrentTermId } from '../../lib/acegrader/hooks';
import type { Assessment, Submission } from '../../types';
import { FileChip, FileDrop, kindIcon, type DroppedFile } from './FileDrop';
import { AiChip, AssessmentFields, emptyChoice, resolveAssessment, useTermAssessments, type AssessmentChoice } from './parts';

type ItemStatus = 'queued' | 'marking' | 'done' | 'failed' | 'skipped';
interface ScriptItem {
  id: string;
  file: DroppedFile;
  studentId: string;
  auto: boolean;
  status: ItemStatus;
  error?: string;
  score?: number;
  max?: number;
  submissionId?: string;
}

const STEPS = ['Set up', 'Scripts', 'Mark'];

export default function MarkSession() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const { toast, confirm } = useUI();
  const can = useCan('submissions');
  const termId = useCurrentTermId();
  const { data: rubrics } = useCollection('rubrics');
  const { data: allSubs } = useCollection('submissions');
  const { data: corrections } = useCollection('corrections');
  const subjectsIdx = useIndex('subjects');
  const myClasses = useMyClasses();

  const [step, setStep] = useState(0);
  const [rubricId, setRubricId] = useState(params.get('rubric') ?? '');
  const [classId, setClassId] = useState(params.get('class') ?? '');
  const [subjectId, setSubjectId] = useState(params.get('subject') ?? '');
  const [choice, setChoice] = useState<AssessmentChoice>(emptyChoice());
  const [choiceTouched, setChoiceTouched] = useState(false);
  const [qp, setQp] = useState<DroppedFile | null>(null);
  const [items, setItems] = useState<ScriptItem[]>([]);
  const itemsRef = useRef<ScriptItem[]>([]);
  itemsRef.current = items;
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [running, setRunning] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [batchStart, setBatchStart] = useState(0);
  const overwriteRef = useRef(new Map<string, string>()); // studentId -> existing submission id

  const rubric = rubrics.find((r) => r.id === rubricId);
  const cls = myClasses.find((c) => c.id === classId);
  const classSubjects = useClassSubjects(classId);
  const roster = useClassStudents(classId);
  const rosterIdx = useMemo(() => new Map(roster.map((s) => [s.id, s])), [roster]);
  const options = useTermAssessments(classId, subjectId, termId);
  const total = rubric ? rubricTotal(rubric) : 0;

  // sensible defaults
  useEffect(() => {
    if (!rubricId && rubrics.length) {
      const mine = rubrics.find((r) => r.ownerId === profile?.staffId);
      setRubricId((mine ?? rubrics[0]!).id);
    }
  }, [rubrics, rubricId, profile]);
  useEffect(() => {
    if (!classId && myClasses.length) {
      const byLevel = rubric?.level ? myClasses.find((c) => c.level === rubric.level) : undefined;
      setClassId((byLevel ?? myClasses[0]!).id);
    }
  }, [myClasses, classId, rubric]);
  useEffect(() => {
    if (!classSubjects.length) return;
    if (!classSubjects.some((s) => s.id === subjectId)) {
      const pref = classSubjects.find((s) => s.id === rubric?.subjectId);
      setSubjectId((pref ?? classSubjects[0]!).id);
    }
  }, [classSubjects, subjectId, rubric]);
  useEffect(() => {
    if (choiceTouched) return;
    const q = params.get('assessment');
    const pre = options.find((a) => a.id === q) ?? options.find((a) => a.rubricId && a.rubricId === rubricId);
    setChoice(pre ? { ...emptyChoice(rubric?.title ?? '', total), mode: 'existing', assessmentId: pre.id } : emptyChoice(rubric?.title ?? '', total));
  }, [options, rubricId, rubric, total, choiceTouched, params]);

  // re-match scripts when roster changes
  useEffect(() => {
    setItems((its) => {
      if (!roster.length) return its;
      const taken = new Set(its.filter((i) => i.studentId && rosterIdx.has(i.studentId)).map((i) => i.studentId));
      return its.map((i) => {
        if (i.studentId && rosterIdx.has(i.studentId)) return i;
        const m = i.file.name === 'Pasted text' ? undefined : matchStudent(i.file.name, roster, taken);
        if (m) taken.add(m.id);
        return { ...i, studentId: m?.id ?? '', auto: !!m };
      });
    });
  }, [roster, rosterIdx]);

  const addFiles = (files: DroppedFile[]) => {
    setItems((its) => {
      const taken = new Set(its.map((i) => i.studentId).filter(Boolean));
      const add = files.map((f) => {
        const m = f.name === 'Pasted text' ? undefined : matchStudent(f.name, roster, taken);
        if (m) taken.add(m.id);
        return { id: newId(), file: f, studentId: m?.id ?? '', auto: !!m, status: 'queued' as ItemStatus };
      });
      return [...its, ...add];
    });
    const matched = files.filter((f) => matchStudent(f.name, roster)).length;
    toast(`${files.length} script${files.length === 1 ? '' : 's'} added${matched ? ` · ${matched} auto-matched` : ''}`, 'info');
  };

  const update = (id: string, p: Partial<ScriptItem>) => setItems((its) => its.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const savePaste = () => {
    const s = pasteFor ? rosterIdx.get(pasteFor) : undefined;
    const t = pasteText.trim();
    if (!s || !t) return;
    setItems((its) => [...its.filter((i) => !(i.studentId === s.id && i.file.kind === 'text' && i.file.name.startsWith('Typed —'))), {
      id: newId(), studentId: s.id, auto: false, status: 'queued',
      file: { id: newId(), name: `Typed — ${fullName(s)}`, size: t.length, kind: 'text', input: { type: 'text', content: t } },
    }]);
    setPasteFor(null); setPasteText('');
  };

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.studentId && m.set(i.studentId, (m.get(i.studentId) ?? 0) + 1));
    return m;
  }, [items]);
  const unmatched = items.filter((i) => !i.studentId).length;
  const dupes = [...counts.values()].some((n) => n > 1);

  // ---------------------------------------------------------------- run --
  const markOne = async (item: ScriptItem, a: Assessment, signal: AbortSignal) => {
    if (!rubric || !cls) return;
    const s = rosterIdx.get(item.studentId);
    if (!s) { update(item.id, { status: 'failed', error: 'Student not in class roster' }); return; }
    update(item.id, { status: 'marking', error: undefined });
    try {
      const result = await gradeSubmission({
        rubric, submission: item.file.input, questionPaper: qp?.input, corrections: correctionsFor(corrections, rubric.id),
        level: cls.level, subjectName: subjectsIdx.get(subjectId)?.name, studentFirstName: s.firstName, signal,
      });
      if (signal.aborted) throw new Error('Cancelled.');
      const id = overwriteRef.current.get(s.id) ?? newId();
      const sub: Submission = {
        id, rubricId: rubric.id, rubricTitle: rubric.title, studentId: s.id, studentName: fullName(s), classId: cls.id, subjectId, assessmentId: a.id,
        termId: a.termId, teacherId: profile?.staffId, status: 'pending-review', result,
        fileName: item.file.name === 'Pasted text' || item.file.name.startsWith('Typed —') ? undefined : item.file.name,
        textExcerpt: item.file.input.type === 'text' ? item.file.input.content.slice(0, TEXT_EXCERPT_CAP) : undefined,
        timestamp: Date.now(),
      };
      await store.set('submissions', sub);
      overwriteRef.current.set(s.id, id);
      update(item.id, { status: 'done', score: result.totalScore, max: result.maxTotalScore, submissionId: id });
    } catch (e: any) {
      if (signal.aborted) update(item.id, { status: 'queued', error: undefined });
      else update(item.id, { status: 'failed', error: e?.message ?? 'Marking failed' });
    }
  };

  const runQueue = async (a: Assessment, onlyIds?: string[]) => {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRunning(true);
    const queue = itemsRef.current.filter((i) => (onlyIds ? onlyIds.includes(i.id) : i.status === 'queued'));
    for (const it of queue) {
      if (ctrl.signal.aborted) break;
      await markOne(it, a, ctrl.signal);
    }
    setRunning(false);
    ctrlRef.current = null;
    if (!ctrl.signal.aborted && !onlyIds) {
      const done = itemsRef.current.filter((i) => i.status === 'done').length;
      toast(`Marking complete — ${done} script${done === 1 ? '' : 's'} ready for review`);
    }
  };

  const start = async () => {
    if (!rubric || !cls) return;
    let a = assessment;
    try {
      if (!a) {
        a = (await resolveAssessment(choice, { classId: cls.id, subjectId, termId, rubricId: rubric.id, createdBy: profile?.staffId }, options)) ?? null;
        if (!a) { toast('Choose a gradebook assessment', 'error'); return; }
        setAssessment(a);
        if (choice.mode === 'new') { setChoice({ ...choice, mode: 'existing', assessmentId: a.id }); setChoiceTouched(true); }
      }
    } catch (e: any) { toast(e.message, 'error'); setStep(0); return; }
    // duplicates
    const studentIds = new Set(itemsRef.current.filter((i) => i.status === 'queued').map((i) => i.studentId));
    const existing = allSubs.filter((s) => s.assessmentId === a!.id && s.rubricId === rubric.id && studentIds.has(s.studentId) && !overwriteRef.current.has(s.studentId));
    if (existing.length) {
      const names = existing.slice(0, 4).map((s) => s.studentName).join(', ') + (existing.length > 4 ? ` +${existing.length - 4} more` : '');
      const ok = await confirm({ title: `${existing.length} already marked`, body: `${names} already ${existing.length === 1 ? 'has' : 'have'} a marked script for this assessment. Overwrite with the new marking? (Cancel skips them.)`, confirmText: 'Overwrite' });
      if (ok) {
        // keep only the latest submission per student
        existing.sort((x, y) => y.timestamp - x.timestamp).forEach((s) => { if (!overwriteRef.current.has(s.studentId)) overwriteRef.current.set(s.studentId, s.id); });
      } else {
        const skip = new Set(existing.map((s) => s.studentId));
        setItems((its) => its.map((i) => (i.status === 'queued' && skip.has(i.studentId) ? { ...i, status: 'skipped', error: 'Already marked — skipped' } : i)));
        itemsRef.current = itemsRef.current.map((i) => (i.status === 'queued' && skip.has(i.studentId) ? { ...i, status: 'skipped' } : i));
      }
    }
    if (!batchStart) setBatchStart(Date.now() - 1000);
    setStep(2);
    runQueue(a!);
  };

  const cancel = () => { ctrlRef.current?.abort(); toast('Marking stopped — remaining scripts are still queued', 'info'); };

  const done = items.filter((i) => i.status === 'done');
  const finished = items.filter((i) => i.status !== 'queued' && i.status !== 'marking').length;
  const progress = items.length ? (finished / items.length) * 100 : 0;
  const allDone = step === 2 && !running && items.length > 0 && items.every((i) => i.status !== 'queued' && i.status !== 'marking');
  const reviewUrl = assessment && rubric ? `/acegrader/review?assessment=${assessment.id}&rubric=${rubric.id}&since=${batchStart}` : '/acegrader/review';

  if (!can) return <EmptyState title="Read-only" body="Your role cannot create marked submissions." />;

  const canNext0 = !!rubric && !!cls && !!subjectId && (choice.mode === 'existing' ? !!choice.assessmentId : choice.name.trim() && choice.maxMark > 0);
  const canNext1 = items.length > 0 && !unmatched && !dupes;

  return (
    <div>
      <PageHeader eyebrow="AceGrader · Marking session" title="Mark a batch of scripts"
        subtitle={<span className="flex items-center gap-2">Upload scripts, match them to learners and let AceGrader mark against your rubric. {aiAvailable ? <AiChip /> : <Badge tone="blue">Simulated mode</Badge>}</span>} />

      {/* stepper */}
      <ol className="no-print mb-6 flex items-center gap-2 overflow-x-auto">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <button disabled={running || i > step || (i < step && step === 2 && !allDone && items.some((x) => x.status !== 'queued'))} onClick={() => setStep(i)}
              className={cx('flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition', i === step ? 'bg-brand-800 text-white dark:bg-brand-600 dark:text-white' : i < step ? 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'bg-slate-100 text-slate-400 dark:bg-white/5')}>
              <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px]', i === step ? 'bg-white/20' : 'bg-black/5 dark:bg-white/10')}>{i < step ? '✓' : i + 1}</span>{s}
            </button>
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-slate-200 dark:bg-white/10" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Card title="What are you marking?">
            {!rubrics.length ? (
              <EmptyState title="No rubrics yet" body="Create a rubric first — AceGrader marks strictly against its criteria." action={<Button onClick={() => nav('/acegrader/rubrics/new')}>Create rubric</Button>} />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Rubric" required className="sm:col-span-2">
                  <Select value={rubricId} onChange={(e) => { setRubricId(e.target.value); setChoiceTouched(false); }}>
                    {rubrics.map((r) => <option key={r.id} value={r.id}>{r.title} ({rubricTotal(r)} marks)</option>)}
                  </Select>
                </Field>
                <Field label="Class" required>
                  <Select value={classId} onChange={(e) => { setClassId(e.target.value); setChoiceTouched(false); }}>
                    {myClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Subject" required>
                  <Select value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setChoiceTouched(false); }}>
                    {!classSubjects.length && <option value="">No subjects allocated</option>}
                    {classSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                <div className="sm:col-span-2">
                  <AssessmentFields value={choice} onChange={(v) => { setChoice(v); setChoiceTouched(true); setAssessment(null); }} options={options} />
                  {choice.mode === 'existing' && (() => { const a = options.find((x) => x.id === choice.assessmentId); return a && a.maxMark !== total ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Rubric totals {total}; scores will be scaled to /{a.maxMark} in the gradebook.</p> : null; })()}
                </div>
                {rubric && (
                  <div className="sm:col-span-2 rounded-2xl bg-paper-100/60 p-4 dark:bg-white/[0.03]">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Criteria</p>
                    <div className="flex flex-wrap gap-1.5">{rubric.criteria.map((c) => <Badge key={c.name}>{c.name} · {c.maxPoints}</Badge>)}</div>
                    {!!correctionsFor(corrections, rubric.id).length && <p className="mt-3 flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-300"><PenLine size={13} /> AI will calibrate to your {correctionsFor(corrections, rubric.id).length} most recent corrections on this rubric.</p>}
                  </div>
                )}
              </div>
            )}
          </Card>
          <Card title={<span className="flex items-center gap-2"><FileQuestion size={15} /> Question paper <span className="text-xs font-normal text-slate-400">(optional)</span></span>} subtitle="Gives the marker the task context — it is not marked.">
            {qp ? <FileChip file={qp} onRemove={() => setQp(null)} /> : <FileDrop multiple={false} compact onFiles={(f) => setQp(f[0] ?? null)} textPlaceholder="Paste the question / task instructions…" textButton="Use as question paper" />}
          </Card>
          <div className="flex justify-end lg:col-span-2">
            <Button size="lg" disabled={!canNext0} onClick={() => setStep(1)} icon={<ArrowRight size={16} />}>Next: add scripts</Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <Card title="Upload scripts" subtitle="Name files with the learner's surname or admission number and they'll be matched automatically.">
              <FileDrop onFiles={addFiles} allowText={false} />
            </Card>
            <Card title={`Scripts (${items.length})`} actions={items.length > 0 && <Button size="sm" variant="ghost" onClick={() => setItems([])}>Clear all</Button>} bodyClass="p-0">
              {!items.length ? <EmptyState icon={<ClipboardList size={22} />} title="No scripts yet" body="Drop files above, or type/paste a learner's work from the roster." /> : (
                <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {items.map((it) => {
                    const dup = it.studentId && (counts.get(it.studentId) ?? 0) > 1;
                    return (
                      <li key={it.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-white/5 dark:text-slate-400">{kindIcon(it.file.kind, 16)}</div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{it.file.name}</p>
                            <p className="text-[11px] text-slate-400">{it.file.input.type === 'text' ? `${it.file.input.content.split(/\s+/).length} words` : it.file.kind.toUpperCase()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {it.auto && it.studentId && <Badge tone="green"><UserCheck size={11} /> auto-matched</Badge>}
                          {dup && <Badge tone="red">duplicate</Badge>}
                          <Select value={it.studentId} onChange={(e) => update(it.id, { studentId: e.target.value, auto: false })} className={cx('w-52', !it.studentId && 'border-marigold-300 dark:border-marigold-500/40')}>
                            <option value="">Choose learner…</option>
                            {roster.map((s) => <option key={s.id} value={s.id}>{s.lastName}, {s.firstName} · {s.admissionNo}</option>)}
                          </Select>
                          <button onClick={() => setItems((x) => x.filter((y) => y.id !== it.id))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label="Remove"><Trash2 size={15} /></button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
          <Card title={<span className="flex items-center gap-2"><Users size={15} /> {cls?.name} roster</span>} subtitle={`${roster.filter((s) => counts.has(s.id)).length}/${roster.length} have a script`} bodyClass="max-h-[560px] overflow-y-auto p-2">
            {roster.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                {counts.has(s.id) ? <CheckCircle2 size={15} className="shrink-0 text-brand-500 dark:text-brand-300" /> : <CircleDashed size={15} className="shrink-0 text-slate-300 dark:text-slate-600" />}
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{s.lastName}, {s.firstName}</span>
                <button onClick={() => { setPasteFor(s.id); setPasteText(''); }} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"><Keyboard size={12} /> Paste</button>
              </div>
            ))}
          </Card>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
            <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStep(0)}>Back</Button>
            <div className="flex items-center gap-3">
              {(unmatched > 0 || dupes) && <p className="flex items-center gap-1.5 text-sm text-marigold-600 dark:text-marigold-400"><AlertTriangle size={15} />{unmatched ? `${unmatched} script(s) need a learner` : 'A learner has two scripts'}</p>}
              <Button size="lg" variant="secondary" disabled={!canNext1} icon={<Play size={16} />} onClick={start}>Mark {items.length} script{items.length === 1 ? '' : 's'}</Button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className={cx('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white', allDone ? 'bg-brand-500' : 'bg-marigold-500')}>
                {allDone ? <CheckCircle2 size={26} /> : running ? <Loader2 size={26} className="animate-spin" /> : <Square size={22} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-display tracking-tight text-2xl font-bold text-slate-900 dark:text-white">
                  {allDone ? 'Batch marked' : running ? `Marking ${Math.min(finished + 1, items.length)} of ${items.length}…` : 'Paused'}
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{rubric?.title} · {cls?.name} · {assessment?.name}</p>
                <Progress value={progress} tone={allDone ? 'green' : 'brand'} className="mt-3 h-2" />
              </div>
              <div className="flex gap-2">
                {running && <Button variant="outline" icon={<Square size={14} />} onClick={cancel}>Stop</Button>}
                {!running && !allDone && assessment && <Button variant="secondary" icon={<Play size={14} />} onClick={() => runQueue(assessment)}>Resume</Button>}
                {!running && done.length > 0 && <Button icon={<ArrowRight size={16} />} onClick={() => nav(reviewUrl)}>Review {done.length} script{done.length === 1 ? '' : 's'}</Button>}
              </div>
            </div>
          </Card>
          <Card bodyClass="p-0">
            <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              {items.map((it) => {
                const s = rosterIdx.get(it.studentId);
                const p = it.max ? resultPct({ totalScore: it.score ?? 0, maxTotalScore: it.max }) : null;
                return (
                  <li key={it.id} className={cx('flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center', it.status === 'marking' && 'bg-slate-100 dark:bg-white/[0.06]')}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {it.status === 'done' ? <CheckCircle2 size={18} className="shrink-0 text-brand-500 dark:text-brand-300" /> : it.status === 'failed' ? <XCircle size={18} className="shrink-0 text-rose-500 dark:text-rose-300" />
                        : it.status === 'marking' ? <Loader2 size={18} className="shrink-0 animate-spin text-sky-500 dark:text-sky-300" /> : it.status === 'skipped' ? <CircleDashed size={18} className="shrink-0 text-slate-400" /> : <CircleDashed size={18} className="shrink-0 text-slate-300 dark:text-slate-600" />}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{s ? fullName(s) : '—'}</p>
                        <p className={cx('truncate text-xs', it.status === 'failed' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400')}>{it.error ?? it.file.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {it.status === 'queued' && <Badge>Queued</Badge>}
                      {it.status === 'marking' && <Badge tone="blue">Marking…</Badge>}
                      {it.status === 'skipped' && <Badge>Skipped</Badge>}
                      {it.status === 'done' && <><span className="font-hand text-xl font-bold text-rose-700 dark:text-rose-300">{it.score}/{it.max}</span><Badge tone={p! >= 50 ? 'green' : 'amber'}>{Math.round(p!)}%</Badge>
                        <Button size="sm" variant="ghost" onClick={() => nav(`/acegrader/review/${it.submissionId}`)}>Open</Button></>}
                      {it.status === 'failed' && assessment && <Button size="sm" variant="outline" icon={<RotateCw size={13} />} disabled={running} onClick={() => runQueue(assessment, [it.id])}>Retry</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          {allDone && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => { setItems([]); setStep(1); setBatchStart(0); overwriteRef.current.clear(); }}>Mark more for this assessment</Button>
              <Button variant="secondary" icon={<ArrowRight size={16} />} onClick={() => nav(reviewUrl)}>Go to review queue</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={!!pasteFor} onClose={() => setPasteFor(null)} title={`Type or paste work — ${pasteFor ? fullName(rosterIdx.get(pasteFor)) : ''}`}
        footer={<><Button variant="outline" onClick={() => setPasteFor(null)}>Cancel</Button><Button onClick={savePaste} disabled={!pasteText.trim()}>Add script</Button></>} size="lg">
        <Textarea rows={14} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste the learner's answer here…" className="font-serif text-base leading-relaxed" autoFocus />
        <p className="mt-2 text-xs text-slate-400">{pasteText.trim() ? `${pasteText.trim().split(/\s+/).length} words` : 'Typed work is marked with full highlighting on the marked document.'}</p>
      </Modal>
    </div>
  );
}
