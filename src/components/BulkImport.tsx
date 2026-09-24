// Add many learners or staff at once: from Excel/CSV, a photo of a list (OCR), or pasted
// names. Everything lands in one editable table to check before anything is saved.
import React, { useMemo, useRef, useState } from 'react';
import { Camera, ClipboardPaste, FileSpreadsheet, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button, Modal, Select, useUI } from './ui';
import { FIELDS, ImportKind, Row, parseLines, photoEngine, readPhoto, readSpreadsheet } from '../lib/ocr';
import { SchoolClass } from '../types';
import { cx, download } from '../lib/utils';

export interface ReviewRow extends Row { _id: string; classId?: string }

const uid = () => Math.random().toString(36).slice(2, 10);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "form 1 a", "Form1A", "1A" → the matching class. */
function matchClass(name: string | undefined, classes: SchoolClass[]): string | undefined {
  if (!name) return undefined;
  const n = squash(name);
  return (classes.find((c) => squash(c.name) === n)
    ?? classes.find((c) => squash(c.name).endsWith(n) && n.length >= 2)
    ?? classes.find((c) => squash(c.level) === n && classes.filter((x) => x.level === c.level).length === 1))?.id;
}

export function normDate(v?: string): string {
  const s = (v ?? '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!; return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`; }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
const normGender = (v?: string) => { const g = (v ?? '').trim().toUpperCase(); return /^(M|MALE|BOY)$/.test(g) ? 'M' : /^(F|FEMALE|GIRL)$/.test(g) ? 'F' : ''; };

const nameKey = (r: Row) => `${r.firstName ?? ''} ${r.lastName ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();

function problems(r: ReviewRow, kind: ImportKind, dup?: 'existing' | 'repeat'): string[] {
  const p: string[] = [];
  if (dup === 'existing') p.push('already on the register');
  if (dup === 'repeat') p.push('listed twice');
  if (!r.firstName?.trim()) p.push('first name');
  if (!r.lastName?.trim()) p.push('surname');
  if (!r.gender) p.push('gender');
  if (kind === 'students' && !r.classId) p.push('class');
  return p;
}

type Source = 'file' | 'photo' | 'paste';

export const BulkImport: React.FC<{
  kind: ImportKind;
  open: boolean;
  onClose: () => void;
  classes?: SchoolClass[];
  defaultClassId?: string;
  onTemplate: () => void;
  onImport: (rows: ReviewRow[]) => Promise<void>;
  /** Names already on file ("first last"), so repeats are skipped. */
  existing?: string[];
}> = ({ kind, open, onClose, classes = [], defaultClassId, onTemplate, onImport, existing = [] }) => {
  const { toast } = useUI();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState<null | { pct: number; label: string; preview?: string }>(null);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const noun = kind === 'students' ? 'learner' : 'staff member';
  const cols = FIELDS[kind].filter((f) => f.key !== 'className');

  const close = () => { if (saving) return; setRows([]); setPaste(''); setShowPaste(false); setBusy(null); onClose(); };

  const add = (found: Row[], from: string) => {
    if (!found.length) { toast(`No ${noun} names found in ${from}. Try a clearer photo, or check the columns.`, 'error'); return; }
    const clean: ReviewRow[] = found.map((r) => ({
      ...r, _id: uid(), gender: normGender(r.gender), dob: normDate(r.dob),
      ...(kind === 'students' ? { classId: matchClass(r.className, classes) ?? defaultClassId } : {}),
    }));
    setRows((prev) => [...prev, ...clean]);
    toast(`Found ${clean.length} ${clean.length === 1 ? noun : kind === 'students' ? 'learners' : 'staff'} in ${from}`);
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy({ pct: 40, label: `Reading ${f.name}…` });
    try { add(await readSpreadsheet(f, kind), f.name); } catch { toast('Could not read that file. Save it as .xlsx or .csv and try again.', 'error'); }
    setBusy(null);
  };
  const onPhoto = async (f?: File) => {
    if (!f) return;
    const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
    setBusy({ pct: 3, label: 'Preparing the photo…', preview });
    try { add(await readPhoto(f, kind, (pct, label) => setBusy({ pct, label, preview })), 'the photo'); }
    catch (e: any) { toast(e?.message ?? 'Could not read that photo', 'error'); }
    if (preview) URL.revokeObjectURL(preview);
    setBusy(null);
  };
  const onPaste = () => { add(parseLines(paste, kind), 'the pasted text'); setPaste(''); setShowPaste(false); };

  const set = (id: string, patch: Partial<ReviewRow>) => setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  const known = useMemo(() => new Set(existing.map((n) => n.toLowerCase().replace(/\s+/g, ' ').trim())), [existing]);
  const withIssues = useMemo(() => {
    const seen = new Set<string>();
    return rows.map((r) => {
      const k = nameKey(r);
      const dup = k.length > 2 && known.has(k) ? 'existing' as const : k.length > 2 && seen.has(k) ? 'repeat' as const : undefined;
      seen.add(k);
      return { r, p: problems(r, kind, dup) };
    });
  }, [rows, kind, known]);
  const ready = withIssues.filter((x) => !x.p.length).length;

  const save = async () => {
    const ok = withIssues.filter((x) => !x.p.length).map((x) => x.r);
    if (!ok.length) return;
    setSaving(true);
    try { await onImport(ok); toast(`Added ${ok.length} ${ok.length === 1 ? noun : kind === 'students' ? 'learners' : 'staff'}`); setSaving(false); close(); }
    catch (e: any) { toast(e?.message ?? 'Import failed', 'error'); setSaving(false); }
  };

  const tile = (icon: React.ReactNode, title: string, body: string, onClick: () => void, extra?: React.ReactNode) => (
    <button type="button" onClick={onClick} disabled={!!busy}
      className="group flex flex-col items-start rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-600 hover:ring-[3px] hover:ring-brand-600/10 disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-brand-400">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">{icon}</span>
      <span className="mt-3 font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</span>
      <span className="mt-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{body}</span>
      {extra}
    </button>
  );

  const inputCls = 'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-[13px] text-slate-900 outline-none hover:border-slate-200 focus:border-brand-500 focus:bg-white dark:text-white dark:hover:border-white/10 dark:focus:bg-white/[0.04]';

  return (
    <Modal open={open} onClose={close} size="xl" title={kind === 'students' ? 'Add many learners' : 'Add many staff'}
      footer={rows.length ? <>
        <span className="mr-auto text-sm text-slate-500 dark:text-slate-400"><b className="text-slate-900 dark:text-white">{ready}</b> ready{rows.length - ready > 0 && <> · <b className="text-marigold-700 dark:text-marigold-300">{rows.length - ready}</b> need a detail</>}</span>
        <Button variant="outline" onClick={() => setRows([])} disabled={saving}>Start over</Button>
        <Button onClick={save} loading={saving} disabled={!ready}>Add {ready} {ready === 1 ? noun : kind === 'students' ? 'learners' : 'staff'}</Button>
      </> : undefined}>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.ods,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={photoRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />

      {busy && (
        <div className="mb-4 flex items-center gap-4 rounded-xl border border-slate-200 p-4 dark:border-white/10">
          {busy.preview && <img src={busy.preview} alt="" className="h-20 w-16 shrink-0 rounded-md object-cover ring-1 ring-black/10" />}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{busy.label}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full rounded-full bg-brand-600 transition-all duration-300 dark:bg-brand-400" style={{ width: `${busy.pct}%` }} /></div>
          </div>
        </div>
      )}

      {!rows.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {tile(<FileSpreadsheet size={19} />, 'Excel or CSV file', `Any spreadsheet with a row per ${noun}. Columns are matched by their headings.`, () => fileRef.current?.click(),
              <span className="mt-3 text-xs font-semibold text-brand-700 underline-offset-2 group-hover:underline dark:text-brand-300" onClick={(e) => { e.stopPropagation(); onTemplate(); }}>Download a template</span>)}
            {tile(<Camera size={19} />, 'Photo of a list', photoEngine === 'ai' ? 'A class list, register or enrolment form — handwriting is fine. Take it straight on, in good light.' : 'A printed or typed class list or register. Take it straight on, in good light.', () => photoRef.current?.click(),
              <span className="mt-3 inline-flex items-center gap-1 text-xs text-slate-400"><Sparkles size={12} /> {photoEngine === 'ai' ? 'AI reader' : 'Text reader (OCR)'}</span>)}
            {tile(<ClipboardPaste size={19} />, 'Paste names', 'From WhatsApp, Word or an email — one name per line. Class, gender and phone on the line are picked up too.', () => setShowPaste(true))}
          </div>
          {showPaste && (
            <div className="mt-4 animate-slide-up">
              <textarea autoFocus value={paste} onChange={(e) => setPaste(e.target.value)} rows={7} className="input h-auto py-2 font-mono text-[13px]"
                placeholder={kind === 'students' ? '1. MOYO Tatenda  M  Form 1A  0772 123 456\n2. Ncube, Rutendo  F\n3. Farai Dube' : 'Mr Brian Sibanda, Teacher\nMrs R. Moyo, Deputy Head\nTendai Ncube'} />
              <div className="mt-2 flex justify-end gap-2"><Button variant="outline" onClick={() => setShowPaste(false)}>Cancel</Button><Button onClick={onPaste} disabled={!paste.trim()}>Read names</Button></div>
            </div>
          )}
          {kind === 'students' && !classes.length && <p className="mt-4 rounded-lg bg-marigold-50 px-3 py-2 text-sm text-marigold-900 dark:bg-marigold-400/10 dark:text-marigold-100">Create your classes first — every learner needs a class.</p>}
        </>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {kind === 'students' && (
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">Put everyone in
                <Select className="h-8 w-44 py-0 text-sm" value="" onChange={(e) => e.target.value && setRows((rs) => rs.map((r) => ({ ...r, classId: e.target.value })))}>
                  <option value="">choose class…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">Blank gender →
              <Select className="h-8 w-28 py-0 text-sm" value="" onChange={(e) => e.target.value && setRows((rs) => rs.map((r) => (r.gender ? r : { ...r, gender: e.target.value })))}>
                <option value="">set…</option><option value="F">Female</option><option value="M">Male</option>
              </Select>
            </label>
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" variant="ghost" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>Add file</Button>
              <Button size="sm" variant="ghost" icon={<Camera size={14} />} onClick={() => photoRef.current?.click()}>Add photo</Button>
              <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setRows((rs) => [...rs, { _id: uid(), firstName: '', lastName: '', gender: '', classId: defaultClassId }])}>Add row</Button>
            </span>
          </div>
          <div className="max-h-[52vh] overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="sticky top-0 z-10"><tr>
                <th className="th w-8" />
                {cols.map((c) => <th key={c.key} className="th">{c.label}</th>)}
                {kind === 'students' && <th className="th">Class</th>}
                <th className="th w-10" />
              </tr></thead>
              <tbody>
                {withIssues.map(({ r, p }) => (
                  <tr key={r._id} className="tr align-middle">
                    <td className="px-2"><span title={p.length ? `Missing: ${p.join(', ')}` : 'Ready'} className={cx('block h-2 w-2 rounded-full', p.length ? 'bg-marigold-400' : 'bg-brand-500')} /></td>
                    {cols.map((c) => (
                      <td key={c.key} className="px-1 py-0.5">
                        {c.key === 'gender' ? (
                          <select value={r.gender ?? ''} onChange={(e) => set(r._id, { gender: e.target.value })} className={cx(inputCls, 'w-20', !r.gender && 'border-marigold-300 dark:border-marigold-400/40')}>
                            <option value="">—</option><option value="F">F</option><option value="M">M</option>
                          </select>
                        ) : (
                          <input value={r[c.key] ?? ''} onChange={(e) => set(r._id, { [c.key]: e.target.value })} type={c.key === 'dob' ? 'date' : 'text'} aria-label={c.label}
                            className={cx(inputCls, (c.key === 'firstName' || c.key === 'lastName') && !r[c.key]?.trim() && 'border-marigold-300 dark:border-marigold-400/40')} />
                        )}
                      </td>
                    ))}
                    {kind === 'students' && (
                      <td className="px-1 py-0.5">
                        <select value={r.classId ?? ''} onChange={(e) => set(r._id, { classId: e.target.value || undefined })} className={cx(inputCls, 'min-w-[110px]', !r.classId && 'border-marigold-300 dark:border-marigold-400/40')}>
                          <option value="">{r.className ? `“${r.className}”?` : '—'}</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                    )}
                    <td className="px-1"><button onClick={() => setRows((rs) => rs.filter((x) => x._id !== r._id))} aria-label="Remove row" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 dark:hover:bg-white/5"><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Check the names against the page — photos and handwriting can be misread. Rows with an orange dot are skipped until they have {kind === 'students' ? 'a name, gender and class' : 'a name and gender'}; people already on the register are skipped too. Hover a dot to see why.</p>
        </>
      )}
    </Modal>
  );
};

/** CSV template with the headings the importer understands. */
export function downloadTemplate(kind: ImportKind, sampleClass = 'Form 1A') {
  if (kind === 'students') download('learners-template.csv', `First name,Surname,Gender,Date of birth,Class,Parent / guardian,Phone\nTatenda,Moyo,M,2013-04-21,${sampleClass},Mrs Rudo Moyo,0772 123 456\n`);
  else download('staff-template.csv', 'Title,First name,Surname,Gender,Position,Department,Phone,Email\nMr,Brian,Sibanda,M,Teacher,Languages,0772 123 456,b.sibanda@school.co.zw\n');
}
