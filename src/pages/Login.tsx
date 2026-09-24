import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ShieldCheck, BookOpenCheck, Wallet, Users, UserRound, ArrowRight, Moon, Sun,
  ClipboardCheck, CalendarClock, PlayCircle, FileText, Receipt, Megaphone, Library, PenLine, UserPlus, Check,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '../components/ui';
import { useTheme } from '../components/Layout';
import { Walkthrough } from '../components/Walkthrough';
import { useAuth } from '../context/AuthContext';
import { SCHOOL_TYPES } from '../lib/defaults';
import { Section } from '../types';
import { restartTour } from '../components/Tour';
import { MusaLogo, MusaMark } from '../components/Logo';
import { Role } from '../types';
import { cx } from '../lib/utils';

const ROLES: { role: Role; title: string; icon: any; points: string[] }[] = [
  { role: 'admin', title: 'Head / Administrator', icon: ShieldCheck, points: ['Whole-school dashboard', 'Publish report cards', 'Users, terms & grading'] },
  { role: 'teacher', title: 'Teacher', icon: BookOpenCheck, points: ['Registers & gradebook', 'AceGrader script marking', 'Report remarks'] },
  { role: 'bursar', title: 'Bursar', icon: Wallet, points: ['Invoices for the whole school', 'Receipts & statements', 'Debtors list'] },
  { role: 'parent', title: 'Parent', icon: Users, points: ['Results & report cards', 'Attendance', 'Fee balance'] },
  { role: 'student', title: 'Student', icon: UserRound, points: ['Timetable', 'Published reports', 'School notices'] },
];

const MODULES: { icon: any; title: string; body: string }[] = [
  { icon: UserPlus, title: 'Admissions & records', body: 'Admission numbers, guardians, medical notes and full learner history.' },
  { icon: ClipboardCheck, title: 'Attendance registers', body: 'Mark a class in seconds and see who is missing too many days.' },
  { icon: CalendarClock, title: 'Timetables', body: 'Class and teacher views that stop a teacher being booked twice.' },
  { icon: BookOpenCheck, title: 'Gradebook', body: 'Tests, assignments and exams weighted into term marks and ZIMSEC grades.' },
  { icon: FileText, title: 'Report cards', body: 'Positions, grades, remarks and attendance on a proper A4 report.' },
  { icon: Receipt, title: 'Fees & billing', body: 'Bulk invoices, EcoCash, bank and cash receipts, statements in USD.' },
  { icon: Megaphone, title: 'Parent communication', body: 'Notices by class or audience, guardian contact lists, a shared calendar.' },
  { icon: Library, title: 'Library & conduct', body: 'Book loans and overdue lists, merits, demerits and a watchlist.' },
];

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Faint exercise-book ruling with a margin line — the page's background motif. */
const Ruled: React.FC = () => (
  <div aria-hidden="true" className="pointer-events-none absolute inset-0">
    <div className="absolute inset-0 [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,rgba(19,27,24,.06)_31px,rgba(19,27,24,.06)_32px)] dark:[background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,rgba(255,255,255,.035)_31px,rgba(255,255,255,.035)_32px)]" />
    <div className="absolute inset-y-0 left-[max(1rem,calc(50%-37rem))] w-px bg-rose-400/40 dark:bg-rose-400/30" />
    <div className="absolute inset-x-0 bottom-0 h-40 bg-[linear-gradient(to_bottom,transparent,var(--color-paper-50))] dark:bg-[linear-gradient(to_bottom,transparent,var(--color-ink-900))]" />
  </div>
);

// ---------------------------------------------------------------- motion --
const WORDS = [
  { word: 'register', view: 'register', nav: 'Attendance' },
  { word: 'gradebook', view: 'gradebook', nav: 'Gradebook' },
  { word: 'fee book', view: 'fees', nav: 'Fees' },
  { word: 'timetable', view: 'timetable', nav: 'Timetable' },
  { word: 'report card', view: 'report', nav: 'Report Cards' },
] as const;
type View = (typeof WORDS)[number]['view'];

const prefersReduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** Cycles an index on an interval; pauses while `paused`. */
function useCycle(n: number, ms: number) {
  // Always advances on its own. Picking a screen by hand restarts the countdown
  // so the chosen screen stays up for a full interval before the next turn.
  const [i, setI] = useState(0);
  const [kick, setKick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [n, ms, kick]);
  const pick = (v: number) => { setI(v); setKick((k) => k + 1); };
  return [i, pick] as const;
}

/** True once the element has scrolled into view (stays true). */
function useInView<T extends Element>(opts: IntersectionObserverInit = { threshold: 0.25 }) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setSeen(true); io.disconnect(); } }, opts);
    io.observe(el);
    return () => io.disconnect();
  }, [seen]); // eslint-disable-line react-hooks/exhaustive-deps
  return [ref, seen] as const;
}

/** Counts up to `to` once visible. */
const CountUp: React.FC<{ to: number; decimals?: number; prefix?: string; suffix?: string; run: boolean; ms?: number }> = ({ to, decimals = 0, prefix = '', suffix = '', run, ms = 1100 }) => {
  const [v, setV] = useState(run && prefersReduced() ? to : 0);
  useEffect(() => {
    if (!run) return;
    if (prefersReduced()) { setV(to); return; }
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms); setV(to * (1 - Math.pow(1 - p, 3))); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, to, ms]);
  return <>{prefix}{v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
};

/** Wrapper that eases children up into place when scrolled to. Starts visible (never hidden). */
const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number; as?: 'div' | 'li' }> = ({ children, className, delay = 0, as = 'div' }) => {
  const [ref, seen] = useInView<HTMLDivElement>({ threshold: 0.15 });
  const Tag = as as any;
  return <Tag ref={ref} style={{ transitionDelay: `${delay}ms` }} className={cx('transition-[transform,opacity] duration-700 ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none', seen ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-60', className)}>{children}</Tag>;
};

/** The headline's rotating word: slides the old word up and out, the new one up and in, and redraws the marigold underline. */
const RotatingWord: React.FC<{ index: number }> = ({ index }) => {
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [prev, setPrev] = useState<number | null>(null);
  const last = useRef(index);
  useLayoutEffect(() => {
    if (measure.current) setWidth(measure.current.offsetWidth);
    if (last.current !== index) { setPrev(last.current); last.current = index; const t = setTimeout(() => setPrev(null), 650); return () => clearTimeout(t); }
  }, [index]);
  useEffect(() => {
    const onResize = () => measure.current && setWidth(measure.current.offsetWidth);
    window.addEventListener('resize', onResize);
    document.fonts?.ready.then(onResize).catch(() => {});
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const word = WORDS[index]!.word;
  return (
    <span className="relative inline-block whitespace-nowrap align-bottom text-brand-700 transition-[width] duration-500 ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none dark:text-brand-300" style={{ width }}>
      <span ref={measure} aria-hidden="true" className="invisible absolute left-0 top-0 whitespace-nowrap">{word}</span>
      <span className="relative block overflow-hidden pb-[0.12em]" aria-live="polite">
        {prev !== null && <span key={`o${prev}-${index}`} aria-hidden="true" className="absolute left-0 top-0 animate-word-out whitespace-nowrap">{WORDS[prev]!.word}</span>}
        <span key={`i${index}`} className={cx('block whitespace-nowrap', prev !== null && 'animate-word-in')}>{word}</span>
      </span>
      <svg key={`u${index}`} className="absolute -bottom-1.5 left-0 h-3 w-full text-marigold-400" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true">
        <path d="M2 9 C 50 2, 120 2, 198 7" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" pathLength={1} className="animate-draw [stroke-dasharray:1] motion-reduce:animate-none" />
      </svg>
    </span>
  );
};

// ------------------------------------------------------ preview screens --
// Each screen is drawn as the paper document a school actually keeps — a register,
// a mark sheet, a receipt book, a timetable, a report — so turning between them
// feels like leafing through the school's books.

const INK = 'text-[#1d3a8a]'; // blue-black fountain-pen ink
const RED = 'text-[#c0262d]';

/** Exercise-book page: ruled lines, red margin, faint paper grain. */
const Paper: React.FC<{ children: React.ReactNode; className?: string; ruled?: boolean; squared?: boolean }> = ({ children, className, ruled = true, squared }) => (
  <div className={cx('paper relative h-full min-h-[300px] overflow-hidden bg-[#fdfcf7] text-[#1f2a26]', className)}>
    {ruled && !squared && <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_25px,#dfe6ee_25px,#dfe6ee_26px)] [background-position:0_58px]" />}
    {squared && <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:linear-gradient(#e7edf2_1px,transparent_1px),linear-gradient(90deg,#e7edf2_1px,transparent_1px)] [background-size:18px_18px]" />}
    {ruled && !squared && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-9 w-px bg-[#e8a3a3]" />}
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_100%_0%,rgba(0,0,0,.035),transparent_60%)]" />
    <div className="relative h-full">{children}</div>
  </div>
);

const Heading: React.FC<{ title: string; right?: React.ReactNode }> = ({ title, right }) => (
  <div className="flex items-end justify-between gap-3 pb-2 pl-12 pr-4 pt-4">
    <p className="font-serif text-[15px] font-bold leading-tight tracking-tight">{title}</p>
    {right && <p className="font-hand text-[13px] leading-none text-slate-500">{right}</p>}
  </div>
);

const MiniRegister: React.FC = () => {
  const rows: [string, 'P' | 'A' | 'L'][] = [['Chikwanha, Tanaka', 'P'], ['Chinyama, Chiedza', 'P'], ['Chirwa, Lwazi', 'L'], ['Dube, Anesu', 'P'], ['Hove, Brandon', 'A'], ['Makoni, Anesu', 'P']];
  const days = ['M', 'T', 'W'];
  return (
    <Paper>
      <Heading title="Form 3A · Attendance Register" right="Wed 23 Sept" />
      <div className="pl-12 pr-4">
        <div className="grid grid-cols-[1fr_repeat(3,26px)] items-end text-[9px] font-semibold uppercase tracking-wider text-slate-400"><span>Learner</span>{days.map((d) => <span key={d} className="text-center">{d}</span>)}</div>
        {rows.map(([n, m], i) => (
          <div key={n} className="grid h-[26px] grid-cols-[1fr_repeat(3,26px)] items-center font-serif text-[12px]">
            <span className="truncate">{n}</span>
            <span className={cx('text-center font-hand text-[15px] leading-none', INK)}>✓</span>
            <span className={cx('text-center font-hand text-[15px] leading-none', INK)}>{i === 4 ? '✓' : '✓'}</span>
            <span style={{ animationDelay: `${250 + i * 160}ms` }} className={cx('animate-ink text-center font-hand text-[16px] font-bold leading-none', m === 'A' ? RED : m === 'L' ? 'text-[#b26a00]' : INK)}>{m === 'P' ? '✓' : m === 'A' ? '✗' : 'L'}</span>
          </div>
        ))}
        <p style={{ animationDelay: '1300ms' }} className={cx('animate-ink mt-1 text-right font-hand text-[14px]', INK)}>20 present · 1 late · <span className={RED}>1 absent</span></p>
      </div>
    </Paper>
  );
};

const MiniGradebook: React.FC = () => {
  const rows: [string, number, string][] = [['Chikwanha, T.', 41, 'A'], ['Chinyama, C.', 23, 'D'], ['Dube, A.', 29, 'C'], ['Mutasa, M.', 35, 'B'], ['Tshuma, R.', 28, 'C'], ['Moyo, N.', 44, 'A']];
  return (
    <Paper>
      <Heading title="English Language · Mark Sheet" right="Test 1 — out of 50" />
      <div className="pl-12 pr-4">
        <div className="grid grid-cols-[1fr_48px_48px] items-end text-[9px] font-semibold uppercase tracking-wider text-slate-400"><span>Learner</span><span className="text-right">Mark</span><span className="text-right">Grade</span></div>
        {rows.map(([n, m, g], i) => (
          <div key={n} className="grid h-[26px] grid-cols-[1fr_48px_48px] items-center font-serif text-[12px]">
            <span>{n}</span>
            <span style={{ animationDelay: `${200 + i * 140}ms` }} className={cx('animate-ink text-right font-hand text-[16px] font-bold leading-none', RED)}>{m}</span>
            <span className="flex justify-end">
              <span style={{ animationDelay: `${450 + i * 140}ms` }} className={cx('animate-circle flex h-[20px] w-[20px] items-center justify-center rounded-full border-[1.5px] border-current font-hand text-[12px] font-bold leading-none', RED)}>{g}</span>
            </span>
          </div>
        ))}
        <p style={{ animationDelay: '1300ms' }} className={cx('animate-ink mt-1 text-right font-hand text-[14px]', RED)}>Class average 33.3 — good effort!</p>
      </div>
    </Paper>
  );
};

const MiniFees: React.FC = () => (
  <Paper ruled={false} className="bg-[#fbf8ef]">
    <div aria-hidden="true" className="absolute inset-x-0 top-0 h-3 [background-image:radial-gradient(circle_at_7px_0,transparent_5px,#fbf8ef_5.5px)] [background-size:14px_12px] bg-repeat-x" />
    <div className="px-6 pb-4 pt-6">
      <div className="flex items-start justify-between border-b border-dashed border-slate-300 pb-2">
        <div><p className="font-serif text-[15px] font-bold tracking-tight">Official Receipt</p><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Greenfield Academy · Bursary</p></div>
        <p className="font-mono text-[11px] text-[#c0262d]">No. 0412</p>
      </div>
      <div className="mt-3 grid grid-cols-[88px_1fr] gap-y-2.5 font-serif text-[12px]">
        <span className="text-slate-500">Received from</span><span className={cx('border-b border-dotted border-slate-300 font-hand text-[15px] leading-4', INK)}>Mrs R. Chikwanha</span>
        <span className="text-slate-500">For learner</span><span className={cx('border-b border-dotted border-slate-300 font-hand text-[15px] leading-4', INK)}>Tanaka · Form 3A</span>
        <span className="text-slate-500">Being</span><span className={cx('border-b border-dotted border-slate-300 font-hand text-[15px] leading-4', INK)}>Term 3 tuition</span>
        <span className="text-slate-500">Paid by</span><span className={cx('border-b border-dotted border-slate-300 font-hand text-[15px] leading-4', INK)}>EcoCash · MP482119</span>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="rounded-md border-2 border-slate-800 px-3 py-1 font-mono text-[18px] font-bold tabular-nums">$ <CountUp to={150} decimals={2} run ms={900} /></div>
        <div style={{ animationDelay: '700ms' }} className="animate-stamp rounded-md border-[3px] border-[#1f7a45] px-3 py-0.5 text-center font-display text-[18px] font-extrabold uppercase tracking-[0.12em] text-[#1f7a45] opacity-90">Paid<p className="-mt-0.5 text-[8px] font-semibold tracking-[0.2em]">23 Sept 2026</p></div>
      </div>
    </div>
  </Paper>
);

const MiniTimetable: React.FC = () => {
  const grid = [['English', 'Maths', 'Science', 'History'], ['Maths', 'Shona', 'English', 'Geography'], ['Science', 'English', 'Accounts', 'Maths'], ['Geography', 'Computers', 'Maths', 'English'], ['History', 'Maths', 'Shona', 'Science']];
  const tone: Record<string, string> = { English: 'border-[#1d3a8a]', Maths: 'border-[#1f7a45]', Science: 'border-[#b26a00]', History: 'border-[#8a8f8c]', Shona: 'border-[#8a8f8c]', Geography: 'border-[#8a8f8c]', Accounts: 'border-[#8a8f8c]', Computers: 'border-[#8a8f8c]' };
  return (
    <Paper squared>
      <div className="flex items-end justify-between gap-3 px-4 pb-2 pt-4">
        <p className="font-serif text-[15px] font-bold tracking-tight">Form 3A · Timetable</p>
        <p className="font-hand text-[13px] leading-none text-slate-500">Term 3</p>
      </div>
      <div className="px-4 pb-4">
        <div className="grid grid-cols-5 gap-1.5 pb-1 text-center text-[9px] font-semibold uppercase tracking-wider text-slate-400">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => <span key={d} className={d === 'Wed' ? 'text-[#c0262d]' : ''}>{d}</span>)}</div>
        <div className="grid grid-flow-col grid-cols-5 grid-rows-4 gap-1.5">
          {grid.flatMap((col, d) => col.map((s, p) => (
            <span key={`${d}${p}`} style={{ animationDelay: `${(d * 4 + p) * 45}ms` }}
              className={cx('animate-pop truncate rounded-[3px] border-l-[3px] bg-white/80 px-1.5 py-[7px] text-left font-serif text-[10.5px] shadow-[0_1px_0_rgba(0,0,0,.06)]', tone[s], d === 2 && 'ring-1 ring-[#c0262d]/30')}>{s}</span>
          )))}
        </div>
        <p className={cx('mt-2 font-hand text-[13px]', RED)}>No clashes this week ✓</p>
      </div>
    </Paper>
  );
};

const MiniReport: React.FC = () => (
  <Paper ruled={false}>
    <div className="px-6 pb-4 pt-5">
      <div className="border-b-2 border-double border-slate-700 pb-1.5 text-center">
        <p className="font-serif text-[14px] font-bold uppercase tracking-[0.12em]">Greenfield Academy</p>
        <p className="text-[9px] uppercase tracking-[0.25em] text-slate-500">Term 2 progress report</p>
      </div>
      <div className="mt-2 flex items-center justify-between font-serif text-[11px]">
        <span><b>Tanaka Chikwanha</b> · Form 3A</span>
        <span className="relative">Position <b>2nd</b> of 22
          <svg className="absolute -inset-x-2 -inset-y-1.5 h-[calc(100%+12px)] w-[calc(100%+16px)]" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="M8 16 C 10 3, 90 2, 94 14 C 97 27, 12 29, 5 17" fill="none" stroke="#c0262d" strokeWidth="1.6" pathLength={1} className="animate-draw [stroke-dasharray:1]" /></svg>
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {([['English Language', 81, 'A'], ['Mathematics', 73, 'B'], ['History', 87, 'A'], ['Geography', 68, 'B']] as const).map(([s, m, g], i) => (
          <div key={s} className="grid grid-cols-[1fr_28px_70px_16px] items-center gap-2 font-serif text-[11px]">
            <span>{s}</span><span className="text-right tabular-nums">{m}</span>
            <span className="h-[5px] overflow-hidden rounded-full bg-slate-200"><span style={{ width: `${m}%`, animationDelay: `${i * 120}ms` }} className="block h-full origin-left animate-grow rounded-full bg-[#1f7a45]" /></span>
            <span className="text-right font-bold">{g}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-end justify-between gap-4 border-t border-slate-200 pt-2">
        <p className={cx('font-hand text-[13px] leading-4', INK)}>A very good term — consistent effort is paying off.</p>
        <svg viewBox="0 0 90 30" className="h-7 w-20 shrink-0" aria-hidden="true"><path d="M3 22 C 12 4, 18 26, 26 14 S 38 6, 42 18 S 55 26, 60 12 S 76 8, 87 16" fill="none" stroke="#1d3a8a" strokeWidth="1.5" strokeLinecap="round" pathLength={1} className="animate-draw [stroke-dasharray:1]" /></svg>
      </div>
    </div>
  </Paper>
);

const SCREENS: Record<View, React.FC> = { register: MiniRegister, gradebook: MiniGradebook, fees: MiniFees, timetable: MiniTimetable, report: MiniReport };

/**
 * Screens change like turning a page in an exercise book: the old page lifts off
 * its left edge and turns over, revealing the next one underneath.
 */
const PageFlip: React.FC<{ view: View }> = ({ view }) => {
  const [turning, setTurning] = useState<View | null>(null);
  const last = useRef(view);
  useLayoutEffect(() => {
    if (last.current === view) return;
    const old = last.current;
    last.current = view;
    if (prefersReduced()) return;
    setTurning(old);
    const t = setTimeout(() => setTurning(null), 950);
    return () => clearTimeout(t);
  }, [view]);
  const Next = SCREENS[view];
  const Old = turning ? SCREENS[turning] : null;
  return (
    <div className="relative min-h-[300px] min-w-0 flex-1 bg-[#efece3] p-2.5 [perspective:1600px] dark:bg-[#0b100e]">
      {/* stacked pages peeking out underneath */}
      <div aria-hidden="true" className="absolute bottom-1.5 left-3.5 right-1 top-3.5 rounded-[3px] bg-[#f3f1ea] shadow-[0_1px_2px_rgba(0,0,0,.08)]" />
      <div aria-hidden="true" className="absolute bottom-2 left-3 right-1.5 top-3 rounded-[3px] bg-[#f8f6ef] shadow-[0_1px_2px_rgba(0,0,0,.08)]" />
      <div className="relative h-full [perspective:1600px]">
        {/* the page underneath */}
        <div key={view} className={cx('relative h-full overflow-hidden rounded-[3px] shadow-[0_1px_3px_rgba(0,0,0,.12)]', turning && 'animate-page-under')}><Next /></div>
        {/* the page being turned */}
        {Old && (
          <div key={`turn-${turning}`} aria-hidden="true"
            className="pointer-events-none absolute inset-0 origin-left animate-page-turn overflow-hidden rounded-[3px] [backface-visibility:hidden] [transform-style:preserve-3d]">
            <Old />
            <div className="absolute inset-0 animate-page-shade bg-[linear-gradient(to_left,rgba(6,20,15,.30),rgba(6,20,15,0)_60%)]" />
            <div className="absolute inset-y-0 right-0 w-8 bg-[linear-gradient(to_left,rgba(6,20,15,.14),transparent)]" />
          </div>
        )}
        {Old && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-16 animate-page-spine bg-[linear-gradient(to_right,rgba(6,20,15,.22),transparent)]" />}
      </div>
    </div>
  );
};

/** Dashboard preview whose screen follows the headline's rotating word. */
const ProductPreview: React.FC<{ index: number; onPick: (i: number) => void }> = ({ index, onPick }) => {
  const cur = WORDS[index]!;
  const Screen = SCREENS[cur.view];
  return (
    <div className="relative mx-auto w-full max-w-[520px]">
      <div className="card overflow-hidden shadow-[0_24px_60px_-20px_rgba(6,36,27,.35)] dark:shadow-[0_24px_60px_-20px_rgba(0,0,0,.7)]">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-white/[0.07] dark:bg-white/[0.02]">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-white/15" /><span className="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-white/15" />
          <span className="ml-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">Greenfield Academy · {cur.nav}</span>
        </div>
        <div className="flex">
          <div className="hidden w-28 shrink-0 space-y-1 bg-brand-950 p-2.5 sm:block dark:bg-ink-950">
            {['Dashboard', 'Attendance', 'Gradebook', 'Timetable', 'Report Cards', 'Fees'].map((l) => {
              const wi = WORDS.findIndex((w) => w.nav === l);
              const on = l === cur.nav;
              return (
                <button key={l} disabled={wi < 0} onClick={() => wi >= 0 && onPick(wi)}
                  className={cx('relative block w-full rounded-md px-2 py-1.5 text-left text-[10px] font-medium transition-colors duration-300', on ? 'bg-white/10 text-white' : 'text-white/55 enabled:hover:text-white/80')}>
                  {on && <span className="absolute -left-2.5 top-1 bottom-1 w-[2px] rounded-r bg-white/70" />}{l}
                </button>
              );
            })}
          </div>
          <PageFlip view={cur.view} />
        </div>
        <div className="flex gap-1 border-t border-slate-100 px-4 py-2 dark:border-white/[0.06]">
          {WORDS.map((w, i) => (
            <button key={w.view} onClick={() => onPick(i)} aria-label={`Show ${w.nav}`} className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
              <span className={cx('block h-full rounded-full bg-brand-600 dark:bg-brand-400', i < index ? 'w-full' : i === index ? 'animate-progress' : 'w-0')} key={i === index ? `p${index}` : undefined} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function Login() {
  const nav = useNavigate();
  const { startDemo } = useAuth();
  const { dark, toggle } = useTheme();
  const [watch, setWatch] = useState(false);
  const [picker, setPicker] = useState(false);
  const [demoType, setDemoType] = useState<Section>('secondary');
  const openDemo = () => { setWatch(false); setPicker(true); };
  const launch = () => { restartTour(); startDemo(demoType); nav('/', { replace: true }); };
  const [wordIdx, setWordIdx] = useCycle(WORDS.length, 4000);
  const [statsRef, statsSeen] = useInView<HTMLDListElement>();
  const [stampRef, stampSeen] = useInView<HTMLDivElement>({ threshold: 0.4 });

  const navLink = 'hover:text-slate-900 dark:hover:text-white';

  return (
    <div className="min-h-screen bg-paper-50 text-slate-800 dark:bg-ink-900 dark:text-slate-300">
      {/* ------------------------------------------------------------ nav */}
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-paper-50/85 backdrop-blur-md dark:border-white/[0.06] dark:bg-ink-900/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 md:px-6">
          <button className="flex items-center gap-2.5" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <MusaLogo size={34} />
          </button>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex dark:text-slate-400">
            <button className={navLink} onClick={() => scrollTo('modules')}>Modules</button>
            <button className={navLink} onClick={() => scrollTo('acegrader')}>AceGrader</button>
            <button className={navLink} onClick={() => scrollTo('roles')}>Who it’s for</button>
            <button className={navLink} onClick={openDemo}>Demo</button>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={toggle} aria-label="Toggle theme" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
            <Button variant="outline" onClick={() => nav('/signin')}>Sign in</Button>
            <span className="hidden sm:block"><Button onClick={() => nav('/signup')}>Get started</Button></span>
          </div>
        </div>
      </header>

      {/* ----------------------------------------------------------- hero */}
      <section className="relative overflow-hidden">
        <Ruled />
        <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 pb-20 pt-14 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <h1 className="animate-slide-up font-display text-[2.6rem] font-bold leading-[1.02] tracking-[-0.035em] text-slate-900 sm:text-[3.4rem] lg:text-[3.75rem] dark:text-white">
              Run your school<br />from one{' '}<RotatingWord index={wordIdx} />.
            </h1>
            <p style={{ animationDelay: '120ms' }} className="mt-6 max-w-xl animate-slide-up text-[17px] leading-relaxed text-slate-600 dark:text-slate-400">
              Admissions, attendance, marks, report cards and fees in one place — plus AceGrader to mark scripts against your own rubrics. Parents see results and balances the moment you publish.
            </p>
            <div style={{ animationDelay: '220ms' }} className="mt-8 flex animate-slide-up flex-wrap items-center gap-3">
              <Button size="lg" onClick={() => nav('/signup')} icon={<ArrowRight size={16} />}>Set up your school</Button>
              <Button size="lg" variant="outline" onClick={openDemo}>Try the demo</Button>
              <button onClick={() => setWatch(true)} className="group inline-flex items-center gap-2 px-1 text-sm font-semibold text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
                <PlayCircle size={20} className="text-brand-700 transition group-hover:scale-110 dark:text-brand-300" /> Watch how it works
              </button>
            </div>
            <dl ref={statsRef} className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-slate-200 pt-6 dark:border-white/[0.08]">
              {([[14, 'modules working together'], [5, 'role-based logins'], [3, 'ZIMSEC grading scales']] as const).map(([k, v]) => (
                <div key={v}><dt className="font-display text-2xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white"><CountUp to={k} run={statsSeen} /></dt><dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{v}</dd></div>
              ))}
            </dl>
          </div>
          <div style={{ animationDelay: '180ms' }} className="animate-slide-up"><ProductPreview index={wordIdx} onPick={setWordIdx} /></div>
        </div>
      </section>

      {/* -------------------------------------------------------- modules */}
      <section id="modules" className="scroll-mt-20 bg-white py-20 dark:border-white/[0.06] dark:bg-ink-950">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="max-w-2xl">
            <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-slate-900 md:text-4xl dark:text-white">One system instead of registers, spreadsheets and receipt books.</h2>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4 dark:border-white/[0.08] dark:bg-white/[0.08]">
            {MODULES.map((m, i) => (
              <Reveal key={m.title} delay={(i % 4) * 80} className="group bg-white p-6 transition-colors hover:bg-brand-50/40 dark:bg-ink-800 dark:hover:bg-white/[0.03]">
                <m.icon size={20} className="text-slate-400 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-110 dark:text-slate-400" />
                <h3 className="mt-4 font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{m.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{m.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ acegrader */}
      <section id="acegrader" className="scroll-mt-20 bg-brand-950 py-20 text-white dark:bg-[#0b1a15]">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 md:px-6 lg:grid-cols-2">
          <div>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] md:text-4xl">Mark a stack of compositions before break.</h2>
            <p className="mt-4 max-w-lg leading-relaxed text-white/70">Upload scripts, choose your rubric and class, and every script comes back marked criterion by criterion with margin notes. You check it, change what you disagree with, and one click posts the mark into the gradebook.</p>
            <ul className="mt-7 space-y-3 text-sm text-white/80">
              {['Scripts matched to learners by file name', 'Your corrections shape how later scripts are marked', 'Class insights show which skills need re-teaching'].map((t) => (
                <li key={t} className="flex items-start gap-3"><Check size={16} className="mt-0.5 shrink-0 text-white/50" />{t}</li>
              ))}
            </ul>
          </div>
          <div ref={stampRef} className="paper relative overflow-hidden rounded-2xl bg-[#fdfcf8] p-7 text-slate-800 shadow-[0_30px_60px_-24px_rgba(0,0,0,.6)]">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_27px,#e6ebe8_27px,#e6ebe8_28px)] [background-position:0_52px]" />
            <div aria-hidden="true" className="absolute inset-y-0 left-12 w-px bg-rose-300" />
            <div className="relative pl-8">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Form 3A · English Composition</p><p className="mt-1 font-display text-lg font-bold text-slate-900">Tanaka Chikwanha</p></div>
                <div className={cx('shrink-0 rotate-[-12deg] rounded-lg border-[3px] border-rose-600/80 px-3 py-1 text-center font-hand text-rose-700', stampSeen ? 'animate-stamp' : 'opacity-0')} style={{ animationDelay: '900ms' }}><p className="text-2xl font-bold leading-none">22/30</p><p className="text-[10px] font-bold uppercase tracking-wider">B · Merit</p></div>
              </div>
              <p className="mt-4 font-serif text-[15px] leading-7">
                <span className="bg-brand-100 underline decoration-brand-600 decoration-2 underline-offset-4">It was a cold morning</span> in July when <span className="bg-marigold-100 underline decoration-marigold-600 decoration-wavy underline-offset-4">we was walking</span> to school through the vlei. <span className="underline decoration-sky-600 decoration-dotted decoration-2 underline-offset-4">Suddenly</span>, we heard a loud noise behind the gum trees…
              </p>
              <div className="mt-4 grid gap-2 font-hand text-[15px] leading-5 sm:grid-cols-3">
                {[['text-brand-800', '✓ Strong opening'], ['text-marigold-700', 'we were walking'], ['text-sky-800', 'build suspense instead']].map(([c, t], i) => (
                  <p key={t} className={cx(c, 'overflow-hidden whitespace-nowrap', stampSeen ? 'animate-write' : 'max-w-0')} style={{ animationDelay: `${200 + i * 250}ms` }}>{t}</p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- roles */}
      <section id="roles" className="relative scroll-mt-20 py-20">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.02em] text-slate-900 md:text-4xl dark:text-white">A login for everyone at your school.</h2>
            </div>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">The head adds staff, parents and learners. Each person sees only what their role allows.</p>
          </div>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {ROLES.map((r, i) => (
              <Reveal key={r.role} delay={i * 70} className="flex"><div className="card flex w-full flex-col p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200"><r.icon size={19} /></span>
                <span className="mt-4 font-display text-base font-semibold tracking-tight text-slate-900 dark:text-white">{r.title}</span>
                <ul className="mt-4 flex-1 space-y-1.5 border-t border-slate-100 pt-4 text-[13px] text-slate-600 dark:border-white/[0.07] dark:text-slate-400">
                  {r.points.map((p) => <li key={p} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />{p}</li>)}
                </ul>
              </div></Reveal>
            ))}
          </div>
          <div className="mt-12 flex flex-col items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center dark:border-white/[0.08] dark:bg-ink-800">
            <div>
              <p className="font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-white">See it before you sign up.</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Watch a 40-second walkthrough, or open an empty practice school with a guide beside you.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" variant="outline" onClick={() => setWatch(true)} icon={<PlayCircle size={16} />}>Watch how it works</Button>
              <Button size="lg" onClick={openDemo} icon={<ArrowRight size={16} />}>Try the demo</Button>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- go-live */}
      <section className="border-t border-slate-200/80 bg-white py-20 dark:border-white/[0.06] dark:bg-ink-950">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <h2 className="font-display text-3xl font-bold tracking-[-0.02em] text-slate-900 dark:text-white">From first login to first report card</h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3">
            {[
              ['Create your school', 'Choose primary or secondary, then add your classes and invite staff with their own logins.'],
              ['Bring in learners', "Import learners from a spreadsheet, link guardians, and generate the term's invoices in one go."],
              ['Teach, mark, report', 'Registers and marks flow into report cards that you print or publish to parents.'],
            ].map(([t, b], i) => (
              <Reveal as="li" key={t} delay={i * 120} className="border-t-2 border-brand-700 pt-5 dark:border-brand-400">
                <span className="text-sm font-medium text-slate-400">Step {i + 1}</span>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{b}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------------------- footer */}
      <footer className="border-t border-slate-200/80 py-8 dark:border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-xs text-slate-500 sm:flex-row md:px-6 dark:text-slate-400">
          <span className="flex items-center gap-2"><MusaMark size={20} /> Musa OS · School management from ECD to A-Level</span>
          <span className="flex gap-4"><button onClick={() => nav('/signin')} className="hover:text-slate-900 dark:hover:text-white">Sign in</button><button onClick={() => nav('/signup')} className="hover:text-slate-900 dark:hover:text-white">Create a school</button></span>
        </div>
      </footer>

      <Walkthrough open={watch} onClose={() => setWatch(false)} onTry={openDemo} />

      <Modal open={picker} onClose={() => setPicker(false)} size="sm" title="Try Musa OS"
        footer={<><Button variant="outline" onClick={() => setPicker(false)}>Cancel</Button><Button onClick={launch} icon={<ArrowRight size={15} />}>Open practice school</Button></>}>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">You’ll get an <b className="font-semibold text-slate-900 dark:text-white">empty</b> practice school and a guide that walks you through setting it up. It stays in this browser — nothing is saved online.</p>
        <div role="radiogroup" aria-label="School type" className="mt-4 space-y-2">
          {(Object.keys(SCHOOL_TYPES) as Section[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={demoType === k} onClick={() => setDemoType(k)}
              className={cx('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition',
                demoType === k ? 'border-brand-600 ring-[3px] ring-brand-600/15 dark:border-brand-400 dark:ring-brand-400/15' : 'border-slate-200 hover:border-slate-300 dark:border-white/10 dark:hover:border-white/20')}>
              <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-[1.5px]', demoType === k ? 'border-brand-700 bg-brand-700 dark:border-brand-400 dark:bg-brand-400' : 'border-slate-300 dark:border-white/25')}>{demoType === k && <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-ink-950" />}</span>
              <span><span className="block text-sm font-semibold text-slate-900 dark:text-white">{SCHOOL_TYPES[k].label}</span><span className="text-xs text-slate-500 dark:text-slate-400">{SCHOOL_TYPES[k].levels}</span></span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
