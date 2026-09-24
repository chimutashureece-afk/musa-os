import React, { useEffect, useMemo, useState } from 'react';
import {AlertTriangle, CalendarClock, Coffee, Eraser, Printer, Save, UtensilsCrossed} from 'lucide-react';
import { Subject, TimetableSlot } from '../types';
import { useAuth, useMyStaff, useSettings } from '../context/AuthContext';
import { store, useCollection, useIndex } from '../lib/store';
import { useCan, useClasses, useMyChildren } from '../lib/hooks';
import { cx, DAY_NAMES, DAYS, staffName } from '../lib/utils';
import { isStaffRole } from '../lib/permissions';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select, useUI } from '../components/ui';

// ---------------------------------------------------------- subject colour --
const PALETTE = [
  'bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-500/25 dark:text-sky-100 dark:border-sky-400/30',
  'bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-100 dark:border-emerald-400/20',
  'bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-500/15 dark:text-amber-100 dark:border-amber-400/20',
  'bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-500/25 dark:text-sky-100 dark:border-sky-400/30',
  'bg-rose-100 text-rose-900 border-rose-200 dark:bg-rose-500/25 dark:text-rose-100 dark:border-rose-400/30',
  'bg-teal-100 text-teal-900 border-teal-200 dark:bg-teal-500/25 dark:text-teal-100 dark:border-teal-400/30',
  'bg-indigo-100 text-indigo-900 border-indigo-200 dark:bg-indigo-500/25 dark:text-indigo-100 dark:border-indigo-400/30',
  'bg-orange-100 text-orange-900 border-orange-200 dark:bg-orange-500/15 dark:text-orange-100 dark:border-orange-400/20',
  'bg-lime-100 text-lime-900 border-lime-200 dark:bg-lime-500/25 dark:text-lime-100 dark:border-lime-400/30',
  'bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-500/25 dark:text-sky-100 dark:border-sky-400/30',
  'bg-cyan-100 text-cyan-900 border-cyan-200 dark:bg-cyan-500/25 dark:text-cyan-100 dark:border-cyan-400/30',
  'bg-pink-100 text-pink-900 border-pink-200 dark:bg-pink-500/25 dark:text-pink-100 dark:border-pink-400/30',
];
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
const subjectColor = (s?: Subject) => PALETTE[hash(s?.code || s?.id || '') % PALETTE.length]!;

type Mode = 'class' | 'teacher';

export default function Timetable() {
  const { profile } = useAuth();
  const me = useMyStaff();
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const canEdit = useCan('timetable');
  const isStaff = isStaffRole(profile?.role);
  const allClasses = useClasses();
  const children = useMyChildren();
  const { data: slots } = useCollection('timetable');
  const { data: allocs } = useCollection('allocations');
  const { data: staffList } = useCollection('staff');
  const subjects = useIndex('subjects');
  const staff = useIndex('staff');
  const classIdx = useMemo(() => new Map(allClasses.map((c) => [c.id, c])), [allClasses]);

  const visibleClasses = useMemo(() => {
    if (isStaff) return allClasses;
    const ids = new Set([...(profile?.classIds ?? []), ...children.map((c) => c.classId)]);
    return allClasses.filter((c) => ids.has(c.id));
  }, [isStaff, allClasses, profile?.classIds, children]);

  const [mode, setMode] = useState<Mode>(profile?.role === 'teacher' && profile.staffId ? 'teacher' : 'class');
  const [classId, setClassId] = useState('');
  const [teacherId, setTeacherId] = useState(profile?.staffId ?? '');

  useEffect(() => {
    if (classId && visibleClasses.some((c) => c.id === classId)) return;
    const child = children.find((c) => visibleClasses.some((v) => v.id === c.classId));
    const own = visibleClasses.find((c) => c.classTeacherId && c.classTeacherId === profile?.staffId);
    const pick = child?.classId ?? own?.id ?? visibleClasses[0]?.id;
    if (pick) setClassId(pick);
  }, [visibleClasses, children, classId, profile?.staffId]);

  const teachers = useMemo(() => {
    const ids = new Set<string>([...allocs.map((a) => a.teacherId), ...slots.map((s) => s.teacherId ?? '')]);
    return staffList.filter((s) => ids.has(s.id) || s.id === profile?.staffId).sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [allocs, slots, staffList, profile?.staffId]);

  useEffect(() => { if (!teacherId && teachers[0]) setTeacherId(teachers[0].id); }, [teachers, teacherId]);

  const effMode: Mode = isStaff ? mode : 'class';
  const periods = Math.max(1, settings?.periodsPerDay ?? 8);
  const times = settings?.periodTimes ?? [];
  const showBreaks = periods >= 8;
  const todayDow = new Date().getDay(); // 1..5 on weekdays

  // ---- clashes: same teacher, same day+period, >1 slot
  const clashes = useMemo(() => {
    const g = new Map<string, TimetableSlot[]>();
    slots.forEach((s) => { if (!s.teacherId) return; const k = `${s.teacherId}_${s.day}_${s.period}`; g.set(k, [...(g.get(k) ?? []), s]); });
    return [...g.values()].filter((x) => x.length > 1);
  }, [slots]);
  const clashIds = useMemo(() => new Set(clashes.flat().map((s) => s.id)), [clashes]);

  const cellSlots = useMemo(() => {
    const m = new Map<string, TimetableSlot[]>();
    slots.forEach((s) => {
      if (effMode === 'class' ? s.classId !== classId : s.teacherId !== teacherId) return;
      const k = `${s.day}_${s.period}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    });
    return m;
  }, [slots, effMode, classId, teacherId]);

  // periods per week: allocated vs scheduled (class view)
  const loadSummary = useMemo(() => {
    if (effMode !== 'class') return [];
    return allocs.filter((a) => a.classId === classId).map((a) => ({
      a, sub: subjects.get(a.subjectId), scheduled: slots.filter((s) => s.classId === classId && s.subjectId === a.subjectId).length,
    })).sort((x, y) => (x.sub?.name ?? '').localeCompare(y.sub?.name ?? ''));
  }, [effMode, allocs, classId, slots, subjects]);

  const teacherLoad = effMode === 'teacher' ? [...cellSlots.values()].flat().length : 0;

  // ---- editing
  const [edit, setEdit] = useState<{ day: number; period: number } | null>(null);
  const [form, setForm] = useState({ subjectId: '', teacherId: '', room: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const classAllocs = useMemo(() => allocs.filter((a) => a.classId === classId), [allocs, classId]);
  const subjectOptions = useMemo(() => {
    const ids = new Set(classAllocs.map((a) => a.subjectId));
    const list = [...subjects.values()].filter((s) => ids.size === 0 || ids.has(s.id));
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [classAllocs, subjects]);

  const openEdit = (day: number, period: number) => {
    if (!canEdit || effMode !== 'class' || !classId) return;
    const cur = cellSlots.get(`${day}_${period}`)?.[0];
    setForm({ subjectId: cur?.subjectId ?? '', teacherId: cur?.teacherId ?? '', room: cur?.room ?? classIdx.get(classId)?.room ?? '' });
    setErr('');
    setEdit({ day, period });
  };
  const onSubject = (subjectId: string) => {
    const al = classAllocs.find((a) => a.subjectId === subjectId);
    setForm((f) => ({ ...f, subjectId, teacherId: al?.teacherId ?? f.teacherId }));
    setErr('');
  };

  const saveSlot = async () => {
    if (!edit) return;
    if (!form.subjectId) { setErr('Choose a subject.'); return; }
    const id = `${classId}_${edit.day}_${edit.period}`;
    if (form.teacherId) {
      const clash = slots.find((s) => s.id !== id && s.teacherId === form.teacherId && s.day === edit.day && s.period === edit.period);
      if (clash) {
        const msg = `${staffName(staff.get(form.teacherId))} already teaches ${subjects.get(clash.subjectId)?.name ?? 'a lesson'} in ${classIdx.get(clash.classId)?.name ?? 'another class'} on ${DAY_NAMES[edit.day - 1]} period ${edit.period}.`;
        setErr(msg); toast('Timetable clash — slot not saved', 'error');
        return;
      }
    }
    setSaving(true);
    try {
      const existing = slots.find((s) => s.id === id);
      const doc: TimetableSlot = { id, classId, day: edit.day, period: edit.period, subjectId: form.subjectId };
      if (form.teacherId) doc.teacherId = form.teacherId;
      if (form.room.trim()) doc.room = form.room.trim();
      if (existing?.createdAt) doc.createdAt = existing.createdAt;
      await store.set('timetable', doc);
      toast('Lesson saved');
      setEdit(null);
    } catch (e: any) { toast(e.message ?? 'Could not save', 'error'); }
    finally { setSaving(false); }
  };
  const clearSlot = async () => {
    if (!edit) return;
    const id = `${classId}_${edit.day}_${edit.period}`;
    if (!slots.some((s) => s.id === id)) { setEdit(null); return; }
    if (!(await confirm({ title: 'Clear this lesson?', body: `${DAY_NAMES[edit.day - 1]}, period ${edit.period} will become a free period.`, confirmText: 'Clear', danger: true }))) return;
    await store.remove('timetable', id);
    toast('Lesson cleared', 'info');
    setEdit(null);
  };

  const title = effMode === 'class'
    ? `${classIdx.get(classId)?.name ?? 'Class'} timetable`
    : `${teacherId === profile?.staffId ? 'My' : staffName(staff.get(teacherId)) + '’s'} timetable`;

  const periodRows: React.ReactNode[] = [];
  for (let p = 1; p <= periods; p++) {
    periodRows.push(
      <tr key={`p${p}`}>
        <th className="border-b border-slate-100 px-2 py-2 text-left align-top dark:border-white/[0.06] print:border-slate-300">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">P{p}</div>
          <div className="whitespace-nowrap text-[10px] font-medium text-slate-400">{times[p - 1] ?? ''}</div>
        </th>
        {DAYS.map((_, di) => {
          const day = di + 1;
          const list = cellSlots.get(`${day}_${p}`) ?? [];
          const s = list[0];
          const sub = s ? subjects.get(s.subjectId) : undefined;
          const clash = list.length > 1 || (s && clashIds.has(s.id));
          const editable = canEdit && effMode === 'class';
          return (
            <td key={day} className={cx('border-b border-l border-slate-100 p-1 align-top dark:border-white/[0.06] print:border-slate-300', todayDow === day && 'bg-brand-50/50 dark:bg-brand-500/[0.05] print:bg-transparent')}>
              <button type="button" disabled={!editable} onClick={() => openEdit(day, p)}
                className={cx('flex h-full min-h-[58px] w-full flex-col rounded-lg border p-1.5 text-left transition',
                  s ? subjectColor(sub) : 'border-dashed border-slate-200 text-slate-300 dark:border-white/10 dark:text-slate-600',
                  editable && 'hover:ring-2 hover:ring-brand-400/50 cursor-pointer', !editable && 'cursor-default',
                  clash && 'ring-2 ring-rose-500')}>
                {s ? (
                  <>
                    <span className="flex items-center gap-1 text-xs font-bold leading-tight">
                      <span className="truncate">{sub?.name ?? 'Unknown subject'}</span>
                      {clash && <AlertTriangle size={11} className="shrink-0 text-rose-600 dark:text-rose-300" />}
                    </span>
                    <span className="mt-0.5 truncate text-[10px] font-medium opacity-75">
                      {effMode === 'class'
                        ? `${sub?.code ?? ''}${s.teacherId ? ` · ${staffName(staff.get(s.teacherId))}` : ''}`
                        : list.map((x) => classIdx.get(x.classId)?.name ?? '?').join(' + ')}
                    </span>
                    {s.room && <span className="truncate text-[10px] opacity-60">{s.room}</span>}
                  </>
                ) : <span className="m-auto text-[10px] font-medium">{editable ? '+ Add' : 'Free'}</span>}
              </button>
            </td>
          );
        })}
      </tr>,
    );
    if (showBreaks && (p === 3 || p === 6) && p < periods) {
      const lunch = p === 6;
      periodRows.push(
        <tr key={`b${p}`}>
          <td colSpan={6} className="border-b border-slate-100 bg-slate-50 px-3 py-1 text-center text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.02] print:border-slate-300">
            <span className="inline-flex items-center gap-1.5">{lunch ? <UtensilsCrossed size={11} /> : <Coffee size={11} />}{lunch ? 'Lunch' : 'Break'}</span>
          </td>
        </tr>,
      );
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Weekly schedule" title="Timetable"
        subtitle={effMode === 'class' ? 'Lessons for the class across the week.' : 'Lessons taught across all classes.'}
        actions={
          <>
            {isStaff && clashes.length > 0 && <Badge tone="red" className="!px-3 !py-1.5 !text-xs"><AlertTriangle size={13} /> {clashes.length} clash{clashes.length === 1 ? '' : 'es'}</Badge>}
            <Button variant="outline" icon={<Printer size={15} />} onClick={() => window.print()}>Print</Button>
          </>
        } />

      <Card className="mb-5 no-print" bodyClass="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {isStaff && (
            <div>
              <span className="label">View</span>
              <Segmented value={mode} onChange={setMode} options={[{ id: 'class', label: 'By class' }, { id: 'teacher', label: 'By teacher' }]} />
            </div>
          )}
          {effMode === 'class' ? (
            <Field label="Class" className="sm:w-64">
              <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                {visibleClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Teacher" className="sm:w-72">
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                {me && !teachers.some((t) => t.id === me.id) && <option value={me.id}>My timetable</option>}
                {teachers.map((t) => <option key={t.id} value={t.id}>{t.id === profile?.staffId ? `My timetable (${staffName(t)})` : `${staffName(t)} — ${t.firstName}`}</option>)}
              </Select>
            </Field>
          )}
          {effMode === 'teacher' && <p className="pb-2 text-xs text-slate-500 dark:text-slate-400">{teacherLoad} lesson{teacherLoad === 1 ? '' : 's'} per week</p>}
          {canEdit && effMode === 'class' && <p className="pb-2 text-xs text-slate-400 sm:ml-auto">Click any cell to add, change or clear a lesson.</p>}
        </div>
      </Card>

      {/* print header */}
      <div className="print-only mb-4 text-center">
        <h1 className="text-xl font-bold">{settings?.name}</h1>
        <p className="text-xs">{settings?.address}{settings?.phone ? ` · ${settings.phone}` : ''}</p>
        <h2 className="mt-2 text-lg font-semibold">{title}</h2>
      </div>

      {!classId && effMode === 'class' ? (
        <Card><EmptyState title="No class to show" body={isStaff ? 'Create classes first.' : 'Your account is not linked to a class yet.'} icon={<CalendarClock size={22} />} /></Card>
      ) : (
        <div className="card overflow-hidden print:border-0 print:shadow-none">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-white/[0.06] no-print">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
            {todayDow >= 1 && todayDow <= 5 && <span className="text-[11px] font-semibold text-brand-600 dark:text-brand-400">Today: {DAY_NAMES[todayDow - 1]}</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed border-collapse">
              <colgroup><col style={{ width: 78 }} />{DAYS.map((d) => <col key={d} />)}</colgroup>
              <thead>
                <tr>
                  <th className="border-b border-slate-100 dark:border-white/[0.06] print:border-slate-300" />
                  {DAYS.map((d, i) => (
                    <th key={d} className={cx('border-b border-l border-slate-100 px-2 py-2.5 text-center text-xs font-bold uppercase tracking-wider dark:border-white/[0.06] print:border-slate-300',
                      todayDow === i + 1 ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300 print:bg-transparent print:text-black' : 'text-slate-500 dark:text-slate-400')}>
                      <span className="hidden sm:inline print:inline">{DAY_NAMES[i]}</span><span className="sm:hidden print:hidden">{d}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{periodRows}</tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2 no-print">
        {effMode === 'class' && loadSummary.length > 0 && (
          <Card title="Periods per week" subtitle="Scheduled vs allocated for this class">
            <div className="grid gap-2 sm:grid-cols-2">
              {loadSummary.map(({ a, sub, scheduled }) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 dark:border-white/[0.06]">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cx('h-3 w-3 shrink-0 rounded border', subjectColor(sub))} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{sub?.name ?? '—'}</p>
                      <p className="truncate text-[11px] text-slate-400">{staffName(staff.get(a.teacherId))}</p>
                    </div>
                  </div>
                  <Badge tone={scheduled === a.periodsPerWeek ? 'green' : scheduled > a.periodsPerWeek ? 'violet' : 'amber'}>{scheduled}/{a.periodsPerWeek}</Badge>
                </div>
              ))}
            </div>
          </Card>
        )}
        {isStaff && clashes.length > 0 && (
          <Card title={<span className="flex items-center gap-2 text-rose-600 dark:text-rose-400"><AlertTriangle size={15} /> Clashes</span>} subtitle="A teacher is scheduled in more than one class at the same time">
            <ul className="space-y-2">
              {clashes.map((g) => {
                const s0 = g[0]!;
                return (
                  <li key={s0.id} className="rounded-xl bg-rose-50 px-3 py-2 text-sm dark:bg-rose-500/20">
                    <p className="font-semibold text-rose-800 dark:text-rose-300">{staffName(staff.get(s0.teacherId!))} · {DAY_NAMES[s0.day - 1]} P{s0.period}</p>
                    <p className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
                      {g.map((s) => (
                        <button key={s.id} className="link" onClick={() => { setMode('class'); setClassId(s.classId); }}>
                          {classIdx.get(s.classId)?.name ?? s.classId} ({subjects.get(s.subjectId)?.code ?? '?'})
                        </button>
                      ))}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} size="sm"
        title={edit ? `${classIdx.get(classId)?.name} · ${DAY_NAMES[edit.day - 1]} P${edit.period}` : ''}
        footer={
          <>
            {edit && slots.some((s) => s.id === `${classId}_${edit.day}_${edit.period}`) && <Button variant="ghost" className="mr-auto text-rose-600 dark:text-rose-300" icon={<Eraser size={15} />} onClick={clearSlot}>Clear</Button>}
            <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
            <Button icon={<Save size={15} />} loading={saving} onClick={saveSlot}>Save</Button>
          </>
        }>
        <div className="space-y-4">
          {edit && times[edit.period - 1] && <p className="text-xs text-slate-500 dark:text-slate-400">{times[edit.period - 1]}</p>}
          <Field label="Subject" required hint={classAllocs.length ? 'Subjects allocated to this class' : 'No allocations for this class — showing all subjects'}>
            <Select value={form.subjectId} onChange={(e) => onSubject(e.target.value)}>
              <option value="">Select subject…</option>
              {subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </Select>
          </Field>
          <Field label="Teacher" hint="Auto-filled from the allocation; change if a different teacher covers this lesson">
            <Select value={form.teacherId} onChange={(e) => { setForm((f) => ({ ...f, teacherId: e.target.value })); setErr(''); }}>
              <option value="">— No teacher —</option>
              {staffList.filter((s) => s.status !== 'left').sort((a, b) => a.lastName.localeCompare(b.lastName)).map((s) => <option key={s.id} value={s.id}>{staffName(s)} ({s.firstName})</option>)}
            </Select>
          </Field>
          <Field label="Room"><Input value={form.room} onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))} placeholder="e.g. Lab 2" /></Field>
          {err && <div className="flex gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{err}</div>}
        </div>
      </Modal>
    </div>
  );
}
