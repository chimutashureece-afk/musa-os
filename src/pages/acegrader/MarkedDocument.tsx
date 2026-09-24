import React, { useMemo, useRef, useState } from 'react';
import {FileWarning, PenTool} from 'lucide-react';
import { cx } from '../../lib/utils';
import { ANN_STYLE, segmentText } from '../../lib/acegrader/helpers';
import type { Annotation, GradingResult } from '../../types';

const TYPES: Annotation['type'][] = ['praise', 'error', 'grammar', 'warning'];

/**
 * The "marked script": transcribed/original text on ruled paper with inline highlights.
 * Hover shows a handwritten margin note; click pins it in the margin ledger.
 */
export const MarkedDocument: React.FC<{ result: GradingResult; text?: string; studentName: string; subtitle?: string; fileName?: string; stamp?: React.ReactNode }> = ({ result, text, studentName, subtitle, fileName, stamp }) => {
  const body = (result.fullTranscribedText || text || '').trim();
  const [hidden, setHidden] = useState<Set<Annotation['type']>>(new Set());
  const [active, setActive] = useState<number | null>(null);
  const noteRefs = useRef<(HTMLLIElement | null)[]>([]);
  const markRefs = useRef<(HTMLElement | null)[]>([]);

  const anns = result.annotations ?? [];
  const { segments, placed } = useMemo(() => segmentText(body, anns), [body, anns]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    anns.forEach((a) => (c[a.type] = (c[a.type] ?? 0) + 1));
    return c;
  }, [anns]);
  // number annotations in document order
  const order = useMemo(() => {
    const o = new Map<number, number>();
    let n = 1;
    segments.forEach((s) => s.ann != null && !o.has(s.ann) && o.set(s.ann, n++));
    anns.forEach((_, i) => !o.has(i) && o.set(i, n++));
    return o;
  }, [segments, anns]);
  const ledger = useMemo(() => anns.map((a, i) => ({ a, i })).filter(({ a }) => !hidden.has(a.type)).sort((x, y) => order.get(x.i)! - order.get(y.i)!), [anns, hidden, order]);

  const pick = (i: number, from: 'text' | 'note') => {
    setActive((cur) => (cur === i ? null : i));
    const el = from === 'text' ? noteRefs.current[i] : markRefs.current[i];
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const toggle = (t: Annotation['type']) => setHidden((h) => { const n = new Set(h); n.has(t) ? n.delete(t) : n.add(t); return n; });

  return (
    <div className="card overflow-hidden">
      {/* legend */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-white/[0.06]">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Marked script</span>
        {TYPES.map((t) => (
          <button key={t} onClick={() => toggle(t)} className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition', hidden.has(t) ? 'border-slate-200 text-slate-400 line-through dark:border-white/10' : 'border-transparent bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200')}>
            <span className={cx('h-2 w-2 rounded-full', ANN_STYLE[t].dot)} />{ANN_STYLE[t].label}<span className="opacity-50">{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="grid xl:grid-cols-[1fr_260px]">
        {/* paper */}
        <div className="relative bg-paper-50 px-5 py-8 sm:px-10 dark:bg-[#12141b]">
          <div className="absolute inset-y-0 left-3 w-px bg-rose-300/50 sm:left-7 dark:bg-rose-400/30" />
          {stamp && <div className="absolute right-4 top-4 z-10 sm:right-8 sm:top-6">{stamp}</div>}
          <div className="mb-6 border-b-2 border-slate-900 pb-4 pr-32 dark:border-white/30">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Learner</p>
            <p className="font-display tracking-tight text-2xl font-bold text-slate-900 dark:text-white">{studentName}</p>
            {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {body ? (
            <article
              className="relative whitespace-pre-wrap font-serif text-[1.08rem] leading-[2.1rem] text-slate-800 dark:text-slate-200"
              style={{ backgroundImage: 'linear-gradient(to bottom, transparent calc(2.1rem - 1px), rgba(100,116,139,.13) calc(2.1rem - 1px))', backgroundSize: '100% 2.1rem' }}
            >
              {segments.map((s, k) => {
                if (s.ann == null) return <React.Fragment key={k}>{s.text}</React.Fragment>;
                const a = anns[s.ann]!;
                const idx = s.ann;
                if (hidden.has(a.type)) return <React.Fragment key={k}>{s.text}</React.Fragment>;
                const st = ANN_STYLE[a.type];
                return (
                  <span key={k} className="group relative">
                    <mark
                      ref={(el) => { markRefs.current[idx] = el; }}
                      onClick={() => pick(idx, 'text')}
                      className={cx('cursor-pointer rounded-sm px-0.5 text-inherit underline decoration-2 underline-offset-4 transition', a.type === 'grammar' || a.type === 'error' ? 'decoration-wavy' : '', st.mark, active === idx && `ring-2 ${st.ring}`)}
                    >{s.text}</mark>
                    <sup className={cx('ml-0.5 select-none font-hand text-xs font-bold', st.text)}>{order.get(idx)}</sup>
                    <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden w-64 rounded-xl border border-slate-200 bg-white p-3 text-left font-hand text-base leading-snug shadow-xl group-hover:block dark:border-white/10 dark:bg-ink-700">
                      {a.correction && <span className={cx('block font-bold', st.text)}>→ {a.correction}</span>}
                      <span className="block text-slate-700 dark:text-slate-200">{a.comment}</span>
                    </span>
                  </span>
                );
              })}
            </article>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><FileWarning size={16} className="text-marigold-500 dark:text-marigold-300" /> Original script not stored</div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {fileName ? `“${fileName}” was marked from an uploaded file` : 'This script was marked from an uploaded file'}{result.simulated ? ' in quick-marking mode, so no transcription is available.' : ' and no transcription was returned.'} The summary and annotations below are what the marker recorded.
              </p>
              {result.summary && <p className="mt-4 font-hand text-lg leading-relaxed text-slate-800 dark:text-slate-100">{result.summary}</p>}
            </div>
          )}
          {result.feedback && (
            <div className="mt-10 border-t border-slate-200 pt-6 dark:border-white/10">
              <p className="mb-2 flex items-center gap-2 font-hand text-2xl font-bold text-rose-700 dark:text-rose-300"><PenTool size={18} /> Teacher's comment</p>
              <p className="font-hand text-xl leading-relaxed text-slate-800 dark:text-slate-100">“{result.feedback}”</p>
            </div>
          )}
        </div>

        {/* margin ledger */}
        <aside className="border-t border-rose-100 bg-[#fffdf5] p-4 xl:max-h-[900px] xl:overflow-y-auto xl:border-l xl:border-t-0 dark:border-white/[0.06] dark:bg-[#15161c]">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400 dark:text-slate-400">Margin notes</p>
          {!ledger.length ? <p className="font-hand text-lg text-slate-400">No notes.</p> : (
            <ol className="space-y-3">
              {ledger.map(({ a, i }) => {
                const st = ANN_STYLE[a.type];
                return (
                  <li key={i} ref={(el) => { noteRefs.current[i] = el; }} onClick={() => placed.has(i) && pick(i, 'note')}
                    className={cx('rounded-xl border-l-4 bg-white/70 p-3 shadow-sm transition dark:bg-white/[0.03]', placed.has(i) && 'cursor-pointer hover:bg-white dark:hover:bg-white/[0.06]', active === i && `ring-2 ${st.ring}`,
                      { praise: 'border-brand-500', error: 'border-rose-500', grammar: 'border-marigold-500', warning: 'border-sky-500' }[a.type])}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className={cx('font-hand text-base font-bold', st.text)}>{order.get(i)}.</span>
                      <span className={cx('text-[10px] font-bold uppercase tracking-wider', st.text)}>{st.label}</span>
                      {!placed.has(i) && <span className="text-[10px] text-slate-400">(not found in text)</span>}
                    </div>
                    <p className="truncate text-[11px] text-slate-400">“{a.originalText}”</p>
                    {a.correction && <p className={cx('font-hand text-base font-bold', st.text)}>→ {a.correction}</p>}
                    <p className="font-hand text-[15px] leading-snug text-slate-700 dark:text-slate-200">{a.comment}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
};

export default MarkedDocument;
