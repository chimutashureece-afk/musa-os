// "Watch how it works" — a short animated walkthrough of the app. Each scene is
// a pure function of its clock, so it can play, pause and scrub cleanly.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { cx } from '../lib/utils';

const W = 760, H = 440, SIDE = 150;
type Pt = { t: number; x: number; y: number };

const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const typed = (s: string, t: number, start: number, cps = 16) => s.slice(0, clamp(Math.floor(((t - start) / 1000) * cps), 0, s.length));
const on = (t: number, a: number, b = Infinity) => t >= a && t < b;

function cursorAt(t: number, pts: Pt[]) {
  if (t <= pts[0]!.t) return pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    if (t <= b.t) { const k = ease((t - a.t) / (b.t - a.t || 1)); return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }
  }
  return pts[pts.length - 1]!;
}

// ------------------------------------------------------------ primitives --
const Cursor: React.FC<{ t: number; pts: Pt[]; clicks: number[] }> = ({ t, pts, clicks }) => {
  const p = cursorAt(t, pts);
  const clicking = clicks.some((c) => t >= c && t < c + 260);
  const ripple = clicks.find((c) => t >= c && t < c + 600);
  return (
    <div className="pointer-events-none absolute z-30" style={{ left: p.x, top: p.y }}>
      {ripple !== undefined && <span className="absolute -left-4 -top-4 h-8 w-8 rounded-full bg-marigold-400/40" style={{ transform: `scale(${0.4 + ((t - ripple) / 600) * 1.4})`, opacity: 1 - (t - ripple) / 600 }} />}
      <svg width="20" height="22" viewBox="0 0 20 22" className="drop-shadow-[0_2px_3px_rgba(0,0,0,.35)] transition-transform duration-100" style={{ transform: clicking ? 'scale(.86)' : 'none' }}>
        <path d="M2 1.5 L2 17 L6.2 13.2 L9 20 L12 18.8 L9.3 12.2 L15 12.2 Z" fill="#fff" stroke="#0b1512" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

const Btn: React.FC<{ children: React.ReactNode; hot?: boolean; className?: string }> = ({ children, hot, className }) => (
  <span className={cx('inline-flex h-8 items-center rounded-lg bg-brand-800 px-3 text-[12px] font-semibold text-white transition dark:bg-brand-600', hot && 'scale-95 brightness-110', className)}>{children}</span>
);
const Fld: React.FC<{ label: string; value: string; caret?: boolean; w?: number }> = ({ label, value, caret, w }) => (
  <div style={{ width: w }}>
    <p className="mb-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    <div className={cx('flex h-8 items-center rounded-lg border bg-white px-2.5 text-[12px] text-slate-900 dark:bg-white/[0.04] dark:text-white', caret ? 'border-brand-500 ring-[3px] ring-brand-500/15' : 'border-slate-200 dark:border-white/10')}>
      {value}{caret && <span className="ml-px inline-block h-3.5 w-px animate-pulse bg-slate-900 dark:bg-white" />}
    </div>
  </div>
);
const Sheet: React.FC<{ show: boolean; title: string; children: React.ReactNode; top?: number }> = ({ show, title, children, top = 70 }) => (
  <div className={cx('absolute inset-0 z-20 transition-opacity duration-300', show ? 'opacity-100' : 'pointer-events-none opacity-0')}>
    <div className="absolute inset-0 bg-slate-950/25" />
    <div className={cx('absolute left-1/2 w-[340px] -translate-x-1/2 rounded-xl bg-white shadow-2xl transition-all duration-300 dark:bg-ink-700 dark:ring-1 dark:ring-white/10', show ? 'translate-y-0' : 'translate-y-4')} style={{ top }}>
      <p className="border-b border-slate-100 px-4 py-2.5 text-[13px] font-bold text-slate-900 dark:border-white/[0.07] dark:text-white">{title}</p>
      <div className="p-4">{children}</div>
    </div>
  </div>
);
const Toast: React.FC<{ show: boolean; children: React.ReactNode }> = ({ show, children }) => (
  <div className={cx('absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-lg bg-slate-900 px-3.5 py-2 text-[12px] font-medium text-white shadow-lg transition-all duration-300 dark:bg-white dark:text-slate-900', show ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0')}>{children}</div>
);
const Head: React.FC<{ title: string; sub: string; action?: React.ReactNode }> = ({ title, sub, action }) => (
  <div className="flex items-start justify-between">
    <div><p className="font-display text-[18px] font-bold tracking-tight text-slate-900 dark:text-white">{title}</p><p className="text-[11.5px] text-slate-500 dark:text-slate-400">{sub}</p></div>
    {action}
  </div>
);
const rowIn = (t: number, at: number) => ({ opacity: clamp((t - at) / 300), transform: `translateY(${(1 - clamp((t - at) / 300)) * 8}px)` });

// ---------------------------------------------------------------- scenes --
interface Scene { nav: string; title: string; caption: string; dur: number; pts: Pt[]; clicks: number[]; render: (t: number) => React.ReactNode }
const X0 = SIDE;

const SCENES: Scene[] = [
  {
    nav: 'Classes', title: 'Create a class', caption: 'Pick a level and stream — the class name fills itself in.', dur: 6200,
    pts: [{ t: 0, x: 420, y: 330 }, { t: 900, x: 680, y: 40 }, { t: 1500, x: 680, y: 40 }, { t: 2000, x: 540, y: 162 }, { t: 2900, x: 540, y: 162 }, { t: 3400, x: 556, y: 274 }, { t: 6200, x: 556, y: 274 }],
    clicks: [1000, 2050, 3500],
    render: (t) => (
      <>
        <Head title="Classes & subjects" sub={t > 3700 ? '1 class · 17 subjects' : '0 classes · 17 subjects'} action={<Btn hot={on(t, 1000, 1260)}>+ New class</Btn>} />
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.08]">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] bg-slate-50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-white/[0.03] dark:text-slate-400"><span>Class</span><span>Level</span><span>Teacher</span><span>Learners</span></div>
          {t > 3700 ? (
            <div style={rowIn(t, 3700)} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] border-t border-slate-100 px-4 py-3 text-[12.5px] dark:border-white/[0.06]"><b className="text-slate-900 dark:text-white">Form 1A</b><span>Form 1</span><span className="text-slate-400">—</span><span>0 / 40</span></div>
          ) : <p className="border-t border-slate-100 px-4 py-6 text-center text-[12px] text-slate-400 dark:border-white/[0.06]">No classes yet</p>}
        </div>
        <Sheet show={on(t, 1200, 3600)} title="New class">
          <div className="grid grid-cols-2 gap-3">
            <Fld label="Level" value={t > 1500 ? 'Form 1' : ''} />
            <Fld label="Stream" value={typed('A', t, 2100, 8)} caret={on(t, 2050, 2900)} />
            <div className="col-span-2"><Fld label="Class name" value={t > 2250 ? 'Form 1A' : 'Form 1'} /></div>
          </div>
          <div className="mt-4 flex justify-end gap-2"><span className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-[12px] dark:border-white/10">Cancel</span><Btn hot={on(t, 3500, 3700)}>Create class</Btn></div>
        </Sheet>
        <Toast show={on(t, 3800, 5800)}>Form 1A created</Toast>
      </>
    ),
  },
  {
    nav: 'Students', title: 'Enrol a learner', caption: 'Type a name, choose the class, save. The admission number is issued for you.', dur: 7000,
    pts: [{ t: 0, x: 500, y: 330 }, { t: 900, x: 670, y: 40 }, { t: 1500, x: 670, y: 40 }, { t: 1800, x: 380, y: 162 }, { t: 2900, x: 380, y: 162 }, { t: 3100, x: 540, y: 162 }, { t: 4200, x: 540, y: 162 }, { t: 4700, x: 580, y: 274 }, { t: 7000, x: 580, y: 274 }],
    clicks: [1000, 1850, 3150, 4800],
    render: (t) => (
      <>
        <Head title="Student register" sub={t > 5000 ? '1 active learner across 1 class' : '0 active learners across 1 class'} action={<Btn hot={on(t, 1000, 1260)}>+ Enrol student</Btn>} />
        <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.08]">
          <div className="grid grid-cols-[1.6fr_1fr_1fr] bg-slate-50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-white/[0.03] dark:text-slate-400"><span>Learner</span><span>Adm. no.</span><span>Class</span></div>
          {t > 5000 ? (
            <div style={rowIn(t, 5000)} className="grid grid-cols-[1.6fr_1fr_1fr] items-center border-t border-slate-100 px-4 py-3 text-[12.5px] dark:border-white/[0.06]">
              <span className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600 dark:bg-white/10 dark:text-slate-200">TM</span><b className="text-slate-900 dark:text-white">Tariro Moyo</b></span>
              <span className="font-mono text-[11.5px]">2026/0001</span><span>Form 1A</span>
            </div>
          ) : <p className="border-t border-slate-100 px-4 py-6 text-center text-[12px] text-slate-400 dark:border-white/[0.06]">No learners yet</p>}
        </div>
        <Sheet show={on(t, 1200, 4900)} title="Enrol student">
          <div className="grid grid-cols-2 gap-3">
            <Fld label="First name" value={typed('Tariro', t, 1950)} caret={on(t, 1850, 3100)} />
            <Fld label="Surname" value={typed('Moyo', t, 3250)} caret={on(t, 3150, 4200)} />
            <Fld label="Class" value="Form 1A" /><Fld label="Gender" value="F" />
          </div>
          <div className="mt-4 flex justify-end"><Btn hot={on(t, 4800, 5000)}>Save</Btn></div>
        </Sheet>
        <Toast show={on(t, 5100, 6800)}>Tariro Moyo enrolled · 2026/0001</Toast>
      </>
    ),
  },
  {
    nav: 'Attendance', title: 'Take the register', caption: 'Everyone starts present. Tap to mark absent or late, then save.', dur: 6200,
    pts: [{ t: 0, x: 420, y: 350 }, { t: 900, x: 686, y: 198 }, { t: 1500, x: 686, y: 198 }, { t: 2100, x: 686, y: 289 }, { t: 2900, x: 686, y: 289 }, { t: 3500, x: 676, y: 40 }, { t: 6200, x: 676, y: 40 }],
    clicks: [1000, 1700, 2200, 3600],
    render: (t) => {
      const names = ['Chipo Banda', 'Farai Dube', 'Kudzai Ncube', 'Tariro Moyo', 'Tinashe Zhou'];
      const m = names.map((_, i) => (i === 2 ? (t > 1700 ? 'L' : t > 1000 ? 'A' : 'P') : i === 4 ? (t > 2200 ? 'A' : 'P') : 'P'));
      const chip = (v: string) => v === 'P' ? 'bg-brand-50 text-brand-800 border-brand-200 dark:bg-brand-400/10 dark:text-brand-200 dark:border-brand-400/25' : v === 'A' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-400/10 dark:text-rose-200 dark:border-rose-400/25' : 'bg-marigold-50 text-marigold-800 border-marigold-200 dark:bg-marigold-400/10 dark:text-marigold-200 dark:border-marigold-400/25';
      return (
        <>
          <Head title="Form 1A · Register" sub="Thursday 24 September" action={<Btn hot={on(t, 3600, 3800)}>Save register</Btn>} />
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.08]">
            {names.map((n, i) => (
              <div key={n} className="flex items-center justify-between border-t border-slate-100 px-4 py-[9px] text-[12.5px] first:border-t-0 dark:border-white/[0.06]">
                <span className="text-slate-800 dark:text-slate-200">{n}</span>
                <span className={cx('w-16 rounded-md border py-1 text-center text-[11px] font-bold transition-all duration-200', chip(m[i]!), (i === 2 && on(t, 1000, 1200)) || (i === 2 && on(t, 1700, 1900)) || (i === 4 && on(t, 2200, 2400)) ? 'scale-90' : '')}>
                  {m[i] === 'P' ? 'Present' : m[i] === 'A' ? 'Absent' : 'Late'}
                </span>
              </div>
            ))}
          </div>
          <Toast show={on(t, 3800, 6000)}>Saved · 3 present, 1 late, 1 absent</Toast>
        </>
      );
    },
  },
  {
    nav: 'Gradebook', title: 'Enter marks', caption: 'Type the scores — ZIMSEC grades and the class average appear as you go.', dur: 6400,
    pts: [{ t: 0, x: 400, y: 340 }, { t: 700, x: 592, y: 140 }, { t: 1500, x: 592, y: 140 }, { t: 1700, x: 592, y: 183 }, { t: 2400, x: 592, y: 183 }, { t: 2600, x: 592, y: 226 }, { t: 3300, x: 592, y: 226 }, { t: 3500, x: 592, y: 269 }, { t: 6400, x: 592, y: 269 }],
    clicks: [800, 1700, 2600, 3500],
    render: (t) => {
      const rows: [string, string, number][] = [['Chipo Banda', '41', 800], ['Farai Dube', '29', 1700], ['Kudzai Ncube', '35', 2600], ['Tariro Moyo', '44', 3500]];
      const grade = (m: number) => (m >= 37.5 ? 'A' : m >= 32.5 ? 'B' : m >= 25 ? 'C' : 'D');
      const filled = rows.filter(([, v, s]) => t > s + 150 * v.length + 250);
      const avg = filled.length ? filled.reduce((a, [, v]) => a + Number(v), 0) / filled.length : 0;
      return (
        <>
          <Head title="Gradebook" sub="Form 1A · English Language · Term 3" action={<span className="rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-700 dark:border-white/10 dark:text-slate-200">Test 1 · out of 50</span>} />
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-white/[0.08]">
            <div className="grid grid-cols-[1.6fr_90px_70px] bg-slate-50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-white/[0.03] dark:text-slate-400"><span>Learner</span><span>Mark</span><span>Grade</span></div>
            {rows.map(([n, v, s]) => {
              const shown = typed(v, t, s + 150, 7);
              const done = t > s + 150 * v.length + 250;
              return (
                <div key={n} className="grid grid-cols-[1.6fr_90px_70px] items-center border-t border-slate-100 px-4 py-[7px] text-[12.5px] dark:border-white/[0.06]">
                  <span className="text-slate-800 dark:text-slate-200">{n}</span>
                  <span className={cx('flex h-7 w-16 items-center rounded-md border px-2 font-semibold tabular-nums', on(t, s, s + 900) ? 'border-brand-500 ring-[3px] ring-brand-500/15' : 'border-slate-200 dark:border-white/10')}>{shown}</span>
                  <span>{done && <span className="inline-flex h-6 w-6 animate-pop items-center justify-center rounded-full border border-slate-300 text-[11px] font-bold text-slate-800 dark:border-white/20 dark:text-white">{grade(Number(v))}</span>}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-right text-[12px] text-slate-500 dark:text-slate-400">Class average <b className="tabular-nums text-slate-900 dark:text-white">{avg ? `${avg.toFixed(1)} / 50` : '—'}</b></p>
        </>
      );
    },
  },
  {
    nav: 'Fees', title: 'Record a payment', caption: 'Cash, EcoCash or bank — the receipt is numbered and the balance updates.', dur: 6800,
    pts: [{ t: 0, x: 420, y: 340 }, { t: 800, x: 666, y: 40 }, { t: 1400, x: 666, y: 40 }, { t: 1700, x: 375, y: 208 }, { t: 2700, x: 375, y: 208 }, { t: 3100, x: 522, y: 208 }, { t: 3600, x: 522, y: 208 }, { t: 4000, x: 566, y: 266 }, { t: 6800, x: 566, y: 266 }],
    clicks: [900, 1750, 3150, 4100],
    render: (t) => (
      <>
        <Head title="Fees & finance" sub="Term 3 · all amounts in USD" action={<Btn hot={on(t, 900, 1150)}>Record payment</Btn>} />
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[['Billed', '$150.00'], ['Collected', t > 4300 ? '$150.00' : '$0.00'], ['Outstanding', t > 4300 ? '$0.00' : '$150.00']].map(([k, v]) => (
            <div key={k} className="rounded-xl border border-slate-200 p-3 dark:border-white/[0.08]"><p className="text-[10.5px] text-slate-500 dark:text-slate-400">{k}</p><p className="mt-0.5 font-display text-[18px] font-bold tabular-nums text-slate-900 dark:text-white">{v}</p></div>
          ))}
        </div>
        <Sheet show={on(t, 1100, 4200)} title="Record payment" top={60}>
          <div className="grid grid-cols-[1fr_1.25fr] gap-3">
            <div className="col-span-2"><Fld label="Learner" value="Tariro Moyo · Form 1A" /></div>
            <Fld label="Amount (USD)" value={typed('150.00', t, 1850, 10)} caret={on(t, 1750, 2700)} />
            <div><p className="mb-1 text-[10.5px] font-medium text-slate-500 dark:text-slate-400">Method</p>
              <div className="flex gap-1">{['Cash', 'EcoCash', 'Bank'].map((m) => <span key={m} className={cx('rounded-md border px-1.5 py-1.5 text-[11px] font-semibold transition', m === 'EcoCash' && t > 3150 ? 'border-brand-600 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-400/10 dark:text-brand-200' : m === 'Cash' && t <= 3150 ? 'border-slate-400 text-slate-800 dark:text-white' : 'border-slate-200 text-slate-500 dark:border-white/10')}>{m}</span>)}</div></div>
          </div>
          <div className="mt-4 flex justify-end"><Btn hot={on(t, 4100, 4300)}>Save payment</Btn></div>
        </Sheet>
        {t > 4300 && (
          <div style={rowIn(t, 4300)} className="paper relative mx-auto mt-5 w-[300px] rounded-md bg-[#fdfcf7] p-4 font-serif text-[12px] text-[#1f2a26] shadow-md">
            <div className="flex justify-between"><b>Receipt</b><span className="font-mono text-[11px] text-[#c0262d]">No. 0001</span></div>
            <p className="mt-2">Tariro Moyo · Term 3 tuition</p><p>EcoCash · <b className="font-mono">$150.00</b></p>
            <span className="absolute right-4 top-6 rotate-[-12deg] rounded border-2 border-[#1f7a45] px-2 py-0.5 font-display text-[13px] font-extrabold uppercase tracking-wider text-[#1f7a45]" style={{ opacity: clamp((t - 4600) / 200), transform: `rotate(-12deg) scale(${1 + (1 - clamp((t - 4600) / 250)) * 1.6})` }}>Paid</span>
          </div>
        )}
      </>
    ),
  },
  {
    nav: 'Reports', title: 'Publish report cards', caption: 'One press and parents see results on their phones.', dur: 6400,
    pts: [{ t: 0, x: 400, y: 330 }, { t: 900, x: 680, y: 40 }, { t: 6400, x: 680, y: 40 }],
    clicks: [1100],
    render: (t) => (
      <>
        <Head title="Report cards" sub="Form 1A · Term 3" action={<Btn hot={on(t, 1100, 1350)}>{t > 1300 ? 'Published ✓' : 'Publish'}</Btn>} />
        <div className="paper mt-4 w-[330px] rounded-md bg-[#fdfcf7] p-4 font-serif text-[11.5px] text-[#1f2a26] shadow-sm ring-1 ring-black/5">
          <p className="border-b border-double border-slate-600 pb-1 text-center text-[12px] font-bold uppercase tracking-[0.12em]">Term 3 report</p>
          <p className="mt-2"><b>Tariro Moyo</b> · Form 1A · Position 1st of 4</p>
          {[['English Language', 88, 'A'], ['Mathematics', 74, 'B'], ['Combined Science', 69, 'B']].map(([s, m, g]) => (
            <div key={s as string} className="mt-1.5 grid grid-cols-[1fr_28px_16px] gap-2"><span>{s}</span><span className="text-right tabular-nums">{m}</span><b>{g}</b></div>
          ))}
        </div>
        <div className="absolute bottom-4 right-6 z-20 w-[210px] rounded-[26px] border-[6px] border-slate-900 bg-slate-100 p-2 shadow-2xl transition-all duration-500 dark:border-black dark:bg-ink-900"
          style={{ transform: `translateY(${(1 - clamp((t - 1600) / 500)) * 240}px)` }}>
          <div className="rounded-2xl bg-white p-2.5 text-[11px] shadow dark:bg-ink-700" style={{ opacity: clamp((t - 2200) / 300) }}>
            <p className="font-semibold text-slate-900 dark:text-white">Musa OS · now</p>
            <p className="mt-0.5 text-slate-600 dark:text-slate-300">Tariro’s Term 3 report card is ready to view.</p>
          </div>
          <div className="mt-2 h-24 rounded-2xl bg-white/60 dark:bg-white/[0.04]" />
        </div>
      </>
    ),
  },
];

// ---------------------------------------------------------------- player --
const NAV = ['Dashboard', 'Classes', 'Students', 'Attendance', 'Gradebook', 'Reports', 'Fees'];

export const Walkthrough: React.FC<{ open: boolean; onClose: () => void; onTry: () => void }> = ({ open, onClose, onTry }) => {
  const [i, setI] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const scene = SCENES[i]!;

  // fit the fixed-size stage to the available width
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e!.contentRect.width / W)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => { if (open) { setI(0); setT(0); setPlaying(true); setEnded(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key === 'ArrowRight') jump(i + 1);
      if (e.key === 'ArrowLeft') jump(i - 1);
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  });

  useEffect(() => {
    if (!open || !playing) return;
    let raf = 0; let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last; last = now;
      setT((x) => {
        const n = x + dt;
        if (n < scene.dur) return n;
        if (i < SCENES.length - 1) { setI(i + 1); return 0; }
        setPlaying(false); setEnded(true); return scene.dur;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open, playing, i, scene.dur]);

  const jump = (n: number) => { const k = Math.max(0, Math.min(SCENES.length - 1, n)); setI(k); setT(0); setEnded(false); setPlaying(true); };
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm animate-fade-in sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[860px] animate-slide-up overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-ink-800 dark:ring-1 dark:ring-white/10" role="dialog" aria-label="How Musa OS works">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-white/[0.07]">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">How Musa OS works <span className="font-normal text-slate-400">· {Math.round(SCENES.reduce((a, s) => a + s.dur, 0) / 1000)} seconds</span></p>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10"><X size={18} /></button>
        </div>

        <div className="bg-slate-100 p-3 sm:p-5 dark:bg-ink-950">
          <div ref={box} className="mx-auto w-full" style={{ height: H * scale, maxWidth: W }}>
            <div className="relative origin-top-left overflow-hidden rounded-xl border border-slate-200 bg-paper-50 shadow-sm dark:border-white/[0.08] dark:bg-ink-900" style={{ width: W, height: H, transform: `scale(${scale})` }}>
              {/* app chrome */}
              <div className="absolute inset-y-0 left-0 bg-brand-950 px-3 py-4 dark:bg-ink-950" style={{ width: SIDE }}>
                <p className="mb-4 px-2 font-display text-[13px] font-bold text-white">Musa<span className="text-brand-400">OS</span></p>
                {NAV.map((n) => <p key={n} className={cx('mb-0.5 rounded-md px-2 py-1.5 text-[11.5px] transition', n === scene.nav ? 'bg-white/[0.12] font-semibold text-white' : 'text-white/55')}>{n}</p>)}
              </div>
              <div key={i} className="absolute inset-y-0 right-0 animate-screen-in p-6" style={{ left: X0 }}>{scene.render(t)}</div>
              <Cursor t={t} pts={scene.pts} clicks={scene.clicks} />
              {ended && (
                <div className="absolute inset-0 z-40 flex animate-fade-in flex-col items-center justify-center bg-white/85 text-center backdrop-blur-sm dark:bg-ink-900/85">
                  <p className="font-display text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">Now try it yourself.</p>
                  <p className="mt-1 max-w-sm text-[14px] text-slate-500 dark:text-slate-400">Open an empty demo school and a guide will walk you through the same steps.</p>
                  <div className="mt-5 flex gap-2">
                    <button onClick={onTry} className="rounded-lg bg-brand-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-900 dark:bg-brand-600">Try the demo</button>
                    <button onClick={() => jump(0)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"><RotateCcw size={15} /> Watch again</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4">
          <div key={i} className="animate-slide-up">
            <p className="font-display text-[17px] font-semibold tracking-tight text-slate-900 dark:text-white"><span className="mr-2 text-slate-400">{i + 1}.</span>{scene.title}</p>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{scene.caption}</p>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={() => jump(i - 1)} aria-label="Previous" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"><ChevronLeft size={18} /></button>
            <button onClick={() => (ended ? jump(0) : setPlaying(!playing))} aria-label={playing ? 'Pause' : 'Play'} className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-800 text-white hover:bg-brand-900 dark:bg-brand-600">{playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}</button>
            <button onClick={() => jump(i + 1)} aria-label="Next" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"><ChevronRight size={18} /></button>
            <div className="flex flex-1 gap-1.5">
              {SCENES.map((s, k) => (
                <button key={s.title} onClick={() => jump(k)} aria-label={s.title} className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <span className="block h-full rounded-full bg-brand-600 dark:bg-brand-400" style={{ width: `${k < i ? 100 : k === i ? (t / s.dur) * 100 : 0}%` }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
