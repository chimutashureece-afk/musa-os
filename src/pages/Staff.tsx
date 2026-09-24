import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {Upload, Briefcase, CalendarClock, Download, GraduationCap, Mail, Pencil, Phone, Plane, School, Trash2, UserPlus, Users} from 'lucide-react';
import { useAuth, useSettings } from '../context/AuthContext';
import { useCan } from '../lib/hooks';
import { newId, store, useCollection, useIndex } from '../lib/store';
import { WriteOp } from '../lib/backend';
import { Gender, Section, Staff, StaffStatus } from '../types';
import {
  Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Progress, SearchInput, Select, Spinner, StatCard, TableWrap, useUI,
} from '../components/ui';
import { classSort, cx, download, fmtDate, sum, toCSV, todayISO } from '../lib/utils';
import { BulkImport, ReviewRow, downloadTemplate } from '../components/BulkImport';

const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Rev'];
const STATUS: { id: StaffStatus; label: string; tone: 'green' | 'amber' | 'slate' }[] = [
  { id: 'active', label: 'Active', tone: 'green' },
  { id: 'on-leave', label: 'On leave', tone: 'amber' },
  { id: 'left', label: 'Left', tone: 'slate' },
];
const NON_TEACHING = /bursar|librarian|accountant|clerk|secretary|admin officer|receptionist|matron|nurse|driver|groundsman|security|cook|ict technician|lab technician|estates|hr/i;

/** Teaching staff = has allocations / is class teacher, or position suggests teaching. */
const isTeaching = (s: Staff, teachingIds: Set<string>) =>
  teachingIds.has(s.id) || (/teacher|hod|head of|lecturer|tutor/i.test(s.position) && !NON_TEACHING.test(s.position));

const fullStaffName = (s: Staff) => `${s.title} ${s.firstName} ${s.lastName}`;

function nextStaffNo(staff: Staff[], schoolName?: string, extra: string[] = []): string {
  const counts = new Map<string, number>();
  let max = 0;
  for (const s of staff) {
    const m = s.staffNo?.match(/^(.*?)(\d+)$/);
    if (!m) continue;
    counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
  }
  const initials = (schoolName ?? 'School').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]!.toUpperCase()).join('').slice(0, 4) || 'SCH';
  const prefix = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `${initials}-S`;
  for (const n of [...staff.map((s) => s.staffNo), ...extra]) if (n?.startsWith(prefix)) max = Math.max(max, parseInt(n.slice(prefix.length), 10) || 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

type Draft = Omit<Staff, 'id'>;
const blank = (): Draft => ({
  staffNo: '', title: 'Mr', firstName: '', lastName: '', gender: 'M', position: 'Teacher', department: '', phone: '', email: '',
  hireDate: todayISO(), status: 'active', qualifications: '', section: 'secondary',
});

export default function StaffPage() {
  const { profile } = useAuth();
  const settings = useSettings();
  const { data: staff, loading } = useCollection('staff');
  const { data: allocations } = useCollection('allocations');
  const { data: timetable } = useCollection('timetable');
  const { data: classes } = useCollection('classes');
  const classIdx = useIndex('classes');
  const subjectIdx = useIndex('subjects');
  const canEdit = useCan('staff');
  const { toast, confirm } = useUI();
  const [bulkOpen, setBulkOpen] = useState(false);
  const importRows = async (rows: ReviewRow[]) => {
    const issued: string[] = [];
    const docs: Staff[] = rows.map((r, i) => {
      const staffNo = nextStaffNo(staff, settings?.name, issued); issued.push(staffNo);
      return {
        id: newId() + i.toString(36), staffNo, title: r.title?.trim() || (r.gender === 'M' ? 'Mr' : 'Mrs'),
        firstName: r.firstName!.trim(), lastName: r.lastName!.trim(), gender: r.gender as Gender,
        position: r.position?.trim() || 'Teacher', department: r.department?.trim() || '', phone: r.phone?.trim() ?? '', email: r.email?.trim() ?? '',
        hireDate: todayISO(), status: 'active',
      };
    });
    await store.commit(docs.map((d) => ({ op: 'set', col: 'staff', id: d.id, data: d as any })));
  };

  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState<StaffStatus | 'all'>('all');
  const [form, setForm] = useState<{ open: boolean; staff: Staff | null }>({ open: false, staff: null });
  const [detailId, setDetailId] = useState<string | null>(null);

  const teachingIds = useMemo(() => {
    const ids = new Set(allocations.map((a) => a.teacherId));
    classes.forEach((c) => c.classTeacherId && ids.add(c.classTeacherId));
    return ids;
  }, [allocations, classes]);

  const departments = useMemo(() => [...new Set(staff.map((s) => s.department).filter(Boolean))].sort(), [staff]);

  const loadBy = useMemo(() => {
    const m = new Map<string, { periods: number; slots: number; classes: Set<string> }>();
    const get = (id: string) => { let x = m.get(id); if (!x) { x = { periods: 0, slots: 0, classes: new Set() }; m.set(id, x); } return x; };
    allocations.forEach((a) => { const x = get(a.teacherId); x.periods += a.periodsPerWeek || 0; x.classes.add(a.classId); });
    timetable.forEach((t) => { if (t.teacherId) get(t.teacherId).slots++; });
    return m;
  }, [allocations, timetable]);

  const stats = useMemo(() => {
    const current = staff.filter((s) => s.status !== 'left');
    const teaching = current.filter((s) => isTeaching(s, teachingIds)).length;
    return { total: current.length, teaching, support: current.length - teaching, onLeave: staff.filter((s) => s.status === 'on-leave').length };
  }, [staff, teachingIds]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return staff
      .filter((s) => (status === 'all' ? true : s.status === status) && (!dept || s.department === dept) &&
        (!t || `${s.title} ${s.firstName} ${s.lastName} ${s.staffNo} ${s.position} ${s.email} ${s.phone}`.toLowerCase().includes(t)))
      .sort((a, b) => (a.status === 'left' ? 1 : 0) - (b.status === 'left' ? 1 : 0) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  }, [staff, q, dept, status]);

  const exportCSV = () => {
    if (!filtered.length) { toast('Nothing to export', 'info'); return; }
    download(`staff-${todayISO()}.csv`, toCSV(filtered.map((s) => ({
      staffNo: s.staffNo, title: s.title, firstName: s.firstName, lastName: s.lastName, gender: s.gender, position: s.position, department: s.department,
      section: s.section ?? '', phone: s.phone, email: s.email, hireDate: s.hireDate, status: s.status, qualifications: s.qualifications ?? '',
      periodsPerWeek: loadBy.get(s.id)?.periods ?? 0,
    }))));
    toast(`Exported ${filtered.length} staff records`);
  };

  const remove = async (s: Staff) => {
    const allocs = allocations.filter((a) => a.teacherId === s.id);
    if (allocs.length) {
      toast(`${fullStaffName(s)} still has ${allocs.length} teaching allocation${allocs.length === 1 ? '' : 's'}. Reassign them under Classes → Allocations, or mark the record as "Left" instead.`, 'error');
      return;
    }
    const ct = classes.filter((c) => c.classTeacherId === s.id);
    const ok = await confirm({
      title: `Delete ${fullStaffName(s)}?`,
      body: `This permanently removes staff record ${s.staffNo}.${ct.length ? ` They will be removed as class teacher of ${ct.map((c) => c.name).join(', ')}.` : ''} To keep history, set the status to "Left" instead.`,
      confirmText: 'Delete', danger: true,
    });
    if (!ok) return;
    try {
      const ops: WriteOp[] = [
        { op: 'delete', col: 'staff', id: s.id },
        ...ct.map((c) => ({ op: 'set' as const, col: 'classes' as const, id: c.id, data: (() => { const { classTeacherId, ...rest } = c; return rest as any; })() })),
      ];
      await store.commit(ops);
      toast('Staff record deleted');
      setDetailId(null);
    } catch (e: any) { toast(e?.message ?? 'Delete failed', 'error'); }
  };

  const detail = detailId ? staff.find((s) => s.id === detailId) ?? null : null;
  const capacity = (settings?.periodsPerDay ?? 8) * 5;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="People" title="Staff directory" subtitle={`${stats.total} current staff across ${departments.length} departments`}
        actions={<>
          <Button variant="outline" icon={<Download size={16} />} onClick={exportCSV}>Export CSV</Button>
          {canEdit && <Button variant="outline" icon={<Upload size={16} />} onClick={() => setBulkOpen(true)} title="Add many staff from Excel, a photo of a list, or pasted names">Import</Button>}
          {canEdit && <Button icon={<UserPlus size={16} />} onClick={() => setForm({ open: true, staff: null })}>Add staff</Button>}
        </>} />
      <BulkImport kind="staff" open={bulkOpen} onClose={() => setBulkOpen(false)} onTemplate={() => downloadTemplate('staff')} onImport={importRows} existing={staff.map((s) => `${s.firstName} ${s.lastName}`)} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total staff" value={stats.total} icon={<Users size={20} />} sub={`${staff.length - stats.total} former`} />
        <StatCard label="Teaching" value={stats.teaching} icon={<GraduationCap size={20} />} tone="green" />
        <StatCard label="Admin & support" value={stats.support} icon={<Briefcase size={20} />} tone="violet" />
        <StatCard label="On leave" value={stats.onLeave} icon={<Plane size={20} />} tone="amber" onClick={() => setStatus('on-leave')} />
      </div>

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px_160px]">
          <SearchInput value={q} onChange={setQ} placeholder="Search name, staff no, position…" />
          <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d}>{d}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as StaffStatus | 'all')} aria-label="Status">
            <option value="all">All statuses</option>
            {STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
        </div>
        {loading ? <Spinner label="Loading staff…" /> : filtered.length === 0 ? (
          <EmptyState title={staff.length ? 'No staff match these filters' : 'No staff yet'} body={staff.length ? 'Clear the search or choose another department.' : 'Add teachers and support staff to build your directory.'}
            action={!staff.length && canEdit ? <Button icon={<UserPlus size={16} />} onClick={() => setForm({ open: true, staff: null })}>Add staff</Button> : undefined} />
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th className="th pl-5">Name</th><th className="th">Staff no</th><th className="th">Position</th><th className="th">Department</th>
                <th className="th">Contact</th><th className="th text-right">Load</th><th className="th">Status</th>{canEdit && <th className="th pr-5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const st = STATUS.find((x) => x.id === s.status);
                const load = loadBy.get(s.id);
                return (
                  <tr key={s.id} className={cx('tr tr-hover cursor-pointer', s.status === 'left' && 'opacity-60')} onClick={() => setDetailId(s.id)}>
                    <td className="td pl-5">
                      <div className="flex items-center gap-3">
                        <Avatar name={`${s.firstName} ${s.lastName}`} size={34} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">{s.title} {s.firstName} {s.lastName}</p>
                          <p className="truncate text-xs text-slate-400">{s.qualifications || (s.section === 'both' ? 'Whole school' : s.section === 'primary' ? 'Primary' : s.section === 'secondary' ? 'Secondary' : '')}</p>
                        </div>
                      </div>
                    </td>
                    <td className="td whitespace-nowrap font-mono text-xs text-slate-500 dark:text-slate-400">{s.staffNo}</td>
                    <td className="td">{s.position}</td>
                    <td className="td">{s.department || '—'}</td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <a href={`tel:${s.phone.replace(/[^\d+]/g, '')}`} className="block whitespace-nowrap text-slate-600 hover:text-brand-600 dark:text-slate-300">{s.phone}</a>
                      <a href={`mailto:${s.email}`} className="block truncate text-xs text-slate-400 hover:text-brand-600">{s.email}</a>
                    </td>
                    <td className="td text-right tabular-nums">{load?.periods ? <span className={cx(load.periods > 36 && 'font-semibold text-rose-600 dark:text-rose-400')}>{load.periods} p/w</span> : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>
                    <td className="td"><Badge tone={st?.tone}>{st?.label ?? s.status}</Badge></td>
                    {canEdit && (
                      <td className="td pr-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" title="Edit" aria-label="Edit" onClick={() => setForm({ open: true, staff: s })}><Pencil size={15} /></button>
                          {s.id !== profile?.staffId && (
                            <button className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Delete" aria-label="Delete" onClick={() => remove(s)}><Trash2 size={15} /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <StaffFormModal open={form.open} staff={form.staff} departments={departments} all={staff} onClose={() => setForm({ open: false, staff: null })} />

      <Modal open={!!detail} onClose={() => setDetailId(null)} size="lg" title={detail ? fullStaffName(detail) : ''}
        footer={detail && canEdit ? <>
          <Button variant="outline" icon={<Pencil size={16} />} onClick={() => { setForm({ open: true, staff: detail }); setDetailId(null); }}>Edit</Button>
          <Button variant="ghost" onClick={() => setDetailId(null)}>Close</Button>
        </> : undefined}>
        {detail && (() => {
          const allocs = allocations.filter((a) => a.teacherId === detail.id)
            .map((a) => ({ a, c: classIdx.get(a.classId), s: subjectIdx.get(a.subjectId) }))
            .sort((x, y) => (x.c && y.c ? classSort(x.c, y.c) : 0) || (x.s?.name ?? '').localeCompare(y.s?.name ?? ''));
          const ct = classes.filter((c) => c.classTeacherId === detail.id).sort(classSort);
          const load = loadBy.get(detail.id);
          const periods = sum(allocs.map((x) => x.a.periodsPerWeek || 0));
          const st = STATUS.find((x) => x.id === detail.status);
          return (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar name={`${detail.firstName} ${detail.lastName}`} size={64} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-slate-900 dark:text-white">{detail.position}</p>
                    <Badge tone={st?.tone}>{st?.label}</Badge>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{detail.department} · <span className="font-mono">{detail.staffNo}</span> · joined {fmtDate(detail.hireDate)}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <a className="link flex items-center gap-1.5" href={`tel:${detail.phone.replace(/[^\d+]/g, '')}`}><Phone size={14} />{detail.phone}</a>
                    <a className="link flex items-center gap-1.5" href={`mailto:${detail.email}`}><Mail size={14} />{detail.email}</a>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <MiniStat label="Allocated" value={`${periods}`} sub="periods / week" warn={periods > 36} />
                <MiniStat label="Timetabled" value={`${load?.slots ?? 0}`} sub={`of ${capacity} slots`} />
                <MiniStat label="Classes" value={`${load?.classes.size ?? 0}`} sub="taught" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>Weekly timetable load</span><span>{Math.round(((load?.slots ?? 0) / capacity) * 100)}%</span></div>
                <Progress value={((load?.slots ?? 0) / capacity) * 100} tone={(load?.slots ?? 0) > 36 ? 'rose' : (load?.slots ?? 0) > 30 ? 'amber' : 'green'} />
              </div>

              <div>
                <p className="label">Class teacher of</p>
                {ct.length ? (
                  <div className="flex flex-wrap gap-2">{ct.map((c) => <Link key={c.id} to={`/students?class=${c.id}`}><Badge tone="blue"><School size={11} />{c.name}{c.room ? ` · ${c.room}` : ''}</Badge></Link>)}</div>
                ) : <p className="text-sm text-slate-400">Not a class teacher</p>}
              </div>

              <div>
                <p className="label">Teaching allocations</p>
                {allocs.length === 0 ? <p className="text-sm text-slate-400">No subjects allocated</p> : (
                  <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-white/[0.03]"><tr><th className="th">Class</th><th className="th">Subject</th><th className="th text-right">Periods / wk</th><th className="th text-right">Timetabled</th></tr></thead>
                      <tbody>
                        {allocs.map(({ a, c, s }) => {
                          const tt = timetable.filter((t) => t.teacherId === detail.id && t.classId === a.classId && t.subjectId === a.subjectId).length;
                          return (
                            <tr key={a.id} className="tr">
                              <td className="td font-medium">{c?.name ?? '—'}</td>
                              <td className="td">{s?.name ?? '—'}</td>
                              <td className="td text-right tabular-nums">{a.periodsPerWeek}</td>
                              <td className={cx('td text-right tabular-nums', tt < a.periodsPerWeek && 'text-marigold-600 dark:text-marigold-400')}>{tt}</td>
                            </tr>
                          );
                        })}
                        <tr className="tr bg-slate-50/70 font-bold dark:bg-white/[0.02]"><td className="td" colSpan={2}>Total</td><td className="td text-right tabular-nums">{periods}</td><td className="td text-right tabular-nums">{load?.slots ?? 0}</td></tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {detail.qualifications && <div><p className="label">Qualifications</p><p className="text-sm">{detail.qualifications}</p></div>}
              <p className="flex items-center gap-1.5 text-xs text-slate-400"><CalendarClock size={13} />Timetabled count is the number of weekly timetable slots assigned to this teacher.</p>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

const MiniStat: React.FC<{ label: string; value: string; sub: string; warn?: boolean }> = ({ label, value, sub, warn }) => (
  <div className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
    <p className={cx('text-xl font-bold tabular-nums', warn ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white')}>{value}</p>
    <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>
  </div>
);

const StaffFormModal: React.FC<{ open: boolean; staff: Staff | null; departments: string[]; all: Staff[]; onClose: () => void }> = ({ open, staff, departments, all, onClose }) => {
  const { toast } = useUI();
  const settingsName = useSettings()?.name;
  const [d, setD] = useState<Draft>(blank());
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setD(staff ? { ...blank(), ...staff } : { ...blank(), staffNo: nextStaffNo(all, settingsName) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff?.id]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!d.firstName.trim()) e.firstName = 'Required';
    if (!d.lastName.trim()) e.lastName = 'Required';
    if (!d.position.trim()) e.position = 'Required';
    if (!d.staffNo.trim()) e.staffNo = 'Required';
    else if (all.some((s) => s.staffNo.toLowerCase() === d.staffNo.trim().toLowerCase() && s.id !== staff?.id)) e.staffNo = 'Already in use';
    if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) e.email = 'Invalid email';
    setErrors(e);
    if (Object.keys(e).length) { toast('Please fix the highlighted fields', 'error'); return; }
    setSaving(true);
    try {
      const doc: Staff = {
        ...(staff ?? {}), ...d, id: staff?.id ?? newId(),
        staffNo: d.staffNo.trim(), firstName: d.firstName.trim(), lastName: d.lastName.trim(), position: d.position.trim(), department: d.department.trim(),
        phone: d.phone.trim(), email: d.email.trim(), qualifications: d.qualifications?.trim() || undefined,
      };
      await store.set('staff', doc);
      toast(staff ? 'Staff record updated' : `${doc.title} ${doc.lastName} added (${doc.staffNo})`);
      onClose();
    } catch (err: any) { toast(err?.message ?? 'Could not save', 'error'); } finally { setSaving(false); }
  };
  const err = (k: string) => errors[k] && <span className="mt-1 block text-xs text-rose-500 dark:text-rose-300">{errors[k]}</span>;

  return (
    <Modal open={open} onClose={onClose} size="lg" title={staff ? `Edit ${staff.title} ${staff.lastName}` : 'Add staff member'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={saving}>{staff ? 'Save changes' : 'Add staff'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid grid-cols-[100px_1fr] gap-3 sm:col-span-2 sm:grid-cols-[110px_1fr_1fr]">
          <Field label="Title"><Select value={d.title} onChange={(e) => set('title', e.target.value)}>{TITLES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="First name" required><Input value={d.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus />{err('firstName')}</Field>
          <Field label="Surname" required className="col-span-2 sm:col-span-1"><Input value={d.lastName} onChange={(e) => set('lastName', e.target.value)} />{err('lastName')}</Field>
        </div>
        <Field label="Gender"><Select value={d.gender} onChange={(e) => set('gender', e.target.value as Gender)}><option value="F">Female</option><option value="M">Male</option></Select></Field>
        <Field label="Staff number" required hint={staff ? undefined : 'Generated automatically'}><Input value={d.staffNo} onChange={(e) => set('staffNo', e.target.value)} className="font-mono" />{err('staffNo')}</Field>
        <Field label="Position" required><Input value={d.position} onChange={(e) => set('position', e.target.value)} placeholder="e.g. Teacher, HOD Sciences, Bursar" list="staff-positions" />{err('position')}</Field>
        <Field label="Department">
          <Input value={d.department} onChange={(e) => set('department', e.target.value)} list="staff-departments" placeholder="e.g. Sciences" />
          <datalist id="staff-departments">{departments.map((x) => <option key={x} value={x} />)}</datalist>
          <datalist id="staff-positions">{['Teacher', 'Class Teacher', 'Senior Teacher', 'HOD', 'Deputy Head', 'Headmaster', 'Headmistress', 'Bursar', 'Librarian', 'Secretary', 'Lab Technician'].map((x) => <option key={x} value={x} />)}</datalist>
        </Field>
        <Field label="Section">
          <Select value={d.section ?? 'both'} onChange={(e) => set('section', e.target.value as Section | 'both')}>
            <option value="primary">Primary (Junior school)</option><option value="secondary">Secondary</option><option value="both">Whole school</option>
          </Select>
        </Field>
        <Field label="Status"><Select value={d.status} onChange={(e) => set('status', e.target.value as StaffStatus)}>{STATUS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        <Field label="Phone"><Input type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+263 77 123 4567" /></Field>
        <Field label="Email"><Input type="email" value={d.email} onChange={(e) => set('email', e.target.value)} />{err('email')}</Field>
        <Field label="Date hired"><Input type="date" value={d.hireDate} onChange={(e) => set('hireDate', e.target.value)} /></Field>
        <Field label="Qualifications"><Input value={d.qualifications ?? ''} onChange={(e) => set('qualifications', e.target.value)} placeholder="e.g. BSc, PGDE" /></Field>
      </div>
    </Modal>
  );
};
