import React, { useRef, useState } from 'react';
import {ClipboardPaste, FileText, FileType2, Image as ImageIcon, Loader2, UploadCloud, X} from 'lucide-react';
import { Button, Segmented, Textarea, useUI } from '../../components/ui';
import { cx } from '../../lib/utils';
import { newId } from '../../lib/store';
import type { SubmissionInput } from '../../types';

export type DropKind = 'image' | 'pdf' | 'docx' | 'text';
export interface DroppedFile {
  id: string;
  name: string;
  size: number;
  kind: DropKind;
  input: SubmissionInput;
}

const MAX_PDF = 8 * 1024 * 1024;
const MAX_IMG_SIDE = 1600;

const readAsDataURL = (f: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as string);
  r.onerror = () => rej(r.error ?? new Error('Could not read file'));
  r.readAsDataURL(f);
});

async function downscaleImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`“${file.name}” is not a readable image (HEIC photos: export as JPEG first).`));
      i.src = url;
    });
    const scale = Math.min(1, MAX_IMG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1]!;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function docxToText(file: File): Promise<string> {
  const { default: mammoth } = await import('mammoth/mammoth.browser');
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return value.replace(/\n{3,}/g, '\n\n').trim();
}

/** Reads one file into a SubmissionInput. Throws a user-friendly Error for unsupported/oversized files. */
export async function readDroppedFile(file: File): Promise<DroppedFile> {
  const name = file.name || 'pasted-file';
  const lower = name.toLowerCase();
  const base = { id: newId(), name, size: file.size };
  if (file.type.startsWith('image/')) {
    const data = await downscaleImage(file);
    return { ...base, kind: 'image', input: { type: 'file', content: data, mimeType: 'image/jpeg', fileName: name } };
  }
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
    if (file.size > MAX_PDF) throw new Error(`“${name}” is ${(file.size / 1048576).toFixed(1)} MB — PDFs must be under 8 MB.`);
    const data = (await readAsDataURL(file)).split(',')[1]!;
    return { ...base, kind: 'pdf', input: { type: 'file', content: data, mimeType: 'application/pdf', fileName: name } };
  }
  if (lower.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const text = await docxToText(file);
    if (!text) throw new Error(`“${name}” contains no readable text.`);
    return { ...base, kind: 'docx', input: { type: 'text', content: text, fileName: name } };
  }
  if (lower.endsWith('.doc')) throw new Error(`“${name}” is an old Word .doc file — save it as .docx or PDF.`);
  if (file.type.startsWith('text/') || /\.(txt|md|markdown|rtf|csv)$/.test(lower)) {
    const text = (await file.text()).trim();
    if (!text) throw new Error(`“${name}” is empty.`);
    return { ...base, kind: 'text', input: { type: 'text', content: text, fileName: name } };
  }
  throw new Error(`“${name}” isn't supported. Use images, PDF, .docx or .txt files.`);
}

export const kindIcon = (k: DropKind, size = 18) =>
  k === 'image' ? <ImageIcon size={size} /> : k === 'pdf' ? <FileType2 size={size} /> : <FileText size={size} />;

export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Drag-drop / click / paste file intake. Calls onFiles with successfully read files;
 * failures are reported with toasts. Optional paste-text mode.
 */
export const FileDrop: React.FC<{
  onFiles: (files: DroppedFile[]) => void;
  multiple?: boolean;
  allowText?: boolean;
  title?: string;
  hint?: string;
  compact?: boolean;
  textPlaceholder?: string;
  textButton?: string;
  className?: string;
}> = ({ onFiles, multiple = true, allowText = true, title, hint, compact, textPlaceholder, textButton = 'Use this text', className }) => {
  const { toast } = useUI();
  const ref = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [text, setText] = useState('');

  const handle = async (list: FileList | File[]) => {
    const files = Array.from(list).slice(0, multiple ? 200 : 1);
    if (!files.length) return;
    setBusy(files.length);
    const ok: DroppedFile[] = [];
    for (const f of files) {
      try { ok.push(await readDroppedFile(f)); }
      catch (e: any) { toast(e?.message ?? `Could not read ${f.name}`, 'error'); }
      setBusy((b) => b - 1);
    }
    setBusy(0);
    if (ok.length) onFiles(ok);
    if (ref.current) ref.current.value = '';
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) { e.preventDefault(); handle(files); }
  };

  const submitText = () => {
    const t = text.trim();
    if (!t) return;
    onFiles([{ id: newId(), name: 'Pasted text', size: t.length, kind: 'text', input: { type: 'text', content: t } }]);
    setText('');
  };

  return (
    <div className={cx('space-y-3', className)} onPaste={onPaste}>
      {allowText && (
        <div className="flex items-center justify-between gap-2">
          {title ? <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p> : <span />}
          <Segmented value={mode} onChange={setMode} options={[{ id: 'upload', label: 'Upload' }, { id: 'paste', label: 'Paste text' }]} />
        </div>
      )}
      {mode === 'upload' || !allowText ? (
        <div
          role="button"
          tabIndex={0}
          onClick={() => ref.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
          className={cx(
            'group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center outline-none transition focus-visible:ring-2 focus-visible:ring-brand-400',
            compact ? 'px-4 py-6' : 'px-6 py-10',
            over ? 'border-slate-200 bg-slate-100 dark:bg-white/[0.06]' : 'border-slate-200 bg-paper-50/60 hover:border-brand-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-brand-500/40',
          )}
        >
          {busy > 0 ? <Loader2 className="mb-2 animate-spin text-brand-500 dark:text-brand-300" size={compact ? 22 : 28} /> : <UploadCloud className="mb-2 text-slate-400 transition group-hover:text-brand-500" size={compact ? 22 : 28} />}
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {busy > 0 ? `Reading ${busy} file${busy === 1 ? '' : 's'}…` : multiple ? 'Drop files here or click to browse' : 'Drop a file here or click to browse'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint ?? 'Photos/scans (auto-compressed), PDF ≤ 8 MB, Word .docx, .txt — or paste an image'}</p>
          {!allowText && title && <p className="mt-2 text-xs font-semibold text-brand-600 dark:text-brand-300">{title}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea rows={compact ? 6 : 10} value={text} onChange={(e) => setText(e.target.value)} placeholder={textPlaceholder ?? 'Paste text here…'} className="font-serif text-base leading-relaxed" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" icon={<ClipboardPaste size={14} />} onClick={async () => {
              try { setText(await navigator.clipboard.readText()); } catch { toast('Clipboard access was blocked — paste with Ctrl/⌘+V instead.', 'info'); }
            }}>From clipboard</Button>
            <Button size="sm" onClick={submitText} disabled={!text.trim()}>{textButton}</Button>
          </div>
        </div>
      )}
      <input ref={ref} type="file" className="hidden" multiple={multiple} accept=".txt,.md,.pdf,.docx,.doc,image/*" onChange={(e) => e.target.files && handle(e.target.files)} />
    </div>
  );
};

/** Small chip showing a selected file with remove button. */
export const FileChip: React.FC<{ file: DroppedFile; onRemove?: () => void }> = ({ file, onRemove }) => (
  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
    <div className="rounded-lg bg-slate-100 p-1.5 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">{kindIcon(file.kind, 16)}</div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{file.name}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{file.kind} · {file.input.type === 'text' ? `${file.input.content.split(/\s+/).length} words` : fmtSize(file.size)}</p>
    </div>
    {onRemove && <button onClick={onRemove} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-white/10" aria-label="Remove"><X size={15} /></button>}
  </div>
);

export default FileDrop;
