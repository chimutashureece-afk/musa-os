import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {AlertTriangle, ArrowRight, BookOpen, CheckCircle2, DoorOpen, GraduationCap, Layers, Pencil, Plus, School, Trash2, UserRound, Users} from 'lucide-react';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCan, useClasses } from '../lib/hooks';
import { newId, store, useCollection, useIndex } from '../lib/store';
import { WriteOp } from '../lib/backend';
import { Allocation, SchoolClass, Section, Staff, Student, Subject } from '../types';
import {
  Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Progress, SearchInput, Select, Spinner, TableWrap, Tabs, useUI,
} from '../components/ui';
import { LEVELS, levelsFor, classSort, cx, fullName, staffName, sum } from '../lib/utils';

type TabId = 'classes' | 'subjects' | 'allocations' | 'promotion';
const MAX_LOAD = 36;

const teacherLabel = (s?: Staff) => (s ? `${s.title} ${s.firstName[0]}. ${s.lastName}` : 'Unassigned');
const byTeacherName = (a: Staff, b: Staff) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);

export default function Classes() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const classes = useClasses();
  const { data: students } = useCollection('students');
  const { data: subjects } = useCollection('subjects');
  const { data: allocations } = useCollection('allocations');
  const { data: staff, loading: staffLoading } = useCollection('staff');
  const { loading } = useCollection('classes');
  const [tab, setTab] = useState<TabId>('classes');

  const active = useMemo(() => students.filter((s) => s.status === 'active'), [students]);
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'classes', label: 'Classes', count: classes.length },
    { id: 'subjects', label: 'Subjects', count: subjects.length },
    { id: 'allocations', label: 'Allocations', count: allocations.length },
    ...(isAdmin ? [{ id: 'promotion' as const, label: 'Promotion' }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Academics" title="Classes & subjects"
        subtitle={`${classes.length} classes · ${subjects.length} subjects · ${active.length} active learners`} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {loading || staffLoading ? <Spinner /> : (
        <>
          {tab === 'classes' && <ClassesTab classes={classes} students={active} staff={staff} subjects={subjects} allocations={allocations} />}
          {tab === 'subjects' && <SubjectsTab subjects={subjects} allocations={allocations} />}
          {tab === 'allocations' && <AllocationsTab classes={classes} subjects={subjects} allocations={allocations} staff={staff} />}
          {tab === 'promotion' && isAdmin && <PromotionTab classes={classes} students={active} />}
        </>
      )}
    </div>
  );
}

// ===================================================================== classes
const ClassesTab: React.FC<{ classes: SchoolClass[]; students: Student[]; staff: Staff[]; subjects: Subject[]; allocations: Allocation[] }> = ({ classes, students, staff, subjects, allocations }) => {
  const canEdit = useCan('classes');
  const { toast, confirm } = useUI();
  const staffIdx = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const subjectIdx = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const { data: timetable } = useCollection('timetable');
  const [form, setForm] = useState<{ open: boolean; cls: SchoolClass | null }>({ open: false, cls: null });
  const [viewId, setViewId] = useState<string | null>(null);

  const byClass = useMemo(() => {
    const m = new Map<string, Student[]>();
    students.forEach((s) => { const l = m.get(s.classId) ?? []; l.push(s); m.set(s.classId, l); });
    m.forEach((l) => l.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)));
    return m;
  }, [students]);

  const remove = async (c: SchoolClass) => {
    const n = byClass.get(c.id)?.length ?? 0;
    if (n) { toast(`${c.name} still has ${n} active learner${n === 1 ? '' : 's'}. Move them to another class first.`, 'error'); return; }
    const al = allocations.filter((a) => a.classId === c.id);
    const tt = timetable.filter((t) => t.classId === c.id);
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      body: `This removes the class${al.length ? `, its ${al.length} subject allocation${al.length === 1 ? '' : 's'}` : ''}${tt.length ? ` and ${tt.length} timetable slots` : ''}. Historical marks and registers are kept.`,
      confirmText: 'Delete class', danger: true,
    });
    if (!ok) return;
    try {
      await store.commit([
        { op: 'delete', col: 'classes', id: c.id },
        ...al.map((a) => ({ op: 'delete' as const, col: 'allocations' as const, id: a.id })),
        ...tt.map((t) => ({ op: 'delete' as const, col: 'timetable' as const, id: t.id })),
      ]);
      toast(`${c.name} deleted`);
    } catch (e: any) { toast(e?.message ?? 'Delete failed', 'error'); }
  };

  const groups: { section: Section; label: string; items: SchoolClass[] }[] = [
    { section: 'primary', label: 'Primary (Junior school)', items: classes.filter((c) => c.section === 'primary') },
    { section: 'secondary', label: 'Secondary', items: classes.filter((c) => c.section === 'secondary') },
  ];
  const view = viewId ? classes.find((c) => c.id === viewId) : undefined;

  return (
    <div className="space-y-8">
      {canEdit && (
        <div className="flex justify-end">
          <Button icon={<Plus size={16} />} onClick={() => setForm({ open: true, cls: null })}>New class</Button>
        </div>
      )}
      {classes.length === 0 && (
        <Card><EmptyState icon={<School size={22} />} title="No classes yet" body="Create your first class to start enrolling learners."
          action={canEdit ? <Button icon={<Plus size={16} />} onClick={() => setForm({ open: true, cls: null })}>New class</Button> : undefined} /></Card>
      )}
      {groups.filter((g) => g.items.length).map((g) => {
        const total = sum(g.items.map((c) => byClass.get(c.id)?.length ?? 0));
        return (
          <section key={g.section}>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display tracking-tight text-2xl font-bold text-slate-900 dark:text-white">{g.label}</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{g.items.length} classes · {total} learners</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {g.items.map((c) => {
                const list = byClass.get(c.id) ?? [];
                const n = list.length;
                const boys = list.filter((s) => s.gender === 'M').length;
                const fill = c.capacity ? (n / c.capacity) * 100 : 0;
                const teacher = c.classTeacherId ? staffIdx.get(c.classTeacherId) : undefined;
                return (
                  <div key={c.id} role="button" tabIndex={0} onClick={() => setViewId(c.id)} onKeyDown={(e) => e.key === 'Enter' && setViewId(c.id)}
                    className="card group cursor-pointer p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-400/40">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-bold text-slate-900 dark:text-white">{c.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{c.level}{c.stream ? ` · Stream ${c.stream}` : ''}</p>
                      </div>
                      {canEdit && (
                        <div className="flex gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Edit class" onClick={() => setForm({ open: true, cls: c })}><Pencil size={15} /></button>
                          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label="Delete class" onClick={() => remove(c)}><Trash2 size={15} /></button>
                        </div>
                      )}
                    </div>
                    <div className="mt-4 space-y-2 text-sm">
                      <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><UserRound size={14} className="text-slate-400" />{teacher ? `${teacher.title} ${teacher.firstName} ${teacher.lastName}` : <span className="text-slate-400">No class teacher</span>}</p>
                      <p className="flex items-center gap-2 text-slate-600 dark:text-slate-300"><DoorOpen size={14} className="text-slate-400" />{c.room || <span className="text-slate-400">No room set</span>}</p>
                    </div>
                    <div className="mt-4">
                      <div className="mb-1.5 flex items-baseline justify-between text-xs">
                        <span className="font-semibold text-slate-700 dark:text-slate-200"><span className="text-base font-bold">{n}</span> / {c.capacity} enrolled</span>
                        <span className="text-slate-500 dark:text-slate-400">{boys} boys · {n - boys} girls</span>
                      </div>
                      <Progress value={fill} tone={fill > 100 ? 'rose' : fill >= 90 ? 'amber' : 'brand'} />
                      {n > 0 && (
                        <div className="mt-2 flex h-1 overflow-hidden rounded-full">
                          <div className="bg-sky-400" style={{ width: `${(boys / n) * 100}%` }} title={`${boys} boys`} />
                          <div className="bg-pink-400" style={{ width: `${((n - boys) / n) * 100}%` }} title={`${n - boys} girls`} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <ClassFormModal open={form.open} cls={form.cls} staff={staff} classes={classes} onClose={() => setForm({ open: false, cls: null })} />

      <Modal open={!!view} onClose={() => setViewId(null)} size="lg" title={view?.name ?? ''}
        footer={view ? <>
          {canEdit && <Button variant="outline" icon={<Pencil size={16} />} onClick={() => { setForm({ open: true, cls: view }); setViewId(null); }}>Edit class</Button>}
          <Link to={`/students?class=${view.id}`}><Button variant="outline" icon={<Users size={16} />}>Open in register</Button></Link>
        </> : undefined}>
        {view && (() => {
          const list = byClass.get(view.id) ?? [];
          const al = allocations.filter((a) => a.classId === view.id).sort((a, b) => (subjectIdx.get(a.subjectId)?.name ?? '').localeCompare(subjectIdx.get(b.subjectId)?.name ?? ''));
          const teacher = view.classTeacherId ? staffIdx.get(view.classTeacherId) : undefined;
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Info label="Level" value={view.level} />
                <Info label="Class teacher" value={teacher ? staffName(teacher) : '—'} />
                <Info label="Room" value={view.room || '—'} />
                <Info label="Enrolment" value={`${list.length} / ${view.capacity}`} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="label">Learners ({list.length})</p>
                  {list.length === 0 ? <p className="text-sm text-slate-400">No active learners in this class</p> : (
                    <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
                      {list.map((s, i) => (
                        <li key={s.id}>
                          <Link to={`/students/${s.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                            <span className="w-5 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                            <Avatar name={fullName(s)} size={28} />
                            <span className="flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{s.lastName}, {s.firstName}</span>
                            <span className="text-xs text-slate-400">{s.gender}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="label">Subjects & teachers ({al.length})</p>
                  {al.length === 0 ? <p className="text-sm text-slate-400">No subjects allocated yet</p> : (
                    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-white/5 dark:border-white/10">
                      {al.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{subjectIdx.get(a.subjectId)?.name ?? 'Unknown subject'}</span>
                            <span className="text-xs text-slate-400">{teacherLabel(staffIdx.get(a.teacherId))}</span>
                          </span>
                          <Badge>{a.periodsPerWeek} p/w</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
};

const Info: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.03]">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
    <p className="mt-0.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{value}</p>
  </div>
);

const suggestName = (level: string, stream: string, section: Section) =>
  !stream ? level : section === 'secondary' && stream.length <= 2 ? `${level}${stream}` : `${level} ${stream}`;

const ClassFormModal: React.FC<{ open: boolean; cls: SchoolClass | null; staff: Staff[]; classes: SchoolClass[]; onClose: () => void }> = ({ open, cls, staff, classes, onClose }) => {
  const { toast } = useUI();
  const settings = useSettings();
  const offered = levelsFor(settings);
  const defaultLevel = settings?.schoolType === 'primary' ? 'Grade 1' : 'Form 1';
  const [level, setLevel] = useState(defaultLevel);
  const [stream, setStream] = useState('A');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [teacher, setTeacher] = useState('');
  const [room, setRoom] = useState('');
  const [capacity, setCapacity] = useState(40);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLevel(cls?.level ?? defaultLevel);
    setStream(cls?.stream ?? 'A');
    setName(cls?.name ?? '');
    setNameTouched(!!cls);
    setTeacher(cls?.classTeacherId ?? '');
    setRoom(cls?.room ?? '');
    setCapacity(cls?.capacity ?? 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cls?.id]);

  const lv = LEVELS.find((l) => l.level === level) ?? offered[0]!;
  const autoName = suggestName(lv.level, stream.trim(), lv.section);
  const finalName = (nameTouched ? name : autoName).trim();
  const clash = classes.some((c) => c.name.toLowerCase() === finalName.toLowerCase() && c.id !== cls?.id);
  const otherClassOf = teacher ? classes.find((c) => c.classTeacherId === teacher && c.id !== cls?.id) : undefined;
  const teachers = staff.filter((s) => s.status !== 'left').sort(byTeacherName);

  const save = async () => {
    if (!finalName) { toast('Give the class a name', 'error'); return; }
    if (clash) { toast('Another class already has that name', 'error'); return; }
    if (!capacity || capacity < 1) { toast('Capacity must be at least 1', 'error'); return; }
    setSaving(true);
    try {
      const doc: SchoolClass = {
        ...(cls ?? {}), id: cls?.id ?? newId(), name: finalName, level: lv.level, levelOrder: lv.order, section: lv.section, stream: stream.trim(),
        classTeacherId: teacher || undefined, room: room.trim() || undefined, capacity: Math.round(capacity),
      };
      await store.set('classes', doc);
      toast(cls ? `${doc.name} updated` : `${doc.name} created`);
      onClose();
    } catch (e: any) { toast(e?.message ?? 'Could not save', 'error'); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={cls ? `Edit ${cls.name}` : 'New class'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>{cls ? 'Save changes' : 'Create class'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Level" required hint={`${lv.section === 'primary' ? 'Primary' : 'Secondary'} section`}>
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            {offered.some((l) => l.section === 'primary') && <optgroup label="Primary">{offered.filter((l) => l.section === 'primary').map((l) => <option key={l.level}>{l.level}</option>)}</optgroup>}
            {offered.some((l) => l.section === 'secondary') && <optgroup label="Secondary">{offered.filter((l) => l.section === 'secondary').map((l) => <option key={l.level} value={l.level}>{l.level}{l.order === 13 ? ' (Lower 6)' : l.order === 14 ? ' (Upper 6)' : ''}</option>)}</optgroup>}
          </Select>
        </Field>
        <Field label="Stream" hint="e.g. A, B, Blue, Sciences"><Input value={stream} onChange={(e) => setStream(e.target.value)} /></Field>
        <Field label="Class name" required className="sm:col-span-2" hint={!nameTouched ? 'Suggested from level and stream — edit to override' : undefined}>
          <Input value={nameTouched ? name : autoName} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} />
          {clash && <span className="mt-1 block text-xs text-rose-500 dark:text-rose-300">Another class already uses this name</span>}
        </Field>
        <Field label="Class teacher" className="sm:col-span-2">
          <Select value={teacher} onChange={(e) => setTeacher(e.target.value)}>
            <option value="">Not assigned</option>
            {teachers.map((s) => <option key={s.id} value={s.id}>{s.title} {s.firstName} {s.lastName} — {s.position}</option>)}
          </Select>
          {otherClassOf && <span className="mt-1 flex items-center gap-1 text-xs text-marigold-600 dark:text-marigold-400"><AlertTriangle size={12} />Already class teacher of {otherClassOf.name}</span>}
        </Field>
        <Field label="Room"><Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. S-05, Lab 2" /></Field>
        <Field label="Capacity" required><Input type="number" min={1} max={120} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></Field>
      </div>
    </Modal>
  );
};

// ==================================================================== subjects
const SubjectsTab: React.FC<{ subjects: Subject[]; allocations: Allocation[] }> = ({ subjects, allocations }) => {
  const canEdit = useCan('subjects');
  const { toast, confirm } = useUI();
  const [q, setQ] = useState('');
  const [section, setSection] = useState<Section | 'both' | ''>('');
  const [form, setForm] = useState<{ open: boolean; subject: Subject | null }>({ open: false, subject: null });

  const offering = useMemo(() => {
    const m = new Map<string, Set<string>>();
    allocations.forEach((a) => { const s = m.get(a.subjectId) ?? new Set(); s.add(a.classId); m.set(a.subjectId, s); });
    return m;
  }, [allocations]);

  const filtered = subjects
    .filter((s) => (!section || s.section === section) && (!q.trim() || `${s.name} ${s.code} ${s.department}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => (a.section === b.section ? 0 : a.section === 'primary' ? -1 : 1) || a.name.localeCompare(b.name));

  const remove = async (s: Subject) => {
    const n = offering.get(s.id)?.size ?? 0;
    if (n) { toast(`${s.name} is offered in ${n} class${n === 1 ? '' : 'es'}. Remove those allocations first.`, 'error'); return; }
    if (!(await confirm({ title: `Delete ${s.name}?`, body: 'The subject will be removed from the catalogue. Past marks remain in the gradebook history.', confirmText: 'Delete', danger: true }))) return;
    try { await store.remove('subjects', s.id); toast('Subject deleted'); } catch (e: any) { toast(e?.message ?? 'Delete failed', 'error'); }
  };

  return (
    <Card title="Subject catalogue" subtitle={`${subjects.length} subjects`}
      actions={canEdit ? <Button size="sm" icon={<Plus size={14} />} onClick={() => setForm({ open: true, subject: null })}>New subject</Button> : undefined}>
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <SearchInput value={q} onChange={setQ} placeholder="Search subjects, codes, departments…" />
        <Select value={section} onChange={(e) => setSection(e.target.value as Section | 'both' | '')}>
          <option value="">All sections</option><option value="primary">Primary</option><option value="secondary">Secondary</option><option value="both">Both</option>
        </Select>
      </div>
      {filtered.length === 0 ? <EmptyState icon={<BookOpen size={22} />} title={subjects.length ? 'No subjects match' : 'No subjects yet'} /> : (
        <TableWrap>
          <thead><tr><th className="th pl-5">Subject</th><th className="th">Code</th><th className="th">Section</th><th className="th">Department</th><th className="th text-right">Classes</th>{canEdit && <th className="th pr-5 text-right">Actions</th>}</tr></thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id} className="tr tr-hover">
                <td className="td pl-5 font-medium">{s.name}</td>
                <td className="td font-mono text-xs text-slate-500 dark:text-slate-400">{s.code}</td>
                <td className="td"><Badge tone={s.section === 'primary' ? 'sky' : s.section === 'secondary' ? 'violet' : 'slate'}>{s.section === 'both' ? 'Both' : s.section === 'primary' ? 'Primary' : 'Secondary'}</Badge></td>
                <td className="td">{s.department || '—'}</td>
                <td className="td text-right tabular-nums">{offering.get(s.id)?.size ?? 0}</td>
                {canEdit && (
                  <td className="td pr-5">
                    <div className="flex justify-end gap-1">
                      <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Edit" onClick={() => setForm({ open: true, subject: s })}><Pencil size={15} /></button>
                      <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label="Delete" onClick={() => remove(s)}><Trash2 size={15} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <SubjectFormModal open={form.open} subject={form.subject} subjects={subjects} onClose={() => setForm({ open: false, subject: null })} />
    </Card>
  );
};

const SubjectFormModal: React.FC<{ open: boolean; subject: Subject | null; subjects: Subject[]; onClose: () => void }> = ({ open, subject, subjects, onClose }) => {
  const { toast } = useUI();
  const [d, setD] = useState<Omit<Subject, 'id'>>({ name: '', code: '', section: 'secondary', department: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setD(subject ? { name: subject.name, code: subject.code, section: subject.section, department: subject.department } : { name: '', code: '', section: 'secondary', department: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subject?.id]);
  const departments = [...new Set(subjects.map((s) => s.department).filter(Boolean))].sort();

  const save = async () => {
    if (!d.name.trim()) { toast('Subject name is required', 'error'); return; }
    if (d.code.trim() && subjects.some((s) => s.code.toLowerCase() === d.code.trim().toLowerCase() && s.id !== subject?.id)) { toast('That subject code is already used', 'error'); return; }
    setSaving(true);
    try {
      await store.set('subjects', { ...(subject ?? {}), id: subject?.id ?? newId(), name: d.name.trim(), code: d.code.trim().toUpperCase(), section: d.section, department: d.department.trim() });
      toast(subject ? 'Subject updated' : 'Subject added');
      onClose();
    } catch (e: any) { toast(e?.message ?? 'Could not save', 'error'); } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={subject ? `Edit ${subject.name}` : 'New subject'} size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required><Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus placeholder="e.g. Combined Science" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" hint="ZIMSEC code or short code"><Input value={d.code} onChange={(e) => setD({ ...d, code: e.target.value })} className="font-mono" placeholder="4003" /></Field>
          <Field label="Section">
            <Select value={d.section} onChange={(e) => setD({ ...d, section: e.target.value as Subject['section'] })}>
              <option value="primary">Primary</option><option value="secondary">Secondary</option><option value="both">Both</option>
            </Select>
          </Field>
        </div>
        <Field label="Department">
          <Input value={d.department} onChange={(e) => setD({ ...d, department: e.target.value })} list="subject-departments" placeholder="e.g. Sciences" />
          <datalist id="subject-departments">{departments.map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
      </div>
    </Modal>
  );
};

// ================================================================= allocations
const AllocationsTab: React.FC<{ classes: SchoolClass[]; subjects: Subject[]; allocations: Allocation[]; staff: Staff[] }> = ({ classes, subjects, allocations, staff }) => {
  const canEdit = useCan('allocations');
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const subjectIdx = useIndex('subjects');
  const classIdx = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const staffIdx = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [newSub, setNewSub] = useState('');
  const [newTeacher, setNewTeacher] = useState('');
  const [newPeriods, setNewPeriods] = useState(4);
  const [adding, setAdding] = useState(false);

  useEffect(() => { if (!classId && classes[0]) setClassId(classes[0].id); }, [classes, classId]);

  const cls = classIdx.get(classId);
  const rows = allocations.filter((a) => a.classId === classId).sort((a, b) => (subjectIdx.get(a.subjectId)?.name ?? '').localeCompare(subjectIdx.get(b.subjectId)?.name ?? ''));
  const capacity = (settings?.periodsPerDay ?? 8) * 5;
  const total = sum(rows.map((r) => r.periodsPerWeek || 0));
  const taken = new Set(rows.map((r) => r.subjectId));
  const available = subjects.filter((s) => !taken.has(s.id) && (!cls || s.section === 'both' || s.section === cls.section)).sort((a, b) => a.name.localeCompare(b.name));
  const teachers = staff.filter((s) => s.status !== 'left').sort(byTeacherName);

  const load = useMemo(() => {
    const m = new Map<string, { periods: number; classes: Set<string>; subjects: number }>();
    allocations.forEach((a) => {
      const x = m.get(a.teacherId) ?? { periods: 0, classes: new Set<string>(), subjects: 0 };
      x.periods += a.periodsPerWeek || 0; x.classes.add(a.classId); x.subjects++;
      m.set(a.teacherId, x);
    });
    return [...m.entries()].map(([id, x]) => ({ id, staff: staffIdx.get(id), ...x })).sort((a, b) => b.periods - a.periods);
  }, [allocations, staffIdx]);

  const update = async (a: Allocation, patch: Partial<Allocation>) => {
    try { await store.update('allocations', a.id, patch); toast('Allocation updated'); } catch (e: any) { toast(e?.message ?? 'Update failed', 'error'); }
  };
  const remove = async (a: Allocation) => {
    const sname = subjectIdx.get(a.subjectId)?.name ?? 'this subject';
    if (!(await confirm({ title: `Remove ${sname}?`, body: `${sname} will no longer be allocated to ${cls?.name}. Existing marks are kept; timetable slots for it are not removed automatically.`, confirmText: 'Remove', danger: true }))) return;
    try { await store.remove('allocations', a.id); toast('Allocation removed'); } catch (e: any) { toast(e?.message ?? 'Remove failed', 'error'); }
  };
  const add = async () => {
    if (!newSub || !newTeacher) { toast('Choose a subject and a teacher', 'error'); return; }
    setAdding(true);
    try {
      const id = `al-${classId}-${newSub}`;
      await store.set('allocations', { id, classId, subjectId: newSub, teacherId: newTeacher, periodsPerWeek: Math.max(1, Math.round(newPeriods || 1)) });
      toast(`${subjectIdx.get(newSub)?.name} allocated`);
      setNewSub(''); setNewPeriods(4);
    } catch (e: any) { toast(e?.message ?? 'Could not add', 'error'); } finally { setAdding(false); }
  };

  if (!classes.length) return <Card><EmptyState icon={<Layers size={22} />} title="Create a class first" body="Allocations link a subject and a teacher to a class." /></Card>;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card title="Subject allocations" subtitle={cls ? `${cls.name} · ${rows.length} subjects` : undefined}
        actions={<Select value={classId} onChange={(e) => setClassId(e.target.value)} className="h-9 w-48 py-1">{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}>
        <div className="mb-5 rounded-xl bg-slate-50 p-4 dark:bg-white/[0.03]">
          <div className="mb-2 flex items-baseline justify-between text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{total} of {capacity} periods allocated per week</span>
            <span className={cx('text-xs font-semibold', total > capacity ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>
              {total > capacity ? `${total - capacity} over capacity` : `${capacity - total} free`}
            </span>
          </div>
          <Progress value={(total / capacity) * 100} tone={total > capacity ? 'rose' : total >= capacity * 0.9 ? 'green' : 'brand'} />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Capacity = {settings?.periodsPerDay ?? 8} periods × 5 days.</p>
        </div>
        {rows.length === 0 ? <EmptyState icon={<BookOpen size={22} />} title="No subjects allocated" body={canEdit ? 'Add subjects below to build this class’s curriculum.' : undefined} /> : (
          <TableWrap>
            <thead><tr><th className="th pl-5">Subject</th><th className="th">Teacher</th><th className="th w-32 text-right">Periods / wk</th>{canEdit && <th className="th w-12 pr-5" />}</tr></thead>
            <tbody>
              {rows.map((a) => {
                const t = staffIdx.get(a.teacherId);
                const tl = load.find((x) => x.id === a.teacherId);
                return (
                  <tr key={a.id} className="tr">
                    <td className="td pl-5"><p className="font-medium">{subjectIdx.get(a.subjectId)?.name ?? 'Unknown subject'}</p><p className="font-mono text-xs text-slate-400">{subjectIdx.get(a.subjectId)?.code}</p></td>
                    <td className="td">
                      {canEdit ? (
                        <div className="flex items-center gap-2">
                          <Select value={a.teacherId} onChange={(e) => update(a, { teacherId: e.target.value })} className="h-9 min-w-[200px] py-1">
                            {!t && <option value={a.teacherId}>Unassigned</option>}
                            {teachers.map((s) => <option key={s.id} value={s.id}>{s.title} {s.firstName} {s.lastName}</option>)}
                          </Select>
                          {tl && tl.periods > MAX_LOAD && <span title={`${tl.periods} periods/week overall`}><AlertTriangle size={15} className="text-marigold-500 dark:text-marigold-300" /></span>}
                        </div>
                      ) : <span>{t ? `${t.title} ${t.firstName} ${t.lastName}` : 'Unassigned'}</span>}
                    </td>
                    <td className="td text-right">
                      {canEdit ? <PeriodsInput value={a.periodsPerWeek} onCommit={(v) => update(a, { periodsPerWeek: v })} /> : <span className="tabular-nums">{a.periodsPerWeek}</span>}
                    </td>
                    {canEdit && (
                      <td className="td pr-5 text-right">
                        <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label="Remove allocation" onClick={() => remove(a)}><Trash2 size={15} /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
        {canEdit && (
          <div className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-[1fr_1fr_100px_auto] sm:items-end dark:border-white/[0.06]">
            <Field label="Add subject">
              <Select value={newSub} onChange={(e) => setNewSub(e.target.value)}>
                <option value="">{available.length ? 'Choose subject…' : 'All subjects allocated'}</option>
                {available.map((s) => <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Teacher">
              <Select value={newTeacher} onChange={(e) => setNewTeacher(e.target.value)}>
                <option value="">Choose teacher…</option>
                {teachers.map((s) => <option key={s.id} value={s.id}>{s.title} {s.firstName} {s.lastName}</option>)}
              </Select>
            </Field>
            <Field label="Periods"><Input type="number" min={1} max={20} value={newPeriods} onChange={(e) => setNewPeriods(Number(e.target.value))} /></Field>
            <Button icon={<Plus size={16} />} onClick={add} loading={adding} disabled={!newSub || !newTeacher}>Add</Button>
          </div>
        )}
      </Card>

      <Card title="Teacher load" subtitle={`All classes · warning above ${MAX_LOAD} periods/week`} bodyClass="p-0">
        {load.length === 0 ? <EmptyState title="No allocations yet" /> : (
          <ul className="max-h-[640px] divide-y divide-slate-100 overflow-y-auto dark:divide-white/[0.05]">
            {load.map((x) => (
              <li key={x.id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={x.staff ? `${x.staff.firstName} ${x.staff.lastName}` : '?'} size={28} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{teacherLabel(x.staff)}</p>
                      <p className="text-xs text-slate-400">{x.subjects} allocation{x.subjects === 1 ? '' : 's'} · {x.classes.size} class{x.classes.size === 1 ? '' : 'es'}</p>
                    </div>
                  </div>
                  {x.periods > MAX_LOAD ? <Badge tone="red"><AlertTriangle size={11} />{x.periods}</Badge> : <Badge tone={x.periods >= 30 ? 'amber' : 'slate'}>{x.periods}</Badge>}
                </div>
                <Progress value={(x.periods / capacity) * 100} tone={x.periods > MAX_LOAD ? 'rose' : x.periods >= 30 ? 'amber' : 'green'} className="mt-2" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

const PeriodsInput: React.FC<{ value: number; onCommit: (v: number) => void }> = ({ value, onCommit }) => {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1) { setV(String(value)); return; }
    if (n !== value) onCommit(Math.min(40, n));
  };
  return <Input type="number" min={1} max={40} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} className="ml-auto h-9 w-20 py-1 text-right" />;
};

// =================================================================== promotion
const GRADUATE = '__graduate';
const KEEP = '__keep';
const TERMINAL = new Set([8, 12, 14]); // Grade 7, Form 4, Form 6 (Upper 6)

function defaultTarget(c: SchoolClass, classes: SchoolClass[]): string {
  if (TERMINAL.has(c.levelOrder)) return GRADUATE;
  const next = classes.filter((x) => x.levelOrder === c.levelOrder + 1).sort(classSort);
  if (!next.length) return KEEP;
  return (next.find((x) => x.stream && x.stream.toLowerCase() === c.stream?.toLowerCase()) ?? next[0]!).id;
}

const PromotionTab: React.FC<{ classes: SchoolClass[]; students: Student[] }> = ({ classes, students }) => {
  const { toast, confirm } = useUI();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'map' | 'review' | 'done'>('map');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ promoted: number; graduated: number } | null>(null);

  useEffect(() => {
    setTargets((t) => {
      const next: Record<string, string> = {};
      classes.forEach((c) => { next[c.id] = t[c.id] ?? defaultTarget(c, classes); });
      return next;
    });
  }, [classes]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    students.forEach((s) => m.set(s.classId, (m.get(s.classId) ?? 0) + 1));
    return m;
  }, [students]);
  const classIdx = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const plan = classes.map((c) => ({ c, n: counts.get(c.id) ?? 0, target: targets[c.id] ?? KEEP }));
  const promoted = sum(plan.filter((p) => p.target !== KEEP && p.target !== GRADUATE && p.target !== p.c.id).map((p) => p.n));
  const graduated = sum(plan.filter((p) => p.target === GRADUATE).map((p) => p.n));
  const unchanged = sum(plan.filter((p) => p.target === KEEP || p.target === p.c.id).map((p) => p.n));

  // projected enrolment per target class after promotion
  const projected = useMemo(() => {
    const m = new Map<string, number>();
    plan.forEach((p) => {
      const dest = p.target === KEEP ? p.c.id : p.target;
      if (dest === GRADUATE) return;
      m.set(dest, (m.get(dest) ?? 0) + p.n);
    });
    return m;
  }, [plan]);

  const run = async () => {
    const ok = await confirm({
      title: 'Run end-of-year promotion?',
      body: `${promoted} learners will move up to their new classes and ${graduated} will be marked as graduated. This cannot be undone automatically — export the student register first if you may need to reverse it.`,
      confirmText: 'Promote learners', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const ops: WriteOp[] = [];
      for (const s of students) {
        const t = targets[s.classId];
        if (!t || t === KEEP || t === s.classId) continue;
        if (t === GRADUATE) ops.push({ op: 'update', col: 'students', id: s.id, data: { status: 'graduated' } });
        else ops.push({ op: 'update', col: 'students', id: s.id, data: { classId: t } });
      }
      if (!ops.length) { toast('Nothing to change', 'info'); setBusy(false); return; }
      await store.commit(ops);
      setResult({ promoted, graduated });
      setStep('done');
      toast(`Promotion complete: ${promoted} promoted, ${graduated} graduated`);
    } catch (e: any) {
      toast(e?.message ?? 'Promotion failed', 'error');
    } finally { setBusy(false); }
  };

  const targetLabel = (t: string, from: SchoolClass) => t === GRADUATE ? 'Graduate' : t === KEEP || t === from.id ? 'Stay in class' : classIdx.get(t)?.name ?? '—';

  if (step === 'done' && result) {
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 size={22} className="text-brand-500 dark:text-brand-300" />} title="Promotion complete"
          body={`${result.promoted} learners moved to their new classes and ${result.graduated} were marked as graduated. Review class teachers and capacities for the new year.`}
          action={<Button variant="outline" onClick={() => { setStep('map'); setResult(null); setTargets({}); }}>Start over</Button>} />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">End-of-year promotion</p>
          <p className="mt-0.5">Moves every active learner to the class you choose below in a single batch. Graduating classes are marked as graduated. This cannot be undone automatically, so run it once — after final reports are published and before Term 1 registers begin.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <StepPill n={1} label="Choose targets" active={step === 'map'} done={step === 'review'} />
        <ArrowRight size={14} className="text-slate-300" />
        <StepPill n={2} label="Review & confirm" active={step === 'review'} />
      </div>

      {step === 'map' && (
        <Card title="Where does each class go?" subtitle="Defaults follow the next level, matching stream where possible"
          actions={<Button size="sm" variant="ghost" onClick={() => setTargets(Object.fromEntries(classes.map((c) => [c.id, defaultTarget(c, classes)])))}>Reset defaults</Button>}>
          <TableWrap>
            <thead><tr><th className="th pl-5">Current class</th><th className="th text-right">Learners</th><th className="th w-10" /><th className="th pr-5">Moves to</th></tr></thead>
            <tbody>
              {plan.map(({ c, n, target }) => {
                const noNext = target === KEEP && !TERMINAL.has(c.levelOrder) && !classes.some((x) => x.levelOrder === c.levelOrder + 1);
                return (
                  <tr key={c.id} className="tr">
                    <td className="td pl-5"><p className="font-medium">{c.name}</p><p className="text-xs text-slate-400">{c.level}</p></td>
                    <td className="td text-right tabular-nums">{n}</td>
                    <td className="td text-center"><ArrowRight size={14} className="inline text-slate-300" /></td>
                    <td className="td pr-5">
                      <Select value={target} onChange={(e) => setTargets((t) => ({ ...t, [c.id]: e.target.value }))} className="h-9 max-w-xs py-1">
                        <option value={GRADUATE}>Graduate (leave school)</option>
                        <option value={KEEP}>Stay in {c.name}</option>
                        {classes.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </Select>
                      {noNext && <p className="mt-1 text-xs text-marigold-600 dark:text-marigold-400">No {LEVELS.find((l) => l.order === c.levelOrder + 1)?.level ?? 'next-level'} class exists — create one or pick a target.</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          <div className="mt-5 flex justify-end"><Button icon={<ArrowRight size={16} />} onClick={() => setStep('review')}>Preview changes</Button></div>
        </Card>
      )}

      {step === 'review' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <SummaryTile label="Promoted" value={promoted} tone="brand" icon={<ArrowRight size={18} />} />
            <SummaryTile label="Graduating" value={graduated} tone="violet" icon={<GraduationCap size={18} />} />
            <SummaryTile label="Unchanged" value={unchanged} tone="slate" icon={<Users size={18} />} />
          </div>
          <Card title="Preview">
            <TableWrap>
              <thead><tr><th className="th pl-5">From</th><th className="th">To</th><th className="th text-right">Learners</th><th className="th pr-5 text-right">New class size</th></tr></thead>
              <tbody>
                {plan.filter((p) => p.n > 0).map(({ c, n, target }) => {
                  const dest = target === KEEP ? c.id : target;
                  const dc = dest !== GRADUATE ? classIdx.get(dest) : undefined;
                  const size = dc ? projected.get(dc.id) ?? 0 : null;
                  return (
                    <tr key={c.id} className="tr">
                      <td className="td pl-5 font-medium">{c.name}</td>
                      <td className="td">{target === GRADUATE ? <Badge tone="blue"><GraduationCap size={11} />Graduate</Badge> : target === KEEP || target === c.id ? <Badge>Stay</Badge> : <span className="font-medium text-brand-700 dark:text-brand-300">{targetLabel(target, c)}</span>}</td>
                      <td className="td text-right tabular-nums">{n}</td>
                      <td className="td pr-5 text-right tabular-nums">
                        {dc && size != null ? <span className={cx(size > dc.capacity && 'font-semibold text-rose-600 dark:text-rose-400')}>{size} / {dc.capacity}{size > dc.capacity ? ' — over capacity' : ''}</span> : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            {[...projected.entries()].some(([id, n]) => n > (classIdx.get(id)?.capacity ?? Infinity)) && (
              <p className="mt-4 flex items-center gap-2 text-sm text-rose-600 dark:text-rose-400"><AlertTriangle size={15} />Some classes will exceed capacity. You can still continue and rebalance streams afterwards.</p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('map')}>Back</Button>
              <Button variant="danger" icon={<GraduationCap size={16} />} loading={busy} disabled={promoted + graduated === 0} onClick={run}>Promote {promoted + graduated} learners</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

const StepPill: React.FC<{ n: number; label: string; active?: boolean; done?: boolean }> = ({ n, label, active, done }) => (
  <span className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold',
    active ? 'bg-brand-800 text-white dark:bg-brand-600 dark:text-white' : done ? 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400')}>
    <span className="tabular-nums">{n}</span>{label}
  </span>
);

const SummaryTile: React.FC<{ label: string; value: number; tone: 'brand' | 'violet' | 'slate'; icon: React.ReactNode }> = ({ label, value, tone, icon }) => (
  <div className="card p-4">
    <div className={cx('mb-2 inline-flex rounded-lg p-2',
      tone === 'brand' ? 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : tone === 'violet' ? 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400')}>{icon}</div>
    <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
  </div>
);
