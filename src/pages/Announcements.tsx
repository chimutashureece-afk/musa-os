import { useEffect, useMemo, useState } from 'react';
import {Copy, Megaphone, MessageCircle, Pencil, Phone, Pin, PinOff, Plus, Trash2, Users} from 'lucide-react';
import { Announcement, Audience } from '../types';
import { useAuth } from '../context/AuthContext';
import { store, useCollection, useIndex } from '../lib/store';
import { useCan, useClassStudents, useClasses } from '../lib/hooks';
import { isStaffRole } from '../lib/permissions';
import { cx, fmtDate, fullName, staffName, todayISO } from '../lib/utils';
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Segmented, Select, Textarea, useUI } from '../components/ui';

const AUDIENCES: { id: Audience; label: string; tone: 'blue' | 'violet' | 'green' | 'amber' }[] = [
  { id: 'all', label: 'Everyone', tone: 'blue' },
  { id: 'staff', label: 'Staff', tone: 'violet' },
  { id: 'parents', label: 'Parents', tone: 'green' },
  { id: 'students', label: 'Students', tone: 'amber' },
];
const audLabel = (a: Audience) => AUDIENCES.find((x) => x.id === a)!;

/** Normalise a phone to international digits for wa.me (Zimbabwe local 07… → 2637…). */
const waDigits = (phone: string) => {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `263${d.slice(1)}`;
  return d;
};

type Draft = { id?: string; title: string; body: string; audience: Audience[]; classIds: string[]; pinned: boolean; date: string };
const blank = (): Draft => ({ title: '', body: '', audience: ['all'], classIds: [], pinned: false, date: todayISO() });

export default function Announcements() {
  const { profile } = useAuth();
  const { toast, confirm } = useUI();
  const can = useCan('announcements');
  const isStaff = isStaffRole(profile?.role);
  const isAdmin = profile?.role === 'admin';
  const me = profile?.staffId ?? profile?.id ?? '';
  const { data: items } = useCollection('announcements');
  const staff = useIndex('staff');
  const classes = useClasses();
  const classIdx = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const [filter, setFilter] = useState<'any' | Audience>('any');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const role = profile?.role;
    const myClasses = new Set(profile?.classIds ?? []);
    return items.filter((a) => {
      if (isStaff) return true;
      const key: Audience = role === 'parent' ? 'parents' : 'students';
      if (!a.audience.includes('all') && !a.audience.includes(key)) return false;
      if (a.classIds?.length && !a.classIds.some((c) => myClasses.has(c))) return false;
      return true;
    }).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [items, profile, isStaff]);

  const shown = visible.filter((a) => (filter === 'any' || a.audience.includes(filter)) && (!q || `${a.title} ${a.body}`.toLowerCase().includes(q.toLowerCase())));

  const canEditItem = (a: Announcement) => can && (isAdmin || a.author === me);

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim() || !draft.body.trim()) { toast('Title and message are required', 'error'); return; }
    if (!draft.audience.length) { toast('Choose at least one audience', 'error'); return; }
    setSaving(true);
    try {
      const existing = draft.id ? items.find((x) => x.id === draft.id) : undefined;
      const doc: Announcement = {
        id: draft.id ?? '', title: draft.title.trim(), body: draft.body.trim(), audience: draft.audience, date: draft.date || todayISO(),
        author: existing?.author ?? me, pinned: draft.pinned,
      };
      if (draft.classIds.length) doc.classIds = draft.classIds;
      if (existing) {
        if (existing.createdAt) doc.createdAt = existing.createdAt;
        await store.set('announcements', doc);
        toast('Announcement updated');
      } else {
        const { id: _omit, ...rest } = doc;
        await store.add('announcements', rest);
        toast('Announcement posted');
      }
      setDraft(null);
    } catch (e: any) { toast(e.message ?? 'Could not save', 'error'); }
    finally { setSaving(false); }
  };

  const remove = async (a: Announcement) => {
    if (!(await confirm({ title: 'Delete announcement?', body: `“${a.title}” will be removed for everyone.`, confirmText: 'Delete', danger: true }))) return;
    await store.remove('announcements', a.id);
    toast('Announcement deleted', 'info');
  };
  const togglePin = async (a: Announcement) => { await store.update('announcements', a.id, { pinned: !a.pinned }); };

  const toggleAud = (id: Audience) => setDraft((d) => d && ({ ...d, audience: d.audience.includes(id) ? d.audience.filter((x) => x !== id) : [...d.audience, id] }));
  const toggleCls = (id: string) => setDraft((d) => d && ({ ...d, classIds: d.classIds.includes(id) ? d.classIds.filter((x) => x !== id) : [...d.classIds, id] }));

  return (
    <div>
      <PageHeader eyebrow="Communication" title="Announcements" subtitle="News and notices from the school."
        actions={can && <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setDraft(blank())}>New announcement</Button>} />

      <div className={cx('grid gap-5', isStaff && 'lg:grid-cols-[1fr_340px]')}>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {isStaff && (
              <div className="overflow-x-auto">
                <Segmented value={filter} onChange={setFilter} options={[{ id: 'any', label: 'All' }, ...AUDIENCES.map((a) => ({ id: a.id, label: a.label }))]} />
              </div>
            )}
            <SearchInput value={q} onChange={setQ} className="sm:ml-auto sm:w-64" placeholder="Search announcements…" />
          </div>

          {shown.length === 0 ? (
            <Card><EmptyState title="No announcements" body={q || filter !== 'any' ? 'Try a different filter.' : 'Nothing has been posted yet.'} icon={<Megaphone size={22} />} /></Card>
          ) : shown.map((a) => {
            const author = staff.get(a.author);
            const long = a.body.length > 320;
            const open = expanded.has(a.id);
            return (
              <article key={a.id} className={cx('card p-5', a.pinned && 'border-brand-200 ring-1 ring-brand-200/60 dark:border-brand-500/40 dark:ring-brand-500/30')}>
                <div className="flex items-start gap-3">
                  <Avatar name={author ? `${author.firstName} ${author.lastName}` : 'School Office'} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.pinned && <Badge tone="blue"><Pin size={10} /> Pinned</Badge>}
                      {a.audience.map((x) => <Badge key={x} tone={audLabel(x).tone}>{audLabel(x).label}</Badge>)}
                      {a.classIds?.map((c) => <Badge key={c} tone="slate">{classIdx.get(c)?.name ?? c}</Badge>)}
                    </div>
                    <h3 className="mt-2 text-lg font-bold leading-snug text-slate-900 dark:text-white">{a.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {author ? `${staffName(author)} · ${author.position}` : 'School office'} · {fmtDate(a.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <p className={cx('mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300', long && !open && 'line-clamp-4')}>{a.body}</p>
                    {long && <button className="link mt-1 text-xs font-semibold" onClick={() => setExpanded((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })}>{open ? 'Show less' : 'Read more'}</button>}
                  </div>
                  {canEditItem(a) && (
                    <div className="flex shrink-0 gap-0.5">
                      {<button onClick={() => togglePin(a)} title={a.pinned ? 'Unpin' : 'Pin'} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white">{a.pinned ? <PinOff size={15} /> : <Pin size={15} />}</button>}
                      <button onClick={() => setDraft({ id: a.id, title: a.title, body: a.body, audience: a.audience, classIds: a.classIds ?? [], pinned: !!a.pinned, date: a.date })} title="Edit" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white"><Pencil size={15} /></button>
                      <button onClick={() => remove(a)} title="Delete" className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"><Trash2 size={15} /></button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {isStaff && <ContactParents announcements={visible} />}
      </div>

      <Modal open={!!draft} onClose={() => setDraft(null)} size="lg" title={draft?.id ? 'Edit announcement' : 'New announcement'}
        footer={<><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button loading={saving} onClick={save}>{draft?.id ? 'Save changes' : 'Post announcement'}</Button></>}>
        {draft && (
          <div className="space-y-4">
            <Field label="Title" required><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Consultation day on Friday" autoFocus /></Field>
            <Field label="Message" required><Textarea rows={7} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="label">Audience</span>
                <div className="flex flex-wrap gap-2">
                  {AUDIENCES.map((a) => (
                    <label key={a.id} className={cx('flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition',
                      draft.audience.includes(a.id) ? 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200' : 'border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300')}>
                      <input type="checkbox" className="accent-brand-600" checked={draft.audience.includes(a.id)} onChange={() => toggleAud(a.id)} />{a.label}
                    </label>
                  ))}
                </div>
              </div>
              <Field label="Date"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
            </div>
            <div>
              <span className="label">Target classes <span className="normal-case tracking-normal text-slate-400">(optional — leave empty for the whole school)</span></span>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-white/10">
                {classes.map((c) => (
                  <button key={c.id} type="button" onClick={() => toggleCls(c.id)}
                    className={cx('rounded-lg px-2.5 py-1 text-xs font-semibold transition', draft.classIds.includes(c.id) ? 'bg-brand-800 text-white dark:bg-brand-600 dark:text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10')}>
                    {c.name}
                  </button>
                ))}
              </div>
              {draft.classIds.length > 0 && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Only parents/students of {draft.classIds.length} selected class{draft.classIds.length === 1 ? '' : 'es'} will see this.</p>}
            </div>
            {(
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="accent-brand-600" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} /> Pin to the top of the feed
              </label>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ----------------------------------------------------------- contact panel --
function ContactParents({ announcements }: { announcements: Announcement[] }) {
  const { toast } = useUI();
  const classes = useClasses();
  const [classId, setClassId] = useState('');
  const [annId, setAnnId] = useState('');
  useEffect(() => { if (!annId && announcements[0]) setAnnId(announcements[0].id); }, [announcements, annId]);
  const students = useClassStudents(classId);
  const ann = announcements.find((a) => a.id === annId);

  const guardians = useMemo(() => students.flatMap((s) => (s.guardians ?? []).filter((g) => g.phone).map((g, i) => ({ key: `${s.id}_${i}`, s, g }))), [students]);
  const phones = useMemo(() => [...new Set(guardians.map((x) => x.g.phone.trim()))], [guardians]);

  const copyAll = async () => {
    try { await navigator.clipboard.writeText(phones.join(', ')); toast(`${phones.length} numbers copied`); }
    catch { toast('Clipboard not available in this browser', 'error'); }
  };
  const msg = ann ? `${ann.title}` : '';

  return (
    <div className="lg:sticky lg:top-4 lg:self-start">
      <Card title={<span className="flex items-center gap-2"><Phone size={15} /> Contact parents</span>} subtitle="Reach guardians by phone or WhatsApp">
        <div className="space-y-3">
          <Field label="Class">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Choose a class…</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Share announcement" hint="Pre-fills the WhatsApp message">
            <Select value={annId} onChange={(e) => setAnnId(e.target.value)}>
              <option value="">— None —</option>
              {announcements.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
            </Select>
          </Field>
          {classId && (
            guardians.length === 0 ? <EmptyState title="No guardian numbers" icon={<Users size={20} />} /> : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500 dark:text-slate-400">{guardians.length} guardian{guardians.length === 1 ? '' : 's'} · {phones.length} number{phones.length === 1 ? '' : 's'}</p>
                  <Button size="sm" variant="outline" icon={<Copy size={13} />} onClick={copyAll}>Copy all numbers</Button>
                </div>
                <ul className="-mx-2 max-h-[420px] divide-y divide-slate-100 overflow-y-auto dark:divide-white/[0.05]">
                  {guardians.map(({ key, s, g }) => (
                    <li key={key} className="flex items-center gap-2 px-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{g.name}</p>
                        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{g.relation} of {fullName(s)} · <a href={`tel:${g.phone}`} className="link">{g.phone}</a></p>
                      </div>
                      <a href={`https://wa.me/${waDigits(g.phone)}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`} target="_blank" rel="noreferrer" title="WhatsApp"
                        className="rounded-lg bg-slate-100 p-2 text-slate-700 hover:bg-brand-100 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-brand-500/20">
                        <MessageCircle size={15} />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </div>
      </Card>
    </div>
  );
}
