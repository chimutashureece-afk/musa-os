import { useMemo, useState } from 'react';
import {CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, Flag, MapPin, Pencil, Plus, Trash2} from 'lucide-react';
import { EventType, SchoolEvent } from '../types';
import { useAuth, useSettings } from '../context/AuthContext';
import { store, useCollection, useIndex } from '../lib/store';
import { useCan } from '../lib/hooks';
import { isStaffRole } from '../lib/permissions';
import { addDays, cx, fmtDate, parseISO, toISO, todayISO } from '../lib/utils';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Textarea, useUI } from '../components/ui';

const TYPES: { id: EventType; label: string; pill: string; dot: string }[] = [
  { id: 'academic', label: 'Academic', pill: 'bg-sky-100 text-sky-800 dark:bg-sky-500/25 dark:text-sky-200', dot: 'bg-sky-500' },
  { id: 'exam', label: 'Exam', pill: 'bg-rose-100 text-rose-800 dark:bg-rose-500/25 dark:text-rose-200', dot: 'bg-rose-500' },
  { id: 'holiday', label: 'Holiday', pill: 'bg-brand-100 text-brand-800 dark:bg-brand-500/25 dark:text-brand-200', dot: 'bg-brand-500' },
  { id: 'meeting', label: 'Meeting', pill: 'bg-slate-200 text-slate-800 dark:bg-white/10 dark:text-slate-200', dot: 'bg-slate-500' },
  { id: 'sports', label: 'Sports', pill: 'bg-marigold-100 text-marigold-800 dark:bg-marigold-400/25 dark:text-marigold-200', dot: 'bg-marigold-400' },
  { id: 'cultural', label: 'Cultural', pill: 'bg-marigold-50 text-marigold-900 ring-1 ring-inset ring-marigold-300 dark:bg-transparent dark:text-marigold-300 dark:ring-marigold-400/40', dot: 'bg-marigold-700' },
  { id: 'other', label: 'Other', pill: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400', dot: 'bg-slate-400' },
];
const typeOf = (t: EventType) => TYPES.find((x) => x.id === t) ?? TYPES[TYPES.length - 1]!;
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const covers = (e: SchoolEvent, d: string) => e.date <= d && d <= (e.endDate && e.endDate >= e.date ? e.endDate : e.date);

type Draft = { id?: string; title: string; type: EventType; date: string; endDate: string; location: string; description: string };

export default function CalendarPage() {
  const { profile } = useAuth();
  const settings = useSettings();
  const { toast, confirm } = useUI();
  const can = useCan('events');
  const isStaff = isStaffRole(profile?.role);
  const { data: events } = useCollection('events');
  const { data: assessments } = useCollection('assessments');
  const classes = useIndex('classes');
  const subjects = useIndex('subjects');
  const today = todayISO();

  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selected, setSelected] = useState(today);
  const [layers, setLayers] = useState({ events: true, terms: true, assessments: isStaff });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  // --- grid days (Mon-first, full weeks)
  const days = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = toISO(new Date(cursor.y, cursor.m, 1 - offset));
    const last = new Date(cursor.y, cursor.m + 1, 0);
    const cells = Math.ceil((offset + last.getDate()) / 7) * 7;
    return Array.from({ length: cells }, (_, i) => addDays(start, i));
  }, [cursor]);
  const monthKey = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;

  const termMarks = useMemo(() => {
    const m = new Map<string, { label: string; kind: 'start' | 'end' }[]>();
    (settings?.terms ?? []).forEach((t) => {
      m.set(t.start, [...(m.get(t.start) ?? []), { label: `${t.name} opens`, kind: 'start' }]);
      m.set(t.end, [...(m.get(t.end) ?? []), { label: `${t.name} closes`, kind: 'end' }]);
    });
    return m;
  }, [settings?.terms]);

  const assessByDay = useMemo(() => {
    const m = new Map<string, typeof assessments>();
    if (!isStaff) return m;
    assessments.forEach((a) => { if (a.date) m.set(a.date, [...(m.get(a.date) ?? []), a]); });
    return m;
  }, [assessments, isStaff]);

  const eventsOn = (d: string) => (layers.events ? events.filter((e) => covers(e, d)).sort((a, b) => a.date.localeCompare(b.date)) : []);

  const upcoming = useMemo(() => {
    const end = addDays(today, 30);
    const items: { date: string; title: string; sub?: string; tone: string; ev?: SchoolEvent }[] = [];
    events.forEach((e) => {
      const eEnd = e.endDate && e.endDate >= e.date ? e.endDate : e.date;
      if (eEnd >= today && e.date <= end) items.push({ date: e.date < today ? today : e.date, title: e.title, sub: e.endDate && e.endDate !== e.date ? `until ${fmtDate(e.endDate, { day: 'numeric', month: 'short' })}` : e.location, tone: typeOf(e.type).dot, ev: e });
    });
    termMarks.forEach((list, d) => { if (d >= today && d <= end) list.forEach((t) => items.push({ date: d, title: t.label, tone: 'bg-slate-900 dark:bg-white' })); });
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [events, termMarks, today]);

  const move = (n: number) => setCursor((c) => { const d = new Date(c.y, c.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const goToday = () => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setSelected(today); };

  const openNew = (date = selected) => setDraft({ title: '', type: 'academic', date, endDate: '', location: '', description: '' });
  const openEdit = (e: SchoolEvent) => setDraft({ id: e.id, title: e.title, type: e.type, date: e.date, endDate: e.endDate ?? '', location: e.location ?? '', description: e.description ?? '' });

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim() || !draft.date) { toast('Title and date are required', 'error'); return; }
    if (draft.endDate && draft.endDate < draft.date) { toast('End date is before start date', 'error'); return; }
    setSaving(true);
    try {
      const data: Omit<SchoolEvent, 'id'> = { title: draft.title.trim(), type: draft.type, date: draft.date };
      if (draft.endDate && draft.endDate !== draft.date) data.endDate = draft.endDate;
      if (draft.location.trim()) data.location = draft.location.trim();
      if (draft.description.trim()) data.description = draft.description.trim();
      if (draft.id) {
        const old = events.find((e) => e.id === draft.id);
        await store.set('events', { ...data, id: draft.id, ...(old?.createdAt ? { createdAt: old.createdAt } : {}) });
        toast('Event updated');
      } else {
        await store.add('events', data);
        toast('Event added');
      }
      setSelected(draft.date);
      setDraft(null);
    } catch (e: any) { toast(e.message ?? 'Could not save', 'error'); }
    finally { setSaving(false); }
  };
  const remove = async (e: SchoolEvent) => {
    if (!(await confirm({ title: 'Delete event?', body: `“${e.title}” will be removed from the calendar.`, confirmText: 'Delete', danger: true }))) return;
    await store.remove('events', e.id);
    setDraft(null);
    toast('Event deleted', 'info');
  };

  const selEvents = eventsOn(selected);
  const selTerms = layers.terms ? termMarks.get(selected) ?? [] : [];
  const selAssess = layers.assessments ? assessByDay.get(selected) ?? [] : [];
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const LayerToggle = ({ id, label, dot }: { id: keyof typeof layers; label: string; dot: string }) => (
    <button onClick={() => setLayers((l) => ({ ...l, [id]: !l[id] }))}
      className={cx('flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
        layers[id] ? 'border-slate-300 bg-white text-slate-800 dark:border-white/20 dark:bg-white/10 dark:text-white' : 'border-transparent text-slate-400 line-through')}>
      <span className={cx('h-2 w-2 rounded-full', dot)} />{label}
    </button>
  );

  return (
    <div>
      <PageHeader eyebrow="What's on" title="School calendar" subtitle="Term dates, events and examinations at a glance."
        actions={can && <Button variant="secondary" icon={<Plus size={16} />} onClick={() => openNew()}>Add event</Button>} />

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
            <div className="flex items-center gap-1">
              <button onClick={() => move(-1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 dark:text-slate-400" aria-label="Previous month"><ChevronLeft size={18} /></button>
              <button onClick={() => move(1)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 dark:text-slate-400" aria-label="Next month"><ChevronRight size={18} /></button>
            </div>
            <h2 className="font-display tracking-tight text-2xl font-bold text-slate-900 dark:text-white">{monthLabel}</h2>
            <Button size="sm" variant="outline" onClick={goToday}>Today</Button>
            <div className="flex flex-wrap gap-1.5 sm:ml-auto">
              <LayerToggle id="events" label="Events" dot="bg-sky-500" />
              <LayerToggle id="terms" label="Term dates" dot="bg-slate-900 dark:bg-white" />
              {isStaff && <LayerToggle id="assessments" label="Assessments" dot="bg-marigold-500" />}
            </div>
          </div>

          <div className="grid grid-cols-7 border-b border-slate-100 dark:border-white/[0.06]">
            {WEEK.map((w, i) => <div key={w} className={cx('px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider', i >= 5 ? 'text-slate-300 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400')}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d, i) => {
              const inMonth = d.startsWith(monthKey);
              const evs = eventsOn(d);
              const terms = layers.terms ? termMarks.get(d) ?? [] : [];
              const nA = layers.assessments ? assessByDay.get(d)?.length ?? 0 : 0;
              const isToday = d === today, isSel = d === selected;
              const weekend = i % 7 >= 5;
              return (
                <button key={d} onClick={() => setSelected(d)} onDoubleClick={() => can && openNew(d)}
                  className={cx('group relative flex min-h-[64px] flex-col items-stretch border-b border-r border-slate-100 p-1 text-left transition sm:min-h-[104px] sm:p-1.5 dark:border-white/[0.05]',
                    i % 7 === 6 && 'border-r-0', !inMonth && 'bg-slate-50/60 dark:bg-white/[0.01]', weekend && inMonth && 'bg-slate-50/30 dark:bg-white/[0.015]',
                    isSel ? 'ring-2 ring-inset ring-brand-500' : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]')}>
                  <div className="flex items-center justify-between">
                    <span className={cx('flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                      isToday ? 'bg-brand-600 text-white' : inMonth ? 'text-slate-700 dark:text-slate-200' : 'text-slate-300 dark:text-slate-600')}>
                      {parseISO(d).getDate()}
                    </span>
                    {nA > 0 && <span className="hidden rounded-md bg-marigold-100 px-1 text-[10px] font-bold text-marigold-700 sm:inline dark:bg-marigold-500/25 dark:text-marigold-300" title={`${nA} assessment(s)`}>{nA} <ClipboardCheck size={9} className="inline" /></span>}
                  </div>
                  {/* desktop pills */}
                  <div className="mt-1 hidden flex-col gap-0.5 sm:flex">
                    {terms.map((t) => (
                      <span key={t.label} className="flex items-center gap-1 truncate rounded bg-brand-800 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-brand-600"><Flag size={9} className="shrink-0" /><span className="truncate">{t.label}</span></span>
                    ))}
                    {evs.slice(0, 3).map((e) => {
                      const cont = e.date < d && d !== days[0] && (i % 7 !== 0);
                      return <span key={e.id} className={cx('truncate rounded px-1.5 py-0.5 text-[10px] font-semibold', typeOf(e.type).pill, cont && 'opacity-80')}>{cont ? '↳ ' : ''}{e.title}</span>;
                    })}
                    {evs.length > 3 && <span className="px-1 text-[10px] font-semibold text-slate-400">+{evs.length - 3} more</span>}
                  </div>
                  {/* mobile dots */}
                  <div className="mt-auto flex flex-wrap gap-0.5 sm:hidden">
                    {terms.length > 0 && <span className="h-1.5 w-1.5 rounded-full bg-slate-900 dark:bg-white" />}
                    {evs.slice(0, 4).map((e) => <span key={e.id} className={cx('h-1.5 w-1.5 rounded-full', typeOf(e.type).dot)} />)}
                    {nA > 0 && <span className="h-1.5 w-1.5 rounded-full bg-marigold-500" />}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-3 px-4 py-3 text-[11px] text-slate-500 dark:text-slate-400">
            {TYPES.map((t) => <span key={t.id} className="flex items-center gap-1.5"><span className={cx('h-2 w-2 rounded-full', t.dot)} />{t.label}</span>)}
          </div>
        </div>

        <div className="space-y-5">
          <Card title={fmtDate(selected, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            subtitle={selected === today ? 'Today' : undefined}
            actions={can && <Button size="sm" variant="outline" icon={<Plus size={13} />} onClick={() => openNew(selected)}>Add</Button>}>
            {selEvents.length + selTerms.length + selAssess.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-400">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-3">
                {selTerms.map((t) => (
                  <li key={t.label} className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><Flag size={14} className={t.kind === 'start' ? 'text-brand-500 dark:text-brand-300' : 'text-rose-500 dark:text-rose-300'} />{t.label}</li>
                ))}
                {selEvents.map((e) => (
                  <li key={e.id} className="group rounded-xl border border-slate-100 p-3 dark:border-white/[0.06]">
                    <div className="flex items-start gap-2">
                      <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', typeOf(e.type).dot)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{e.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          <Badge className="mr-1.5">{typeOf(e.type).label}</Badge>
                          {e.endDate && e.endDate !== e.date ? `${fmtDate(e.date, { day: 'numeric', month: 'short' })} – ${fmtDate(e.endDate, { day: 'numeric', month: 'short' })}` : 'All day'}
                        </p>
                        {e.location && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><MapPin size={11} />{e.location}</p>}
                        {e.description && <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{e.description}</p>}
                      </div>
                      {can && (
                        <div className="flex gap-0.5">
                          <button onClick={() => openEdit(e)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10" title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => remove(e)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Delete"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
                {selAssess.length > 0 && (
                  <li>
                    <p className="label flex items-center gap-1"><ClipboardCheck size={12} /> {selAssess.length} assessment{selAssess.length === 1 ? '' : 's'}</p>
                    <ul className="space-y-1">
                      {selAssess.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-marigold-50 px-2.5 py-1.5 text-xs dark:bg-marigold-500/20">
                          <span className="truncate font-medium text-slate-700 dark:text-slate-200">{a.name} · {subjects.get(a.subjectId)?.name ?? ''}</span>
                          <span className="shrink-0 text-slate-500 dark:text-slate-400">{classes.get(a.classId)?.name}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            )}
          </Card>

          <Card title="Upcoming" subtitle="Next 30 days" bodyClass="p-0">
            {upcoming.length === 0 ? <EmptyState title="Nothing coming up" icon={<CalendarDays size={22} />} /> : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {upcoming.map((u, i) => {
                  const dd = parseISO(u.date);
                  return (
                    <li key={i}>
                      <button className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                        onClick={() => { setSelected(u.date); setCursor({ y: dd.getFullYear(), m: dd.getMonth() }); }}>
                        <div className="w-10 shrink-0 text-center">
                          <p className="text-[10px] font-bold uppercase text-slate-400">{dd.toLocaleDateString('en-GB', { month: 'short' })}</p>
                          <p className="text-lg font-bold leading-none text-slate-900 dark:text-white">{dd.getDate()}</p>
                        </div>
                        <span className={cx('h-8 w-1 shrink-0 rounded-full', u.tone)} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{u.title}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.date === today ? 'Today' : dd.toLocaleDateString('en-GB', { weekday: 'long' })}{u.sub ? ` · ${u.sub}` : ''}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Edit event' : 'New event'}
        footer={
          <>
            {draft?.id && <Button variant="ghost" className="mr-auto text-rose-600 dark:text-rose-300" icon={<Trash2 size={15} />} onClick={() => { const e = events.find((x) => x.id === draft.id); if (e) remove(e); }}>Delete</Button>}
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button loading={saving} onClick={save}>{draft?.id ? 'Save changes' : 'Add event'}</Button>
          </>
        }>
        {draft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required className="sm:col-span-2"><Input autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Sports day" /></Field>
            <Field label="Type">
              <Select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as EventType })}>
                {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Location"><Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. School hall" /></Field>
            <Field label="Start date" required><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
            <Field label="End date" hint="Leave empty for a one-day event"><Input type="date" min={draft.date} value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
