// Guided tour for the demo school. A card follows the user around the app,
// a moving ring points at the next thing to press, and each step ticks itself
// off when the matching record appears — no sample data is ever inserted.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Minus } from 'lucide-react';
import { useCollection } from '../lib/store';
import { CollectionName } from '../types';
import { cx } from '../lib/utils';

type Target = { nav?: string; text?: string };
interface Step {
  title: string;
  body: string;
  route?: string;
  target?: Target;
  /** Step completes when this collection has at least one record. */
  needs?: CollectionName;
  finale?: boolean;
}

const STEPS: Step[] = [
  { title: 'Welcome to your demo school', body: 'It’s empty on purpose — you’ll set it up the way a real school would, in about five minutes. Everything you add is saved to your demo account.' },
  { title: 'Your setup space', route: '/setup', target: { text: 'Create login' }, body: 'Share your school code so staff and parents can ask to join — their requests pop up here instantly for you to accept. Or create a login yourself and choose the password.' },
  { title: 'Create your first class', route: '/classes', target: { text: 'New class' }, needs: 'classes', body: 'Press “New class”, pick a level and stream, and save. Every register, mark sheet and fee bill hangs off a class.' },
  { title: 'Add a teacher', route: '/staff', target: { text: 'Add staff' }, needs: 'staff', body: 'Press “Add staff” and add yourself or a colleague as a teacher. Only a name and position are needed.' },
  { title: 'Give the class a subject', route: '/classes', target: { text: 'Allocations' }, needs: 'allocations', body: 'Open “Allocations”, choose the class, a subject and the teacher, then press “Add”. This tells the gradebook who teaches what.' },
  { title: 'Enrol a learner', route: '/students', target: { text: 'Enrol student' }, needs: 'students', body: 'Press “Enrol student”, type a name, choose the class and save. Musa OS gives them an admission number.' },
  { title: 'Take the morning register', route: '/attendance', target: { text: 'Take register' }, needs: 'attendance', body: 'Everyone starts as present. Tap a learner to mark them absent or late, then save the register.' },
  { title: 'Set a test', route: '/gradebook', target: { text: 'New assessment' }, needs: 'assessments', body: 'Press “New assessment”, name it (for example “Test 1”) and give it a total out of.' },
  { title: 'Type in the marks', route: '/gradebook', needs: 'marks', body: 'Type a mark next to the learner. The grade appears as you type and saves on its own.' },
  { title: 'Set the term’s fees', route: '/finance', target: { text: 'Fee structures' }, needs: 'feeStructures', body: 'Open “Fee structures” and add one — for example tuition of $150 for your level. You can then bill the whole class in one go.' },
  { title: 'Report cards write themselves', route: '/reports', target: { text: 'Print report cards' }, body: 'Marks, positions, attendance and remarks come together here. Print them on A4 or publish them to parents’ phones.' },
  { title: 'AceGrader — the extra', route: '/acegrader', target: { nav: '/acegrader' }, body: 'An optional add-on: it marks learners’ work against your answer key or rubric, you check it, and the scores go straight into the gradebook.' },
  { title: 'That’s the whole loop', finale: true, body: 'Class → learners → register → marks → fees → reports. Use “View as” at the top to see it as a teacher, parent or learner. When you’re ready, create your real school.' },
];

const TOUR_KEY = 'musa-tour';
type Saved = { step: number; open: boolean };
const load = (): Saved => { try { return { step: 0, open: true, ...JSON.parse(localStorage.getItem(TOUR_KEY) || '{}') }; } catch { return { step: 0, open: true }; } };
const save = (s: Saved) => { try { localStorage.setItem(TOUR_KEY, JSON.stringify(s)); } catch { /* ignore */ } };

/** Find the element a step points at: a sidebar link, or a visible button/tab whose text starts with the label. */
function findTarget(t: Target | undefined): HTMLElement | null {
  if (!t) return null;
  if (t.nav) return document.querySelector<HTMLElement>(`aside a[href="#${t.nav}"]`);
  if (!t.text) return null;
  const want = t.text.toLowerCase();
  const els = Array.from(document.querySelectorAll<HTMLElement>('main button, main a, main [role="tab"]'));
  return els.find((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (e.innerText || '').trim().toLowerCase().startsWith(want);
  }) ?? null;
}

/** True when nothing (a modal, the tour card) covers the middle of the element. */
function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
  return !!hit && (el === hit || el.contains(hit));
}

export const Tour: React.FC<{ onFinish: () => void }> = ({ onFinish }) => {
  const [state, setState] = useState<Saved>(load);
  const { step, open } = state;
  const s = STEPS[Math.min(step, STEPS.length - 1)]!;
  const loc = useLocation();
  const nav = useNavigate();
  const onRoute = !s.route || loc.pathname === s.route;

  // record counts for auto-completion
  const counts: Partial<Record<CollectionName, number>> = {
    classes: useCollection('classes').data.length,
    staff: useCollection('staff').data.length,
    allocations: useCollection('allocations').data.length,
    students: useCollection('students').data.length,
    attendance: useCollection('attendance').data.length,
    assessments: useCollection('assessments').data.length,
    marks: useCollection('marks').data.length,
    feeStructures: useCollection('feeStructures').data.length,
  };
  const done = !!s.needs && (counts[s.needs] ?? 0) > 0;

  const set = (patch: Partial<Saved>) => setState((p) => { const n = { ...p, ...patch }; save(n); return n; });
  const go = (i: number) => set({ step: Math.max(0, Math.min(STEPS.length - 1, i)), open: true });

  // when a step's record appears, show the tick briefly and move on
  const advanced = useRef(-1);
  useEffect(() => {
    if (!done || advanced.current === step) return;
    advanced.current = step;
    const t = setTimeout(() => go(step + 1), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, step]);

  // ring position: follow the target (or the sidebar link when on the wrong page)
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!open) { setRect(null); return; }
    let raf = 0; let last = '';
    const tick = () => {
      const el = onRoute ? findTarget(s.target) : (s.route ? findTarget({ nav: s.route }) : null);
      const r = el && visible(el) && !done ? el.getBoundingClientRect() : null;
      const key = r ? `${r.left|0},${r.top|0},${r.width|0},${r.height|0}` : '';
      if (key !== last) { last = key; setRect(r); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, onRoute, s, done]);

  const pct = useMemo(() => Math.round((step / (STEPS.length - 1)) * 100), [step]);

  if (!open) {
    return (
      <button onClick={() => set({ open: true })}
        className="fixed bottom-5 left-5 z-[110] flex items-center gap-2 rounded-full lg:left-[260px] bg-brand-900 py-2.5 pl-3 pr-4 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-800 dark:bg-brand-600 no-print">
        <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-white/70" /><span className="relative h-2 w-2 rounded-full bg-white" /></span>
        Tour · {step + 1} of {STEPS.length}
      </button>
    );
  }

  const pad = 6;
  return (
    <>
      {rect && (
        <div aria-hidden="true" className="pointer-events-none fixed z-[105] rounded-xl transition-all duration-500 ease-[cubic-bezier(.16,1,.3,1)] no-print"
          style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}>
          <div className="absolute inset-0 rounded-xl ring-2 ring-marigold-400 shadow-[0_0_0_4px_rgba(245,166,35,.18)]" />
          <div className="absolute inset-0 animate-tour-pulse rounded-xl ring-2 ring-marigold-400/60" />
        </div>
      )}

      <div role="dialog" aria-label="Guided tour"
        className="fixed inset-x-3 bottom-3 z-[110] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-20px_rgba(6,20,15,.45)] sm:inset-x-auto sm:bottom-5 sm:left-5 sm:w-[370px] lg:left-[260px] dark:border-white/10 dark:bg-ink-700 no-print">
        <div className="h-1 bg-slate-100 dark:bg-white/[0.06]"><div className="h-full bg-brand-600 transition-all duration-700 dark:bg-brand-400" style={{ width: `${pct}%` }} /></div>
        <div className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Step {step + 1} of {STEPS.length}</span>
            <div className="flex items-center gap-0.5">
              <button onClick={() => set({ open: false })} aria-label="Minimise tour" className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"><Minus size={16} /></button>
            </div>
          </div>

          <div key={step} className="animate-tour-in">
            <h3 className="mt-2 flex items-center gap-2 font-display text-[17px] font-semibold tracking-tight text-slate-900 dark:text-white">
              {done && <span className="flex h-5 w-5 animate-pop items-center justify-center rounded-full bg-brand-600 text-white"><Check size={12} strokeWidth={3} /></span>}
              {s.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{done ? 'Done — nicely.' : s.body}</p>
          </div>

          <div className="mt-4 flex items-center gap-2">
            {step > 0 && <button onClick={() => go(step - 1)} aria-label="Previous step" className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"><ArrowLeft size={15} /></button>}
            {s.finale ? (
              <button onClick={onFinish} className="flex-1 rounded-lg bg-brand-800 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-900 dark:bg-brand-600 dark:hover:bg-brand-500">Create my real school</button>
            ) : !onRoute ? (
              <button onClick={() => nav(s.route!)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-800 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-900 dark:bg-brand-600 dark:hover:bg-brand-500">Take me there <ArrowRight size={15} /></button>
            ) : (
              <button onClick={() => go(step + 1)} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold',
                s.needs && !done ? 'border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5' : 'bg-brand-800 text-white hover:bg-brand-900 dark:bg-brand-600 dark:hover:bg-brand-500')}>
                {s.needs && !done ? 'Skip this step' : step === 0 ? 'Start' : 'Next'} <ArrowRight size={15} />
              </button>
            )}
          </div>
          {s.finale && <button onClick={() => set({ open: false })} className="mt-2 w-full text-center text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white">Keep exploring — try “View as” at the top</button>}
        </div>
      </div>
    </>
  );
};

export const restartTour = () => save({ step: 0, open: true });
