import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {AlertTriangle, ArrowRightLeft, BedDouble, Download, FileSpreadsheet, GraduationCap, Pencil, Plus, Trash2, Upload, UserPlus, Users, X} from 'lucide-react';
import { useAuth, useSettings } from '../../context/AuthContext';
import { useCan, useClasses } from '../../lib/hooks';
import { newId, store, useCollection } from '../../lib/store';
import { WriteOp } from '../../lib/backend';
import { Gender, Guardian, SchoolClass, Student, StudentStatus } from '../../types';
import {
  Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatCard, TableWrap, Textarea, useUI,
} from '../../components/ui';
import { ageFrom, cx, download, fullName, nextNumber, parseCSV, studentMatches, toCSV, todayISO } from '../../lib/utils';

// ------------------------------------------------------------------ shared --
export const STATUS_OPTIONS: { id: StudentStatus; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'transferred', label: 'Transferred' },
  { id: 'withdrawn', label: 'Withdrawn' },
  { id: 'graduated', label: 'Graduated' },
];

export const statusTone = (s: StudentStatus): 'green' | 'amber' | 'slate' | 'violet' | 'red' =>
  s === 'active' ? 'green' : s === 'suspended' ? 'red' : s === 'graduated' ? 'violet' : s === 'transferred' ? 'amber' : 'slate';

export const StatusBadge: React.FC<{ status: StudentStatus }> = ({ status }) => (
  <Badge tone={statusTone(status)}>{STATUS_OPTIONS.find((o) => o.id === status)?.label ?? status}</Badge>
);

/** School code used in admission numbers, e.g. "GFA". Derived from existing numbers, else school initials. */
function schoolCode(students: Student[], schoolName?: string): string {
  const counts = new Map<string, number>();
  for (const s of students) {
    const code = s.admissionNo?.split('/')[0];
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (best) return best;
  const init = (schoolName ?? 'School').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]!.toUpperCase()).join('');
  return init.slice(0, 4) || 'SCH';
}

/** Next admission number for an enrolment year: CODE/<year>/<0001>. */
export function nextAdmissionNo(students: Student[], year: number, schoolName?: string, extra: string[] = []): string {
  const prefix = `${schoolCode(students, schoolName)}/${year}/`;
  return nextNumber([...students.map((s) => s.admissionNo), ...extra], prefix);
}

const emptyGuardian = (): Guardian => ({ name: '', relation: 'Mother', phone: '', email: '', occupation: '' });
const RELATIONS = ['Mother', 'Father', 'Guardian', 'Grandparent', 'Aunt', 'Uncle', 'Sibling', 'Sponsor', 'Other'];

type Draft = Omit<Student, 'id'> & { id?: string };

const blankDraft = (classId = ''): Draft => ({
  admissionNo: '', firstName: '', lastName: '', gender: 'F', dob: '', classId, status: 'active', enrollDate: todayISO(),
  guardians: [emptyGuardian()], address: '', nationalId: '', medical: '', boarding: 'day', notes: '',
});

// ---------------------------------------------------------- form modal ------
export const StudentFormModal: React.FC<{
  open: boolean;
  onClose: () => void;
  student?: Student | null;
  defaultClassId?: string;
  onSaved?: (id: string) => void;
}> = ({ open, onClose, student, defaultClassId, onSaved }) => {
  const { data: students } = useCollection('students');
  const classes = useClasses();
  const settings = useSettings();
  const { toast } = useUI();
  const [d, setD] = useState<Draft>(blankDraft());
  const [admTouched, setAdmTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSaving(false);
    if (student) {
      setD({ ...student, guardians: student.guardians?.length ? student.guardians.map((g) => ({ ...g })) : [emptyGuardian()] });
      setAdmTouched(true);
    } else {
      setD(blankDraft(defaultClassId ?? ''));
      setAdmTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student?.id]);

  // auto admission number for new students, following the enrolment year
  const enrollYear = parseInt((d.enrollDate || todayISO()).slice(0, 4), 10) || new Date().getFullYear();
  useEffect(() => {
    if (!open || student || admTouched) return;
    setD((x) => ({ ...x, admissionNo: nextAdmissionNo(students, enrollYear, settings?.name) }));
  }, [open, student, admTouched, enrollYear, students, settings?.name]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setG = (i: number, patch: Partial<Guardian>) => setD((x) => ({ ...x, guardians: x.guardians.map((g, j) => (j === i ? { ...g, ...patch } : g)) }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!d.firstName.trim()) e.firstName = 'Required';
    if (!d.lastName.trim()) e.lastName = 'Required';
    if (!d.dob) e.dob = 'Required';
    else if (d.dob > todayISO()) e.dob = 'Date of birth is in the future';
    if (!d.classId) e.classId = 'Choose a class';
    if (!d.admissionNo.trim()) e.admissionNo = 'Required';
    else if (students.some((s) => s.admissionNo.trim().toLowerCase() === d.admissionNo.trim().toLowerCase() && s.id !== student?.id)) e.admissionNo = 'Already used by another student';
    if (!d.guardians[0]?.name.trim()) e.g0name = 'Primary guardian name is required';
    if (!d.guardians[0]?.phone.trim()) e.g0phone = 'Primary guardian phone is required';
    d.guardians.forEach((g, i) => { if (g.email && !/^\S+@\S+\.\S+$/.test(g.email)) e[`g${i}email`] = 'Invalid email'; });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) { toast('Please fix the highlighted fields', 'error'); return; }
    setSaving(true);
    try {
      const guardians = d.guardians
        .filter((g, i) => i === 0 || g.name.trim())
        .map((g) => ({
          name: g.name.trim(), relation: g.relation || 'Guardian', phone: g.phone.trim(),
          email: g.email?.trim() || undefined, occupation: g.occupation?.trim() || undefined,
        }));
      const doc: Student = {
        ...(student ?? {}),
        id: student?.id ?? newId(),
        admissionNo: d.admissionNo.trim(),
        firstName: d.firstName.trim(),
        lastName: d.lastName.trim(),
        gender: d.gender,
        dob: d.dob,
        classId: d.classId,
        status: d.status,
        enrollDate: d.enrollDate || todayISO(),
        guardians,
        address: d.address?.trim() || undefined,
        nationalId: d.nationalId?.trim() || undefined,
        medical: d.medical?.trim() || undefined,
        boarding: d.boarding ?? 'day',
        notes: d.notes?.trim() || undefined,
      };
      await store.set('students', doc);
      toast(student ? 'Student updated' : `${fullName(doc)} enrolled (${doc.admissionNo})`);
      onSaved?.(doc.id);
      onClose();
    } catch (err: any) {
      toast(err?.message ?? 'Could not save student', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sections: { label: string; items: SchoolClass[] }[] = [
    { label: 'Primary', items: classes.filter((c) => c.section === 'primary') },
    { label: 'Secondary', items: classes.filter((c) => c.section === 'secondary') },
  ];
  const err = (k: string) => errors[k] && <span className="mt-1 block text-xs text-rose-500 dark:text-rose-300">{errors[k]}</span>;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={student ? `Edit ${fullName(student)}` : 'Enrol new student'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>{student ? 'Save changes' : 'Enrol student'}</Button></>}>
      <div className="space-y-6">
        <section>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">Personal details</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" required><Input value={d.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus />{err('firstName')}</Field>
            <Field label="Surname" required><Input value={d.lastName} onChange={(e) => set('lastName', e.target.value)} />{err('lastName')}</Field>
            <Field label="Gender" required>
              <Select value={d.gender} onChange={(e) => set('gender', e.target.value as Gender)}><option value="F">Female</option><option value="M">Male</option></Select>
            </Field>
            <Field label="Date of birth" required><Input type="date" value={d.dob} max={todayISO()} onChange={(e) => set('dob', e.target.value)} />{err('dob')}</Field>
            <Field label="Birth certificate / ID no."><Input value={d.nationalId ?? ''} onChange={(e) => set('nationalId', e.target.value)} placeholder="e.g. 63-2451876 X 42" /></Field>
            <Field label="Home address"><Input value={d.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Street, suburb, city" /></Field>
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">Enrolment</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Class" required>
              <Select value={d.classId} onChange={(e) => set('classId', e.target.value)}>
                <option value="">Select class…</option>
                {sections.map((g) => g.items.length > 0 && (
                  <optgroup key={g.label} label={g.label}>{g.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                ))}
              </Select>
              {err('classId')}
            </Field>
            <Field label="Admission number" required hint={!student && !admTouched ? 'Generated automatically — you can override it' : undefined}>
              <Input value={d.admissionNo} onChange={(e) => { setAdmTouched(true); set('admissionNo', e.target.value); }} className="font-mono" />
              {err('admissionNo')}
            </Field>
            <Field label="Enrolment date"><Input type="date" value={d.enrollDate} onChange={(e) => set('enrollDate', e.target.value)} /></Field>
            <Field label="Status">
              <Select value={d.status} onChange={(e) => set('status', e.target.value as StudentStatus)}>
                {STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            </Field>
            <Field label="Boarding">
              <Select value={d.boarding ?? 'day'} onChange={(e) => set('boarding', e.target.value as 'day' | 'boarder')}>
                <option value="day">Day scholar</option><option value="boarder">Boarder</option>
              </Select>
            </Field>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">Parents / guardians</h4>
            {d.guardians.length < 2 && (
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => set('guardians', [...d.guardians, { ...emptyGuardian(), relation: 'Father' }])}>Add second guardian</Button>
            )}
          </div>
          <div className="space-y-4">
            {d.guardians.map((g, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{i === 0 ? 'Primary guardian' : 'Second guardian'}</p>
                  {i > 0 && (
                    <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-white/10" aria-label="Remove guardian"
                      onClick={() => set('guardians', d.guardians.filter((_, j) => j !== i))}><X size={16} /></button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Full name" required={i === 0}><Input value={g.name} onChange={(e) => setG(i, { name: e.target.value })} placeholder="e.g. Mrs Rudo Moyo" />{i === 0 && err('g0name')}</Field>
                  <Field label="Relationship">
                    <Select value={g.relation} onChange={(e) => setG(i, { relation: e.target.value })}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</Select>
                  </Field>
                  <Field label="Phone" required={i === 0}><Input type="tel" value={g.phone} onChange={(e) => setG(i, { phone: e.target.value })} placeholder="+263 77 123 4567" />{i === 0 && err('g0phone')}</Field>
                  <Field label="Email"><Input type="email" value={g.email ?? ''} onChange={(e) => setG(i, { email: e.target.value })} />{err(`g${i}email`)}</Field>
                  <Field label="Occupation" className="sm:col-span-2"><Input value={g.occupation ?? ''} onChange={(e) => setG(i, { occupation: e.target.value })} /></Field>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400">Health & notes</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Medical conditions / allergies"><Textarea value={d.medical ?? ''} onChange={(e) => set('medical', e.target.value)} placeholder="e.g. Asthma — inhaler kept at sick bay" /></Field>
            <Field label="Notes"><Textarea value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Previous school, scholarships, special arrangements…" /></Field>
          </div>
        </section>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------- CSV import ------
const IMPORT_COLUMNS = ['firstName', 'lastName', 'gender', 'dob', 'class', 'guardianName', 'guardianPhone', 'guardianEmail'];

interface ImportPreview { fileName: string; valid: Student[]; errors: { row: number; name: string; reason: string }[] }

function normDate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

function buildImport(fileName: string, text: string, classes: SchoolClass[], existing: Student[], schoolName?: string): ImportPreview {
  const rows = parseCSV(text);
  const byName = new Map(classes.map((c) => [c.name.trim().toLowerCase(), c]));
  const valid: Student[] = [];
  const errors: ImportPreview['errors'] = [];
  const today = todayISO();
  const year = new Date().getFullYear();
  const issued: string[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const get = (k: string) => (r[k] ?? r[Object.keys(r).find((x) => x.toLowerCase() === k.toLowerCase()) ?? ''] ?? '').trim();
    const firstName = get('firstName'), lastName = get('lastName');
    const name = `${firstName} ${lastName}`.trim() || '(no name)';
    const problems: string[] = [];
    if (!firstName || !lastName) problems.push('missing first name or surname');
    const g = get('gender').toUpperCase();
    const gender: Gender | null = g === 'M' || g === 'MALE' || g === 'BOY' ? 'M' : g === 'F' || g === 'FEMALE' || g === 'GIRL' ? 'F' : null;
    if (!gender) problems.push(`gender "${get('gender')}" should be M or F`);
    const dob = normDate(get('dob'));
    if (!dob) problems.push(`date of birth "${get('dob')}" should be YYYY-MM-DD`);
    const cname = get('class');
    const cls = byName.get(cname.toLowerCase());
    if (!cls) problems.push(cname ? `unknown class "${cname}"` : 'missing class');
    if (problems.length) { errors.push({ row: rowNo, name, reason: problems.join('; ') }); return; }
    const admissionNo = nextAdmissionNo(existing, year, schoolName, issued);
    issued.push(admissionNo);
    const guardianName = get('guardianName');
    valid.push({
      id: newId() + i.toString(36),
      admissionNo, firstName, lastName, gender: gender!, dob: dob!, classId: cls!.id, status: 'active', enrollDate: today,
      guardians: guardianName || get('guardianPhone')
        ? [{ name: guardianName || 'Guardian', relation: 'Guardian', phone: get('guardianPhone'), email: get('guardianEmail') || undefined }]
        : [],
      boarding: 'day',
    });
  });
  return { fileName, valid, errors };
}

// ---------------------------------------------------------------- page ------
const PAGE = 50;

export default function Students() {
  const { profile } = useAuth();
  const settings = useSettings();
  const { data: students, loading } = useCollection('students');
  const classes = useClasses();
  const classIdx = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const canEdit = useCan('students');
  const isAdmin = profile?.role === 'admin';
  const { toast, confirm } = useUI();
  const [params, setParams] = useSearchParams();

  const [q, setQ] = useState('');
  const [classId, setClassId] = useState(params.get('class') ?? '');
  const [status, setStatus] = useState<StudentStatus | 'all'>('active');
  const [gender, setGender] = useState<Gender | ''>('');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ open: boolean; student: Student | null }>({ open: false, student: null });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [bulkClass, setBulkClass] = useState('');
  const [bulkStatus, setBulkStatus] = useState<StudentStatus | ''>('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setLimit(PAGE); }, [q, classId, status, gender]);
  useEffect(() => {
    const cur = params.get('class') ?? '';
    if (cur !== classId) {
      const next = new URLSearchParams(params);
      if (classId) next.set('class', classId); else next.delete('class');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const year = new Date().getFullYear();
  const stats = useMemo(() => {
    const act = students.filter((s) => s.status === 'active');
    return {
      total: act.length,
      boys: act.filter((s) => s.gender === 'M').length,
      girls: act.filter((s) => s.gender === 'F').length,
      boarders: act.filter((s) => s.boarding === 'boarder').length,
      newThisYear: act.filter((s) => s.enrollDate?.startsWith(String(year))).length,
    };
  }, [students, year]);

  const filtered = useMemo(() => {
    return students
      .filter((s) => (status === 'all' || s.status === status) && (!classId || s.classId === classId) && (!gender || s.gender === gender) && studentMatches(s, q.trim()))
      .sort((a, b) => {
        const ca = classIdx.get(a.classId), cb = classIdx.get(b.classId);
        return (ca?.levelOrder ?? 99) - (cb?.levelOrder ?? 99) || (ca?.name ?? '').localeCompare(cb?.name ?? '') ||
          a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
      });
  }, [students, status, classId, gender, q, classIdx]);

  // drop selections that are no longer visible after filtering
  useEffect(() => {
    setSelected((sel) => {
      if (!sel.size) return sel;
      const vis = new Set(filtered.map((s) => s.id));
      const next = new Set([...sel].filter((id) => vis.has(id)));
      return next.size === sel.size ? sel : next;
    });
  }, [filtered]);

  if (profile && (profile.role === 'parent' || profile.role === 'student')) return <Navigate to="/" replace />;

  const shown = filtered.slice(0, limit);
  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((s) => s.id)));

  const exportCSV = () => {
    const rows = filtered.map((s) => ({
      admissionNo: s.admissionNo, firstName: s.firstName, lastName: s.lastName, gender: s.gender, dob: s.dob, age: s.dob ? ageFrom(s.dob) : '',
      class: classIdx.get(s.classId)?.name ?? '', status: s.status, boarding: s.boarding ?? 'day', enrollDate: s.enrollDate,
      guardianName: s.guardians[0]?.name ?? '', guardianRelation: s.guardians[0]?.relation ?? '', guardianPhone: s.guardians[0]?.phone ?? '', guardianEmail: s.guardians[0]?.email ?? '',
      guardian2Name: s.guardians[1]?.name ?? '', guardian2Phone: s.guardians[1]?.phone ?? '', address: s.address ?? '', medical: s.medical ?? '',
    }));
    if (!rows.length) { toast('Nothing to export for these filters', 'info'); return; }
    download(`students-${todayISO()}.csv`, toCSV(rows));
    toast(`Exported ${rows.length} students`);
  };

  const downloadTemplate = () => {
    const sample = classes[0]?.name ?? 'Form 1A';
    download('student-import-template.csv', `${IMPORT_COLUMNS.join(',')}\nTatenda,Moyo,M,2013-04-21,${sample},Mrs Rudo Moyo,+263 77 123 4567,rudo.moyo@gmail.com\n`);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      const p = buildImport(f.name, text, classes, students, settings?.name);
      if (!p.valid.length && !p.errors.length) { toast('That file has no data rows', 'error'); return; }
      setPreview(p);
    } catch {
      toast('Could not read that file', 'error');
    }
  };

  const runImport = async () => {
    if (!preview?.valid.length) return;
    setImporting(true);
    try {
      await store.commit(preview.valid.map((s) => ({ op: 'set', col: 'students', id: s.id, data: s as any })));
      toast(`Imported ${preview.valid.length} students`);
      setPreview(null);
    } catch (err: any) {
      toast(err?.message ?? 'Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const remove = async (s: Student) => {
    const ok = await confirm({
      title: `Delete ${fullName(s)}?`,
      body: `This permanently removes ${s.admissionNo} from the register. Marks, invoices and other records linked to this student will no longer show a name. To keep history, change the status to Withdrawn or Transferred instead.`,
      confirmText: 'Delete student', danger: true,
    });
    if (!ok) return;
    try { await store.remove('students', s.id); toast('Student deleted'); } catch (err: any) { toast(err?.message ?? 'Delete failed', 'error'); }
  };

  const bulkApply = async (kind: 'class' | 'status') => {
    const ids = [...selected];
    if (!ids.length) return;
    const patch: Partial<Student> = kind === 'class' ? { classId: bulkClass } : { status: bulkStatus as StudentStatus };
    if (kind === 'class' && !bulkClass) return;
    if (kind === 'status' && !bulkStatus) return;
    const label = kind === 'class' ? `move to ${classIdx.get(bulkClass)?.name}` : `mark as ${STATUS_OPTIONS.find((o) => o.id === bulkStatus)?.label}`;
    const ok = await confirm({ title: `Update ${ids.length} student${ids.length === 1 ? '' : 's'}?`, body: `Selected students will ${label}.`, confirmText: 'Apply' });
    if (!ok) return;
    setBulkBusy(true);
    try {
      const ops: WriteOp[] = ids.map((id) => ({ op: 'update', col: 'students', id, data: patch as any }));
      await store.commit(ops);
      toast(`Updated ${ids.length} students`);
      setSelected(new Set());
      setBulkClass(''); setBulkStatus('');
    } catch (err: any) {
      toast(err?.message ?? 'Bulk update failed', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const filtersActive = q || classId || status !== 'active' || gender;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="People" title="Student register"
        subtitle={`${stats.total} active learners across ${classes.length} classes`}
        actions={<>
          <Button variant="outline" icon={<Download size={16} />} onClick={exportCSV}>Export CSV</Button>
          {canEdit && <>
            <Button variant="outline" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()} title="Import a CSV with columns firstName, lastName, gender, dob, class, guardianName, guardianPhone, guardianEmail">Import CSV</Button>
            <Button variant="ghost" icon={<FileSpreadsheet size={16} />} onClick={downloadTemplate} title="Download a CSV template for importing">Template</Button>
            <Button icon={<UserPlus size={16} />} onClick={() => setForm({ open: true, student: null })}>Enrol student</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </>}
        </>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active learners" value={stats.total} icon={<Users size={20} />} sub={`${students.length - stats.total} inactive records`} />
        <StatCard label="Boys / girls" value={<span>{stats.boys}<span className="mx-1 text-slate-300 dark:text-slate-600">/</span>{stats.girls}</span>} icon={<Users size={20} />} tone="violet"
          sub={stats.total ? `${Math.round((stats.girls / stats.total) * 100)}% girls` : undefined} />
        <StatCard label="Boarders" value={stats.boarders} icon={<BedDouble size={20} />} tone="amber" sub={`${stats.total - stats.boarders} day scholars`} />
        <StatCard label={`New in ${year}`} value={stats.newThisYear} icon={<GraduationCap size={20} />} tone="green" sub="Enrolled this year" />
      </div>

      <Card bodyClass="p-5">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_200px_160px_140px_auto]">
          <SearchInput value={q} onChange={setQ} placeholder="Search name or admission no…" />
          <Select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as StudentStatus | 'all')} aria-label="Status">
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
          <Select value={gender} onChange={(e) => setGender(e.target.value as Gender | '')} aria-label="Gender">
            <option value="">All genders</option><option value="M">Boys</option><option value="F">Girls</option>
          </Select>
          {filtersActive ? (
            <Button variant="ghost" onClick={() => { setQ(''); setClassId(''); setStatus('active'); setGender(''); }}>Reset</Button>
          ) : <span className="hidden lg:block" />}
        </div>

        {canEdit && selected.size > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-100 p-3 lg:flex-row lg:items-center dark:border-white/10 dark:bg-white/[0.06]">
            <p className="text-sm font-semibold text-brand-800 dark:text-brand-200">{selected.size} selected</p>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Select value={bulkClass} onChange={(e) => setBulkClass(e.target.value)} className="h-8 w-44 py-1 text-xs">
                  <option value="">Move to class…</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Button size="sm" variant="outline" icon={<ArrowRightLeft size={14} />} disabled={!bulkClass} loading={bulkBusy} onClick={() => bulkApply('class')}>Move</Button>
              </div>
              <div className="flex items-center gap-2">
                <Select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as StudentStatus | '')} className="h-8 w-40 py-1 text-xs">
                  <option value="">Change status…</option>
                  {STATUS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </Select>
                <Button size="sm" variant="outline" disabled={!bulkStatus} loading={bulkBusy} onClick={() => bulkApply('status')}>Apply</Button>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}

        {loading ? <Spinner label="Loading students…" /> : filtered.length === 0 ? (
          <EmptyState title={students.length ? 'No students match these filters' : 'No students yet'}
            body={students.length ? 'Try clearing the search or choosing a different class or status.' : 'Enrol your first learner or import a class list from a spreadsheet.'}
            action={!students.length && canEdit ? <Button icon={<UserPlus size={16} />} onClick={() => setForm({ open: true, student: null })}>Enrol student</Button> : undefined} />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  {canEdit && <th className="th w-10 pl-5"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></th>}
                  <th className={cx('th', !canEdit && 'pl-5')}>Student</th>
                  <th className="th">Adm. no</th>
                  <th className="th">Class</th>
                  <th className="th">Gender</th>
                  <th className="th">Age</th>
                  <th className="th">Guardian</th>
                  <th className="th">Status</th>
                  {canEdit && <th className="th pr-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const g = s.guardians[0];
                  return (
                    <tr key={s.id} className={cx('tr tr-hover', selected.has(s.id) && 'bg-slate-100 dark:bg-white/[0.06]')}>
                      {canEdit && <td className="td pl-5"><input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${fullName(s)}`} /></td>}
                      <td className={cx('td', !canEdit && 'pl-5')}>
                        <Link to={`/students/${s.id}`} className="group flex items-center gap-3">
                          <Avatar name={fullName(s)} size={34} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900 group-hover:text-brand-600 dark:text-white dark:group-hover:text-brand-400">{s.lastName}, {s.firstName}</p>
                            <p className="flex items-center gap-1.5 text-xs text-slate-400">
                              {s.boarding === 'boarder' ? 'Boarder' : 'Day'}
                              {s.medical && <span className="inline-flex items-center gap-0.5 text-marigold-600 dark:text-marigold-400" title={s.medical}><AlertTriangle size={11} />Medical</span>}
                            </p>
                          </div>
                        </Link>
                      </td>
                      <td className="td whitespace-nowrap font-mono text-xs text-slate-500 dark:text-slate-400">{s.admissionNo}</td>
                      <td className="td whitespace-nowrap">{classIdx.get(s.classId)?.name ?? <span className="text-slate-400">—</span>}</td>
                      <td className="td">{s.gender === 'M' ? 'Male' : 'Female'}</td>
                      <td className="td tabular-nums">{s.dob ? ageFrom(s.dob) : '—'}</td>
                      <td className="td">
                        {g ? (
                          <div className="min-w-0">
                            <p className="truncate text-slate-700 dark:text-slate-200">{g.name}</p>
                            <a href={`tel:${g.phone.replace(/[^\d+]/g, '')}`} className="text-xs text-slate-400 hover:text-brand-600">{g.phone}</a>
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="td"><StatusBadge status={s.status} /></td>
                      {canEdit && (
                        <td className="td pr-5">
                          <div className="flex justify-end gap-1">
                            <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Edit" title="Edit"
                              onClick={() => setForm({ open: true, student: s })}><Pencil size={15} /></button>
                            {isAdmin && (
                              <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" aria-label="Delete" title="Delete"
                                onClick={() => remove(s)}><Trash2 size={15} /></button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm text-slate-500 sm:flex-row dark:border-white/[0.06] dark:text-slate-400">
              <span>Showing {shown.length} of {filtered.length} students</span>
              {shown.length < filtered.length && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - shown.length)} more</Button>
                  <Button size="sm" variant="ghost" onClick={() => setLimit(filtered.length)}>Show all</Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <StudentFormModal open={form.open} student={form.student} defaultClassId={classId || undefined} onClose={() => setForm({ open: false, student: null })} />

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Import students" size="lg"
        footer={<>
          <Button variant="ghost" icon={<FileSpreadsheet size={16} />} onClick={downloadTemplate} className="mr-auto">Template</Button>
          <Button variant="outline" onClick={() => setPreview(null)}>Cancel</Button>
          <Button onClick={runImport} loading={importing} disabled={!preview?.valid.length}>Import {preview?.valid.length ?? 0} student{preview?.valid.length === 1 ? '' : 's'}</Button>
        </>}>
        {preview && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/[0.03]">
              <FileSpreadsheet size={18} className="text-slate-400 dark:text-slate-400" />
              <span className="font-medium text-slate-700 dark:text-slate-200">{preview.fileName}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 dark:border-white/10 dark:bg-white/[0.06]">
                <p className="text-2xl font-bold text-brand-700 dark:text-brand-400">{preview.valid.length}</p>
                <p className="text-xs font-semibold text-brand-700/80 dark:text-brand-400/80">ready to import</p>
              </div>
              <div className={cx('rounded-xl border p-4', preview.errors.length ? 'border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/[0.06]' : 'border-slate-200 dark:border-white/10')}>
                <p className={cx('text-2xl font-bold', preview.errors.length ? 'text-rose-700 dark:text-rose-400' : 'text-slate-400')}>{preview.errors.length}</p>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">rows with problems (skipped)</p>
              </div>
            </div>
            {preview.valid.length > 0 && (
              <div>
                <p className="label">First rows</p>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm dark:divide-white/5 dark:border-white/10">
                  {preview.valid.slice(0, 5).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="font-medium text-slate-700 dark:text-slate-200">{fullName(s)}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{classIdx.get(s.classId)?.name} · <span className="font-mono">{s.admissionNo}</span></span>
                    </li>
                  ))}
                  {preview.valid.length > 5 && <li className="px-3 py-2 text-xs text-slate-400">and {preview.valid.length - 5} more…</li>}
                </ul>
              </div>
            )}
            {preview.errors.length > 0 && (
              <div>
                <p className="label">Problems</p>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-rose-200 dark:border-rose-500/30">
                  <table className="w-full text-sm">
                    <tbody>
                      {preview.errors.map((e) => (
                        <tr key={e.row} className="tr first:border-t-0">
                          <td className="td w-16 font-mono text-xs text-slate-400">Row {e.row}</td>
                          <td className="td font-medium">{e.name}</td>
                          <td className="td text-rose-600 dark:text-rose-400">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Class names must match exactly one of: {classes.map((c) => c.name).join(', ')}.</p>
              </div>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Expected columns: <span className="font-mono">{IMPORT_COLUMNS.join(', ')}</span>. Dates as YYYY-MM-DD or DD/MM/YYYY. Imported students are enrolled today as active day scholars and receive admission numbers automatically.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

