import React, { useEffect, useMemo, useState } from 'react';
import {FlaskConical} from 'lucide-react';
import { Badge, Button, Field, Input, Modal, Select } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { newId, store, useCollection } from '../../lib/store';
import { cx, todayISO } from '../../lib/utils';
import type { Assessment, AssessmentType, SubmissionStatus } from '../../types';

// ------------------------------------------------------------ Score stamp --
export const ScoreStamp: React.FC<{ score: number; max: number; grade?: string | null; size?: 'sm' | 'lg'; className?: string; label?: string }> = ({ score, max, grade, size = 'lg', className, label = 'AceGrader' }) => {
  const p = max ? Math.round((score / max) * 100) : 0;
  const tone = p >= 65 ? 'border-brand-700/80 text-brand-700/90 dark:border-brand-400/80 dark:text-brand-300' : p >= 45 ? 'border-marigold-700/80 text-marigold-700/90 dark:border-marigold-400/80 dark:text-marigold-300' : 'border-rose-700/80 text-rose-700/90 dark:border-rose-400/80 dark:text-rose-300';
  return (
    <div key={`${score}/${max}`} className={cx('pointer-events-none select-none animate-stamp', className)} aria-label={`Score ${score} out of ${max}, ${p}%`}>
      <div className={cx('rounded-2xl border-[4px] bg-white/40 text-center dark:bg-transparent', tone, size === 'lg' ? 'px-5 py-3' : 'px-3 py-1.5')}>
        <div className={cx('border-b-2 border-current font-sans font-bold uppercase tracking-[0.2em]', size === 'lg' ? 'mb-1 pb-1 text-[9px]' : 'text-[7px]')}>{label}</div>
        <div className={cx('font-hand font-bold leading-none', size === 'lg' ? 'text-5xl' : 'text-2xl')}>{score}<span className={size === 'lg' ? 'text-2xl' : 'text-sm'}>/{max}</span></div>
        <div className={cx('font-sans font-bold uppercase tracking-wider', size === 'lg' ? 'mt-1 text-xs' : 'text-[9px]')}>{p}%{grade ? ` · ${grade}` : ''}</div>
      </div>
    </div>
  );
};

export const StatusBadge: React.FC<{ status: SubmissionStatus }> = ({ status }) =>
  status === 'approved' ? <Badge tone="green">Approved</Badge> : status === 'returned' ? <Badge tone="amber">Returned</Badge> : <Badge tone="blue">Pending review</Badge>;

export const SimBadge: React.FC = () => <Badge tone="slate">Estimate</Badge>;

export const AiChip: React.FC<{ className?: string }> = () => null;

// ------------------------------------------------------ Assessment linking --
export interface AssessmentChoice {
  mode: 'existing' | 'new' | 'none';
  assessmentId: string;
  name: string;
  maxMark: number;
  type: AssessmentType;
  weight: number;
}

export const emptyChoice = (name = '', maxMark = 0): AssessmentChoice => ({ mode: 'new', assessmentId: '', name, maxMark, type: 'assignment', weight: 1 });

const TYPES: AssessmentType[] = ['assignment', 'test', 'coursework', 'project', 'exam'];

export function useTermAssessments(classId?: string, subjectId?: string, termId?: string) {
  const { data } = useCollection('assessments');
  return useMemo(() => data.filter((a) => a.classId === classId && a.subjectId === subjectId && a.termId === termId).sort((a, b) => (b.date || '').localeCompare(a.date || '')), [data, classId, subjectId, termId]);
}

/** Controlled picker: link to existing assessment or define a new one. */
export const AssessmentFields: React.FC<{ value: AssessmentChoice; onChange: (v: AssessmentChoice) => void; options: Assessment[]; allowNone?: boolean; disabled?: boolean }> = ({ value, onChange, options, allowNone, disabled }) => {
  const sel = value.mode === 'existing' ? value.assessmentId : value.mode === 'none' ? '__none' : '__new';
  return (
    <div className="space-y-3">
      <Field label="Gradebook assessment">
        <Select value={sel} disabled={disabled} onChange={(e) => {
          const v = e.target.value;
          if (v === '__new') onChange({ ...value, mode: 'new', assessmentId: '' });
          else if (v === '__none') onChange({ ...value, mode: 'none', assessmentId: '' });
          else onChange({ ...value, mode: 'existing', assessmentId: v });
        }}>
          {options.map((a) => <option key={a.id} value={a.id}>{a.name} · /{a.maxMark} · {a.type}</option>)}
          <option value="__new">+ Create new assessment…</option>
          {allowNone && <option value="__none">Don't link yet</option>}
        </Select>
      </Field>
      {value.mode === 'new' && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-dashed border-slate-200 p-3 sm:grid-cols-4 dark:border-white/10">
          <Field label="Name" className="col-span-2"><Input value={value.name} disabled={disabled} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="e.g. Composition 2" /></Field>
          <Field label="Out of"><Input type="number" min={1} value={value.maxMark || ''} disabled={disabled} onChange={(e) => onChange({ ...value, maxMark: Number(e.target.value) })} /></Field>
          <Field label="Weight"><Input type="number" min={0} step={0.5} value={value.weight} disabled={disabled} onChange={(e) => onChange({ ...value, weight: Number(e.target.value) })} /></Field>
          <Field label="Type" className="col-span-2">
            <Select value={value.type} disabled={disabled} onChange={(e) => onChange({ ...value, type: e.target.value as AssessmentType })}>
              {TYPES.map((t) => <option key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</option>)}
            </Select>
          </Field>
        </div>
      )}
    </div>
  );
};

/** Creates the assessment if needed; returns the linked assessment (or undefined for 'none'). */
export async function resolveAssessment(choice: AssessmentChoice, ctx: { classId: string; subjectId: string; termId: string; rubricId?: string; createdBy?: string }, existing: Assessment[]): Promise<Assessment | undefined> {
  if (choice.mode === 'none') return undefined;
  if (choice.mode === 'existing') {
    const a = existing.find((x) => x.id === choice.assessmentId);
    if (!a) throw new Error('Choose an assessment.');
    return a;
  }
  if (!choice.name.trim()) throw new Error('Give the new assessment a name.');
  if (!(choice.maxMark > 0)) throw new Error('The assessment must be out of at least 1 mark.');
  const a: Assessment = {
    id: newId(), name: choice.name.trim(), type: choice.type, classId: ctx.classId, subjectId: ctx.subjectId, termId: ctx.termId,
    maxMark: choice.maxMark, weight: choice.weight > 0 ? choice.weight : 1, date: todayISO(), rubricId: ctx.rubricId, createdBy: ctx.createdBy,
  };
  await store.set('assessments', a);
  return a;
}

/** Modal to link an assessment (used when approving an unlinked submission). */
export const LinkAssessmentModal: React.FC<{
  open: boolean; onClose: () => void; onLinked: (a: Assessment) => void;
  classId: string; subjectId?: string; termId: string; rubricId: string; defaultName: string; defaultMax: number;
  subjects: { id: string; name: string }[];
}> = ({ open, onClose, onLinked, classId, subjectId, termId, rubricId, defaultName, defaultMax, subjects }) => {
  const { profile } = useAuth();
  const [subj, setSubj] = useState(subjectId ?? '');
  const options = useTermAssessments(classId, subj, termId);
  const [choice, setChoice] = useState<AssessmentChoice>(emptyChoice(defaultName, defaultMax));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setSubj(subjectId ?? subjects[0]?.id ?? ''); setChoice(emptyChoice(defaultName, defaultMax)); setErr(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const linked = options.find((a) => a.rubricId === rubricId);
    if (linked) setChoice((c) => ({ ...c, mode: 'existing', assessmentId: linked.id }));
  }, [options, rubricId]);
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const a = await resolveAssessment(choice, { classId, subjectId: subj, termId, rubricId, createdBy: profile?.staffId }, options);
      if (a) onLinked(a);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} title="Link to a gradebook assessment" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy} disabled={!subj}>Link & continue</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">The mark will be scaled to the assessment's maximum and written to the gradebook.</p>
        <Field label="Subject">
          <Select value={subj} onChange={(e) => setSubj(e.target.value)}>
            <option value="">Choose…</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {subj && <AssessmentFields value={choice} onChange={setChoice} options={options} />}
        {err && <p className="text-sm text-rose-600 dark:text-rose-300">{err}</p>}
      </div>
    </Modal>
  );
};
