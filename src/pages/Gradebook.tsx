import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {BookOpenCheck, Download, MessageSquare, MessageSquarePlus, Pencil, Plus, Save, PenLine, Trash2, Undo2, Upload} from 'lucide-react';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCan, useClassStudents, useClassSubjects, useMyClasses } from '../lib/hooks';
import { newId, store, useCollection, useIndex } from '../lib/store';
import type { WriteOp } from '../lib/backend';
import {
  avg, cx, DEFAULT_SCALES, download, fmtDate, fullName, gradeColor, gradeFor, parseCSV, pct, round1, scaleKeyForLevel,
  termPercent, todayISO, toCSV,
} from '../lib/utils';
import type { Assessment, AssessmentType, Mark } from '../types';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner, StatCard, TableWrap, Textarea, useUI,
} from '../components/ui';

const TYPES: AssessmentType[] = ['test', 'assignment', 'exam', 'coursework', 'project'];
const TYPE_TONE: Record<AssessmentType, 'blue' | 'violet' | 'red' | 'amber' | 'green'> = {
  test: 'blue', assignment: 'violet', exam: 'red', coursework: 'amber', project: 'green',
};

type ParsedScore = { ok: true; value: number | null } | { ok: false };

function parseScore(raw: string, max: number): ParsedScore {
  const t = raw.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > max) return { ok: false };
  return { ok: true, value: n };
}

const fmtNum = (n: number | null | undefined) => (n == null ? '—' : String(round1(n)));

export default function Gradebook() {
  const { profile } = useAuth();
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const canMarks = useCan('marks');
  const canAssess = useCan('assessments');

  const classes = useMyClasses();
  const [classId, setClassId] = useState<string>(params.get('class') ?? '');
  const [subjectId, setSubjectId] = useState<string>(params.get('subject') ?? '');
  const [termId, setTermId] = useState<string>(params.get('term') ?? '');

  useEffect(() => { if (!termId && settings) setTermId((t) => t || settings.currentTermId); }, [settings, termId]);
  useEffect(() => {
    if (classes.length && !classes.some((c) => c.id === classId)) setClassId((classes.find((c) => c.levelOrder >= 2) ?? classes[0]!).id);
  }, [classes, classId]);

  const subjects = useClassSubjects(classId);
  useEffect(() => {
    if (subjects.length && !subjects.some((s) => s.id === subjectId)) setSubjectId(subjects[0]!.id);
  }, [subjects, subjectId]);

  const classIdx = useIndex('classes');
  const cls = classIdx.get(classId);
  const students = useClassStudents(classId);
  const { data: allAssess, loading: la } = useCollection('assessments');
  const { data: allMarks, loading: lm } = useCollection('marks');

  const assessments = useMemo(
    () => allAssess
      .filter((a) => a.classId === classId && a.subjectId === subjectId && a.termId === termId)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name)),
    [allAssess, classId, subjectId, termId],
  );
  const assessIds = useMemo(() => new Set(assessments.map((a) => a.id)), [assessments]);
  const savedMarks = useMemo(() => {
    const m = new Map<string, Mark>();
    for (const x of allMarks) if (assessIds.has(x.assessmentId)) m.set(`${x.assessmentId}_${x.studentId}`, x);
    return m;
  }, [allMarks, assessIds]);

  // ------------------------------------------------------------ drafts --
  const [draftScores, setDraftScores] = useState<Record<string, string>>({});
  const [draftComments, setDraftComments] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const assessById = useMemo(() => new Map(assessments.map((a) => [a.id, a])), [assessments]);
  /** mark key -> [assessmentId, studentId] for every cell in the grid (ids may contain underscores). */
  const keyInfo = useMemo(() => {
    const m = new Map<string, [string, string]>();
    for (const a of assessments) for (const s of students) m.set(`${a.id}_${s.id}`, [a.id, s.id]);
    return m;
  }, [assessments, students]);
  const assessOf = (k: string) => { const i = keyInfo.get(k); return i ? assessById.get(i[0]) : undefined; };

  const rawFor = (key: string) => {
    if (key in draftScores) return draftScores[key]!;
    const s = savedMarks.get(key)?.score;
    return s == null ? '' : String(s);
  };

  /** Keys whose draft differs from the saved value. */
  const dirtyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [k, raw] of Object.entries(draftScores)) {
      const a = assessOf(k);
      if (!a) continue;
      const saved = savedMarks.get(k)?.score ?? null;
      const p = parseScore(raw, a.maxMark);
      if (!p.ok || p.value !== saved) keys.add(k);
    }
    for (const [k, c] of Object.entries(draftComments)) {
      if ((savedMarks.get(k)?.comment ?? '') !== c) keys.add(k);
    }
    return keys;
  }, [draftScores, draftComments, savedMarks, keyInfo, assessById]);

  const invalidKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const [k, raw] of Object.entries(draftScores)) {
      const a = assessOf(k);
      if (a && !parseScore(raw, a.maxMark).ok) keys.add(k);
    }
    return keys;
  }, [draftScores, keyInfo, assessById]);

  const dirty = dirtyKeys.size > 0;

  // effective marks (saved overlaid with valid drafts) for live computations
  const effMarks = useMemo(() => {
    const m = new Map(savedMarks);
    for (const [k, raw] of Object.entries(draftScores)) {
      const info = keyInfo.get(k);
      if (!info) continue;
      const [aid, sid] = info;
      const a = assessById.get(aid)!;
      const p = parseScore(raw, a.maxMark);
      if (!p.ok) continue;
      const prev = m.get(k);
      m.set(k, { ...(prev ?? { id: k, assessmentId: aid, studentId: sid, classId, subjectId, termId }), score: p.value } as Mark);
    }
    return m;
  }, [savedMarks, draftScores, keyInfo, assessById, classId, subjectId, termId]);

  const discard = () => { setDraftScores({}); setDraftComments({}); };

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const guard = async (fn: () => void) => {
    if (dirty && !(await confirm({ title: 'Discard unsaved marks?', body: `You have ${dirtyKeys.size} unsaved change(s). Switching will discard them.`, confirmText: 'Discard', danger: true }))) return;
    discard();
    fn();
  };

  const save = async () => {
    if (invalidKeys.size) { toast(`Fix ${invalidKeys.size} invalid score(s) before saving.`, 'error'); return; }
    const ops: WriteOp[] = [];
    for (const k of dirtyKeys) {
      const info = keyInfo.get(k);
      if (!info) continue;
      const [aid, sid] = info;
      const a = assessById.get(aid)!;
      const existing = savedMarks.get(k);
      const p = parseScore(rawFor(k), a.maxMark);
      const score = p.ok ? p.value : existing?.score ?? null;
      const comment = k in draftComments ? draftComments[k]!.trim() || undefined : existing?.comment;
      if (!existing && score == null && !comment) continue;
      const data: Mark = {
        ...(existing ?? {}),
        id: k, assessmentId: aid, studentId: sid, classId: a.classId, subjectId: a.subjectId, termId: a.termId,
        score, comment, source: existing?.source ?? 'manual', submissionId: existing?.submissionId,
      };
      ops.push({ op: 'set', col: 'marks', id: k, data });
    }
    if (!ops.length) { discard(); return; }
    setSaving(true);
    try {
      await store.commit(ops);
      discard();
      toast(`Saved ${ops.length} mark${ops.length === 1 ? '' : 's'}.`);
    } catch (e: any) {
      toast(`Could not save: ${e.message}`, 'error');
    } finally { setSaving(false); }
  };

  // ---------------------------------------------------------- keyboard --
  const gridRef = useRef<HTMLDivElement>(null);
  const focusCell = (col: number, row: number) => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`input[data-cell="${col}-${row}"]`);
    if (el) { el.focus(); el.select(); return true; }
    return false;
  };
  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, col: number, row: number) => {
    if (e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const back = e.shiftKey || e.key === 'ArrowUp';
    let r = row + (back ? -1 : 1), c = col;
    if (r >= students.length) { r = 0; c = col + 1; }
    if (r < 0) { r = students.length - 1; c = col - 1; }
    if (c < 0 || c >= assessments.length) return; // let Tab leave the grid naturally
    e.preventDefault();
    focusCell(c, r);
  };

  // --------------------------------------------------------- per row ---
  const rows = useMemo(() => students.map((s) => {
    const p = termPercent(assessments, effMarks, s.id);
    return { s, p, g: gradeFor(p, cls, settings) };
  }), [students, assessments, effMarks, cls, settings]);

  const colAvg = (a: Assessment) => avg(students.map((s) => effMarks.get(`${a.id}_${s.id}`)?.score).filter((x): x is number => x != null));

  // ----------------------------------------------------------- stats ---
  const stats = useMemo(() => {
    const ps = rows.map((r) => r.p).filter((x): x is number => x != null);
    const pass = settings?.passMark ?? 50;
    const key = scaleKeyForLevel(cls?.levelOrder ?? 9);
    const bands = [...(settings?.scales?.[key] ?? DEFAULT_SCALES[key])].sort((a, b) => b.min - a.min);
    const dist = bands.map((b) => ({ grade: b.grade, count: rows.filter((r) => r.g?.grade === b.grade).length }));
    return {
      n: ps.length,
      mean: avg(ps),
      hi: ps.length ? Math.max(...ps) : null,
      lo: ps.length ? Math.min(...ps) : null,
      passRate: ps.length ? (ps.filter((p) => p >= pass).length / ps.length) * 100 : null,
      pass,
      dist,
    };
  }, [rows, settings, cls]);

  // -------------------------------------------------------- modals -----
  const [editing, setEditing] = useState<Partial<Assessment> | null>(null);
  const [commentKey, setCommentKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const deleteAssessment = async (a: Assessment) => {
    const n = allMarks.filter((m) => m.assessmentId === a.id).length;
    if (!(await confirm({ title: `Delete "${a.name}"?`, body: `This permanently removes the assessment and its ${n} recorded mark${n === 1 ? '' : 's'}.`, confirmText: 'Delete', danger: true }))) return;
    const ops: WriteOp[] = [
      { op: 'delete', col: 'assessments', id: a.id },
      ...allMarks.filter((m) => m.assessmentId === a.id).map((m) => ({ op: 'delete' as const, col: 'marks' as const, id: m.id })),
    ];
    try {
      await store.commit(ops);
      setDraftScores((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${a.id}_`))));
      setDraftComments((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith(`${a.id}_`))));
      setEditing(null);
      toast('Assessment deleted.');
    } catch (e: any) { toast(e.message, 'error'); }
  };

  const exportCSV = () => {
    const cols = ['Admission No', 'Student', ...assessments.map((a) => `${a.name} (/${a.maxMark})`), 'Term %', 'Grade'];
    const data = rows.map(({ s, p, g }) => {
      const r: Record<string, any> = { 'Admission No': s.admissionNo, Student: `${s.lastName}, ${s.firstName}` };
      assessments.forEach((a) => { r[`${a.name} (/${a.maxMark})`] = effMarks.get(`${a.id}_${s.id}`)?.score ?? ''; });
      r['Term %'] = p == null ? '' : round1(p);
      r.Grade = g?.grade ?? '';
      return r;
    });
    const subj = subjects.find((s) => s.id === subjectId);
    download(`gradebook_${cls?.name ?? classId}_${subj?.name ?? subjectId}_${termId}.csv`.replace(/\s+/g, '-'), toCSV(data, cols));
  };

  const openAceGrader = (a?: Assessment) => {
    const q = new URLSearchParams({ class: classId, subject: subjectId });
    if (a) q.set('assessment', a.id);
    navigate(`/acegrader/mark?${q.toString()}`);
  };

  const terms = settings?.terms ?? [];
  const loading = la || lm;

  // --------------------------------------------------------------- UI ---
  return (
    <div>
      <PageHeader
        eyebrow="Academics"
        title="Gradebook"
        subtitle="Capture assessment scores, track term marks and grades."
        actions={<>
          <Button variant="outline" icon={<PenLine size={16} />} disabled={!classId || !subjectId}
            onClick={() => openAceGrader(assessments[assessments.length - 1])}>Mark scripts with AceGrader</Button>
          {canAssess && <Button icon={<Plus size={16} />} disabled={!classId || !subjectId || !termId}
            onClick={() => setEditing({ name: '', type: 'test', maxMark: 50, weight: 1, date: todayISO() })}>New assessment</Button>}
        </>}
      />

      <div className="card mb-5 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="Class">
          <Select value={classId} onChange={(e) => { const v = e.target.value; guard(() => setClassId(v)); }}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Subject">
          <Select value={subjectId} onChange={(e) => { const v = e.target.value; guard(() => setSubjectId(v)); }} disabled={!subjects.length}>
            {!subjects.length && <option value="">No subjects allocated</option>}
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Term">
          <Select value={termId} onChange={(e) => { const v = e.target.value; guard(() => setTermId(v)); }}>
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === settings?.currentTermId ? ' (current)' : ''}</option>)}
          </Select>
        </Field>
      </div>

      {!classes.length ? (
        <Card><EmptyState title="No classes available" body="You are not allocated to any class yet." icon={<BookOpenCheck size={22} />} /></Card>
      ) : !subjects.length ? (
        <Card><EmptyState title="No subjects for this class" body="Allocate subjects and teachers to this class first." icon={<BookOpenCheck size={22} />} /></Card>
      ) : loading ? <Spinner /> : (
        <>
          <Card
            className="mb-5"
            title={<span className="flex items-center gap-2">{cls?.name} · {subjects.find((s) => s.id === subjectId)?.name}
              {dirty && <Badge tone="amber">{dirtyKeys.size} unsaved</Badge>}
              {invalidKeys.size > 0 && <Badge tone="red">{invalidKeys.size} invalid</Badge>}</span>}
            subtitle={`${students.length} students · ${assessments.length} assessment${assessments.length === 1 ? '' : 's'} · Tab / Enter moves down a column`}
            actions={<>
              <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={exportCSV} disabled={!students.length}>Export CSV</Button>
              {canMarks && <Button size="sm" variant="ghost" icon={<Upload size={14} />} onClick={() => setImportOpen(true)} disabled={!assessments.length}>Import CSV</Button>}
              {canMarks && dirty && <Button size="sm" variant="outline" icon={<Undo2 size={14} />} onClick={discard}>Discard</Button>}
              {canMarks && <Button size="sm" variant="secondary" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={save}>Save changes</Button>}
            </>}
            bodyClass="p-5 pt-0"
          >
            {!assessments.length ? (
              <EmptyState title="No assessments this term" body="Create a test, assignment or exam to start capturing marks."
                action={canAssess ? <Button icon={<Plus size={16} />} onClick={() => setEditing({ name: '', type: 'test', maxMark: 50, weight: 1, date: todayISO() })}>New assessment</Button> : undefined} />
            ) : !students.length ? (
              <EmptyState title="No active students in this class" />
            ) : (
              <div ref={gridRef}>
                <TableWrap>
                  <thead>
                    <tr className="bg-slate-50/70 dark:bg-white/[0.02]">
                      <th className="th sticky left-0 z-10 bg-slate-50 align-bottom dark:bg-ink-800">Student</th>
                      {assessments.map((a) => (
                        <th key={a.id} className="th min-w-[112px] align-bottom">
                          <div className="flex items-start justify-between gap-1">
                            <div className="min-w-0 normal-case tracking-normal">
                              <div className="truncate text-xs font-bold text-slate-800 dark:text-slate-100" title={a.name}>{a.name}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <Badge tone={TYPE_TONE[a.type]}>{a.type}</Badge>
                              </div>
                              <div className="mt-1 text-[11px] font-medium text-slate-400">/{a.maxMark} · w{a.weight} · {fmtDate(a.date, { day: 'numeric', month: 'short' })}</div>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              {canAssess && <button className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" title="Edit assessment" onClick={() => setEditing(a)}><Pencil size={12} /></button>}
                              <button className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-brand-600 dark:hover:bg-white/10" title="Mark with AceGrader" onClick={() => openAceGrader(a)}><PenLine size={12} /></button>
                            </div>
                          </div>
                        </th>
                      ))}
                      <th className="th align-bottom text-right">Term %</th>
                      <th className="th align-bottom text-center">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ s, p, g }, ri) => (
                      <tr key={s.id} className="tr tr-hover group">
                        <td className="td sticky left-0 z-10 bg-white group-hover:bg-slate-50 dark:bg-ink-800 dark:group-hover:bg-[#10141c]">
                          <div className="whitespace-nowrap font-semibold text-slate-800 dark:text-slate-100">{s.lastName}, {s.firstName}</div>
                          <div className="text-[11px] text-slate-400">{s.admissionNo}</div>
                        </td>
                        {assessments.map((a, ci) => {
                          const key = `${a.id}_${s.id}`;
                          const saved = savedMarks.get(key);
                          const invalid = invalidKeys.has(key);
                          const changed = dirtyKeys.has(key);
                          const comment = key in draftComments ? draftComments[key] : saved?.comment;
                          return (
                            <td key={a.id} className="td py-1.5">
                              <div className="flex items-center gap-1">
                                <input
                                  type="text" inputMode="decimal" data-cell={`${ci}-${ri}`}
                                  aria-label={`${fullName(s)} — ${a.name}`}
                                  className={cx('input h-8 w-16 px-2 py-1 text-right tabular-nums',
                                    invalid && 'border-slate-200 bg-slate-100 text-slate-700 focus:border-rose-500 focus:ring-rose-500/20 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200',
                                    !invalid && changed && 'border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/[0.06]')}
                                  value={rawFor(key)}
                                  disabled={!canMarks}
                                  title={invalid ? `Enter 0–${a.maxMark} or leave blank` : undefined}
                                  onChange={(e) => { const v = e.target.value; setDraftScores((d) => ({ ...d, [key]: v })); }}
                                  onKeyDown={(e) => onCellKey(e, ci, ri)}
                                  onFocus={(e) => e.target.select()}
                                />
                                <div className="flex w-7 flex-col items-center">
                                  {saved?.source === 'acegrader' && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-700 dark:bg-white/[0.06] dark:text-slate-200" title="Marked with AceGrader">AG</span>}
                                  {(canMarks || comment) && (
                                    <button className={cx('rounded p-0.5', comment ? 'text-brand-600 dark:text-brand-400' : 'text-slate-300 opacity-0 group-hover:opacity-100 focus:opacity-100 dark:text-slate-600')}
                                      title={comment || 'Add comment'} onClick={() => setCommentKey(key)}>
                                      {comment ? <MessageSquare size={13} /> : <MessageSquarePlus size={13} />}
                                    </button>
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        })}
                        <td className="td text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{pct(p, 1)}</td>
                        <td className={cx('td text-center font-bold', gradeColor(g?.grade))}>{g?.grade ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="tr bg-slate-50/70 dark:bg-white/[0.02]">
                      <td className="td sticky left-0 z-10 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-500 dark:bg-ink-800 dark:text-slate-400">Class average</td>
                      {assessments.map((a) => {
                        const v = colAvg(a);
                        return (
                          <td key={a.id} className="td text-xs tabular-nums text-slate-600 dark:text-slate-300">
                            <span className="font-semibold">{fmtNum(v)}</span>
                            {v != null && <span className="ml-1 text-slate-400">({pct((v / a.maxMark) * 100)})</span>}
                          </td>
                        );
                      })}
                      <td className="td text-right text-sm font-bold tabular-nums">{pct(stats.mean, 1)}</td>
                      <td className={cx('td text-center font-bold', gradeColor(gradeFor(stats.mean, cls, settings)?.grade))}>{gradeFor(stats.mean, cls, settings)?.grade ?? '—'}</td>
                    </tr>
                  </tfoot>
                </TableWrap>
              </div>
            )}
          </Card>

          {assessments.length > 0 && students.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
              <div className="grid grid-cols-2 gap-4">
                <StatCard label="Mean term mark" value={pct(stats.mean, 1)} sub={`${stats.n} of ${students.length} with marks`} tone="brand" />
                <StatCard label="Pass rate" value={pct(stats.passRate)} sub={`≥ ${stats.pass}%`} tone={stats.passRate != null && stats.passRate < 50 ? 'rose' : 'green'} />
                <StatCard label="Highest" value={pct(stats.hi, 1)} tone="violet" />
                <StatCard label="Lowest" value={pct(stats.lo, 1)} tone="amber" />
              </div>
              <Card title="Grade distribution" subtitle="Students per grade, from Term %">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.dist} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
                      <XAxis dataKey="grade" tickLine={false} axisLine={false} tick={{ fill: '#8f9f97', fontSize: 12, fontWeight: 600 }} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#8f9f97', fontSize: 11 }} />
                      <Tooltip cursor={{ fill: 'rgba(148,163,184,.12)' }} contentStyle={{ borderRadius: 12, fontSize: 12, border: '1px solid #dfe5e2' }} formatter={(v: any) => [v, 'Students']} />
                      <Bar dataKey="count" fill="#16a04c" radius={[4, 4, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      <AssessmentModal
        value={editing}
        onClose={() => setEditing(null)}
        onDelete={deleteAssessment}
        onSave={async (a) => {
          try {
            if (a.id) {
              await store.update('assessments', a.id, { name: a.name, type: a.type, maxMark: a.maxMark, weight: a.weight, date: a.date });
              toast('Assessment updated.');
            } else {
              await store.add('assessments', {
                id: newId(), name: a.name!, type: a.type!, maxMark: a.maxMark!, weight: a.weight!, date: a.date!,
                classId, subjectId, termId, createdBy: profile?.staffId,
              });
              toast('Assessment created.');
            }
            setEditing(null);
          } catch (e: any) { toast(e.message, 'error'); }
        }}
      />

      <CommentModal
        open={!!commentKey}
        title={(() => {
          if (!commentKey) return '';
          const info = keyInfo.get(commentKey);
          const st = students.find((x) => x.id === info?.[1]);
          return `${fullName(st)} · ${info ? assessById.get(info[0])?.name ?? '' : ''}`;
        })()}
        initial={commentKey ? (commentKey in draftComments ? draftComments[commentKey]! : savedMarks.get(commentKey)?.comment ?? '') : ''}
        readOnly={!canMarks}
        onClose={() => setCommentKey(null)}
        onSave={(c) => { if (commentKey) setDraftComments((d) => ({ ...d, [commentKey]: c })); setCommentKey(null); }}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        assessments={assessments}
        students={students}
        onApply={(aid, entries) => {
          setDraftScores((d) => {
            const n = { ...d };
            entries.forEach(([sid, v]) => { n[`${aid}_${sid}`] = v; });
            return n;
          });
          setImportOpen(false);
          toast(`Imported ${entries.length} score(s) into the grid. Review and save.`, 'info');
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ modals --
function AssessmentModal({ value, onClose, onSave, onDelete }: {
  value: Partial<Assessment> | null;
  onClose: () => void;
  onSave: (a: Partial<Assessment>) => Promise<void>;
  onDelete: (a: Assessment) => void;
}) {
  const [f, setF] = useState<Partial<Assessment>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (value) setF(value); }, [value]);
  const valid = !!f.name?.trim() && (f.maxMark ?? 0) > 0 && (f.weight ?? 0) > 0 && !!f.date;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    await onSave({ ...f, name: f.name!.trim() });
    setBusy(false);
  };
  return (
    <Modal open={!!value} onClose={onClose} title={f.id ? 'Edit assessment' : 'New assessment'}
      footer={<>
        {f.id && <Button variant="ghost" className="mr-auto text-rose-600 dark:text-rose-400" icon={<Trash2 size={15} />} onClick={() => onDelete(f as Assessment)}>Delete</Button>}
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!valid}>{f.id ? 'Save' : 'Create'}</Button>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Test 2 — Algebra" autoFocus />
        </Field>
        <Field label="Type">
          <Select value={f.type ?? 'test'} onChange={(e) => setF({ ...f, type: e.target.value as AssessmentType })}>
            {TYPES.map((t) => <option key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</option>)}
          </Select>
        </Field>
        <Field label="Date" required>
          <Input type="date" value={f.date ?? ''} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Maximum mark" required>
          <Input type="number" min={1} value={f.maxMark ?? ''} onChange={(e) => setF({ ...f, maxMark: Number(e.target.value) })} />
        </Field>
        <Field label="Weight" required hint="Relative weight in the term mark (e.g. exam 3, test 1).">
          <Input type="number" min={0.1} step={0.1} value={f.weight ?? ''} onChange={(e) => setF({ ...f, weight: Number(e.target.value) })} />
        </Field>
      </div>
    </Modal>
  );
}

function CommentModal({ open, title, initial, readOnly, onClose, onSave }: {
  open: boolean; title: string; initial: string; readOnly: boolean; onClose: () => void; onSave: (c: string) => void;
}) {
  const [c, setC] = useState('');
  useEffect(() => { if (open) setC(initial); }, [open, initial]);
  return (
    <Modal open={open} onClose={onClose} title="Mark comment" size="sm"
      footer={readOnly ? <Button variant="outline" onClick={onClose}>Close</Button> : <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSave(c)}>Apply</Button>
      </>}>
      <p className="mb-3 text-xs font-semibold text-slate-500 dark:text-slate-400">{title}</p>
      <Textarea value={c} onChange={(e) => setC(e.target.value)} readOnly={readOnly} placeholder="Feedback for the learner (appears on the report card)…" autoFocus />
      {!readOnly && <p className="mt-2 text-xs text-slate-400">Applied to the grid — remember to save changes.</p>}
    </Modal>
  );
}

function ImportModal({ open, onClose, assessments, students, onApply }: {
  open: boolean; onClose: () => void; assessments: Assessment[]; students: { id: string; admissionNo: string }[];
  onApply: (assessmentId: string, entries: [string, string][]) => void;
}) {
  const [aid, setAid] = useState('');
  const [text, setText] = useState('');
  useEffect(() => { if (open) { setAid(assessments[assessments.length - 1]?.id ?? ''); setText(''); } }, [open, assessments]);
  const a = assessments.find((x) => x.id === aid);

  const result = useMemo(() => {
    if (!text.trim() || !a) return null;
    const rows = parseCSV(text);
    const byAdm = new Map(students.map((s) => [s.admissionNo.trim().toLowerCase(), s.id]));
    const ok: [string, string][] = [];
    const unmatched: string[] = [];
    const invalid: string[] = [];
    for (const r of rows) {
      const norm = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().replace(/[^a-z]/g, ''), v]));
      const adm = (norm.admissionno ?? norm.admno ?? norm.admission ?? '').trim();
      const score = (norm.score ?? norm.mark ?? '').trim();
      if (!adm) continue;
      const sid = byAdm.get(adm.toLowerCase());
      if (!sid) { unmatched.push(adm); continue; }
      if (!parseScore(score, a.maxMark).ok) { invalid.push(`${adm} (${score})`); continue; }
      ok.push([sid, score]);
    }
    return { ok, unmatched, invalid, total: rows.length };
  }, [text, a, students]);

  const onFile = (file?: File) => {
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => setText(String(rd.result ?? ''));
    rd.readAsText(file);
  };

  return (
    <Modal open={open} onClose={onClose} title="Import scores from CSV" size="md"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!result?.ok.length} onClick={() => a && result && onApply(a.id, result.ok)}>Import {result?.ok.length ?? 0} score(s)</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Assessment">
          <Select value={aid} onChange={(e) => setAid(e.target.value)}>
            {assessments.map((x) => <option key={x.id} value={x.id}>{x.name} (/{x.maxMark})</option>)}
          </Select>
        </Field>
        <Field label="CSV file" hint="Columns: admissionNo,score. Blank score clears a mark.">
          <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])}
            className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 dark:file:bg-white/10 dark:file:text-slate-200 dark:text-slate-400" />
        </Field>
        <Field label="…or paste CSV">
          <Textarea className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'admissionNo,score\nGFA-2024-001,34\nGFA-2024-002,41'} />
        </Field>
        {result && (
          <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/[0.03]">
            <p><span className="font-semibold text-brand-600 dark:text-brand-400">{result.ok.length}</span> ready to import of {result.total} row(s).</p>
            {result.unmatched.length > 0 && <p className="mt-1 text-marigold-600 dark:text-marigold-400">Not in class: {result.unmatched.slice(0, 8).join(', ')}{result.unmatched.length > 8 ? '…' : ''}</p>}
            {result.invalid.length > 0 && <p className="mt-1 text-rose-600 dark:text-rose-400">Invalid (0–{a?.maxMark}): {result.invalid.slice(0, 8).join(', ')}{result.invalid.length > 8 ? '…' : ''}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
