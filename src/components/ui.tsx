import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {AlertTriangle, CheckCircle2, Info, Loader2, Search, X, XCircle, Inbox} from 'lucide-react';
import { cx, initials } from '../lib/utils';

// ------------------------------------------------------------------ Button --
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: React.ReactNode;
}> = ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }) => {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-brand-800 text-white hover:bg-brand-900 shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_1px_2px_rgba(6,36,27,.25)] dark:bg-brand-600 dark:text-white dark:hover:bg-brand-500',
    secondary: 'bg-brand-800 text-white hover:bg-brand-900 shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_1px_2px_rgba(6,36,27,.25)] dark:bg-brand-600 dark:text-white dark:hover:bg-brand-500',
    outline: 'border border-slate-200 bg-white text-slate-700 shadow-[0_1px_1px_rgba(19,27,24,.04)] hover:border-slate-300 hover:bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:bg-white/[0.07]',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06]',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
    success: 'bg-brand-600 text-white hover:bg-brand-700',
  };
  const s = { sm: 'h-8 px-2.5 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-sm gap-2' }[size];
  return (
    <button
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition active:translate-y-px disabled:pointer-events-none disabled:opacity-50', v[variant], s, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
};

// -------------------------------------------------------------------- Card --
export const Card: React.FC<{ title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string; bodyClass?: string; children?: React.ReactNode }> = ({ title, subtitle, actions, className, bodyClass, children }) => (
  <section className={cx('card', className)}>
    {(title || actions) && (
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-4">
        <div className="min-w-0">
          {title && <h3 className="truncate font-display text-[15px] font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h3>}
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    )}
    <div className={cx('p-5', bodyClass)}>{children}</div>
  </section>
);

// -------------------------------------------------------------- PageHeader --
export const PageHeader: React.FC<{ title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: string }> = ({ title, subtitle, actions }) => (
  <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between no-print">
    <div className="min-w-0">
      <h1 className="font-display text-[1.9rem] font-bold leading-[1.1] tracking-[-0.02em] text-slate-900 md:text-[2.25rem] dark:text-white">{title}</h1>
      {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

// ------------------------------------------------------------------ Fields --
export const Field: React.FC<{ label: string; hint?: string; className?: string; children: React.ReactNode; required?: boolean }> = ({ label, hint, className, children, required }) => (
  // A div (not <label>) so fields that wrap several controls — pickers, chips, buttons —
  // don't get their clicks re-targeted by label activation.
  <div className={cx('block', className)} role="group">
    <span className="label">{label}{required && <span className="text-rose-500 dark:text-rose-300"> *</span>}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
  </div>
);
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx('input', className)} {...p} />);
export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ className, children, ...p }) => <select className={cx('input pr-8', className)} {...p}>{children}</select>;
export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ className, ...p }) => <textarea className={cx('input min-h-[90px]', className)} {...p} />;

export const SearchInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string; className?: string }> = ({ value, onChange, placeholder = 'Search…', className }) => (
  <div className={cx('relative', className)}>
    <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
    <input className="input pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

// ------------------------------------------------------------------- Badge --
type Tone = 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'sky';
const DOT: Partial<Record<Tone, string>> = { green: 'bg-brand-500', red: 'bg-rose-500', amber: 'bg-marigold-400' };
export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({ tone = 'slate', children, className }) => (
  <span className={cx('chip border border-slate-200 bg-white text-slate-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300', className)}>
    {DOT[tone] && <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} />}
    {children}
  </span>
);

// --------------------------------------------------------------- StatCard --
export const StatCard: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; tone?: 'brand' | 'green' | 'amber' | 'rose' | 'violet'; onClick?: () => void }> = ({ label, value, sub, onClick }) => (
  <div onClick={onClick} className={cx('card flex flex-col gap-2.5 p-5', onClick && 'cursor-pointer transition hover:border-slate-300 dark:hover:border-white/15')}>
    <p className="text-[13px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
    <p className="break-words font-display text-[1.75rem] font-bold leading-none tracking-[-0.02em] tabular-nums text-slate-900 dark:text-white">{value}</p>
    {sub && <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
  </div>
);

// ------------------------------------------------------------- EmptyState --
export const EmptyState: React.FC<{ title: string; body?: string; icon?: React.ReactNode; action?: React.ReactNode }> = ({ title, body, icon, action }) => (
  <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
    <div className="mb-3 rounded-full border border-dashed border-slate-300 p-3 text-slate-400 dark:border-white/15">{icon ?? <Inbox size={22} />}</div>
    <p className="font-semibold text-slate-700 dark:text-slate-200">{title}</p>
    {body && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{body}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// ------------------------------------------------------------------- Modal --
export const Modal: React.FC<{ open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }> = ({ open, onClose, title, children, footer, size = 'md' }) => {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-0 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4 no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl animate-slide-up sm:rounded-2xl dark:bg-ink-700 dark:ring-1 dark:ring-white/10', w)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-white/[0.07]">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-white/[0.07]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

// -------------------------------------------------------------------- Tabs --
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: React.ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx('no-print flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-white/[0.08]', className)} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px flex items-center whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1.5 text-sm font-medium transition',
            value === t.id ? 'border-brand-700 text-slate-900 dark:border-brand-300 dark:text-white' : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white')}>
          {t.label}{t.count != null && <span className={cx('ml-1.5 rounded-md px-1.5 py-px text-[11px] font-semibold tabular-nums', value === t.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/25 dark:text-brand-300' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400')}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Avatar --
const AV = ['bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-slate-200'];
export const Avatar: React.FC<{ name: string; size?: number; className?: string }> = ({ name, size = 36, className }) => {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <div className={cx('flex shrink-0 items-center justify-center rounded-full font-bold', AV[h % AV.length], className)} style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {initials(name)}
    </div>
  );
};

export const Spinner: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={18} className="animate-spin" />{label ?? 'Loading…'}</div>
);

export const Progress: React.FC<{ value: number; tone?: 'brand' | 'green' | 'amber' | 'rose'; className?: string }> = ({ value, tone = 'brand', className }) => {
  const c = { brand: 'bg-brand-600 dark:bg-brand-400', green: 'bg-brand-500', amber: 'bg-marigold-400', rose: 'bg-rose-500' }[tone];
  return <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10', className)}><div className={cx('h-full rounded-full transition-all', c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
};

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: React.ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 dark:border-white/10 dark:bg-white/[0.03]">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold transition', value === o.id ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(19,27,24,.12)] dark:bg-white/15 dark:text-white' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400')}>{o.label}</button>
      ))}
    </div>
  );
}

/** Horizontally-scrollable table wrapper. */
export const TableWrap: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('-mx-5 overflow-x-auto', className)}><table className="w-full min-w-[640px] border-collapse">{children}</table></div>
);

// ------------------------------------------------------------ Toasts/Confirm --
type ToastT = { id: number; kind: 'success' | 'error' | 'info'; msg: string };
interface UICtx {
  toast: (msg: string, kind?: ToastT['kind']) => void;
  confirm: (opts: { title: string; body?: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
}
const Ctx = createContext<UICtx>({ toast: () => {}, confirm: async () => false });
export const useUI = () => useContext(Ctx);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastT[]>([]);
  const [dlg, setDlg] = useState<null | { title: string; body?: string; confirmText?: string; danger?: boolean }>(null);
  const resolver = useRef<(b: boolean) => void>(undefined);
  const toast = useCallback((msg: string, kind: ToastT['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const confirm = useCallback<UICtx['confirm']>((o) => new Promise((res) => { resolver.current = res; setDlg(o); }), []);
  const close = (v: boolean) => { resolver.current?.(v); setDlg(null); };
  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-24 right-4 z-[200] flex flex-col gap-2 md:bottom-6 no-print">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-xl animate-slide-up dark:border-white/10 dark:bg-ink-700">
            {t.kind === 'success' ? <CheckCircle2 size={18} className="mt-px shrink-0 text-brand-500 dark:text-brand-300" /> : t.kind === 'error' ? <XCircle size={18} className="mt-px shrink-0 text-rose-500 dark:text-rose-300" /> : <Info size={18} className="mt-px shrink-0 text-brand-500 dark:text-brand-300" />}
            <span className="text-slate-700 dark:text-slate-200">{t.msg}</span>
          </div>
        ))}
      </div>
      <Modal open={!!dlg} onClose={() => close(false)} title={dlg?.title} size="sm"
        footer={<><Button variant="outline" onClick={() => close(false)}>Cancel</Button><Button variant={dlg?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{dlg?.confirmText ?? 'Confirm'}</Button></>}>
        <div className="flex gap-3">
          {dlg?.danger && <AlertTriangle className="shrink-0 text-rose-500 dark:text-rose-300" size={20} />}
          <p className="text-sm text-slate-600 dark:text-slate-300">{dlg?.body ?? 'Are you sure?'}</p>
        </div>
      </Modal>
    </Ctx.Provider>
  );
};
