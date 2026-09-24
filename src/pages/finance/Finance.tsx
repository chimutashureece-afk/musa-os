import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {Banknote, Check, ClipboardCopy, Copy, Download, Eye, FilePlus2, FileText, MessageCircle, Pencil, Plus, Printer, Receipt, Trash2, TrendingUp, Users, Wallet, X} from 'lucide-react';
import { useAuth, useSettings } from '../../context/AuthContext';
import { useCan } from '../../lib/hooks';
import { newId, store, useCollection, useIndex } from '../../lib/store';
import type { WriteOp } from '../../lib/backend';
import {
  addDays, classSort, currentTerm, cx, download, fmtDate, fullName, LEVELS, money, nextNumber, pad, parseISO, pct, round1,
  staffName, studentMatches, sum, termById, todayISO, toCSV,
} from '../../lib/utils';
import type {
  FeeItem, FeeStructure, Invoice, Payment, PaymentMethod, SchoolClass, SchoolSettings, Staff, Student, Term,
} from '../../types';
import {
  Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Segmented, Select, Spinner, StatCard,
  TableWrap, Tabs, Textarea, useUI,
} from '../../components/ui';

export const PAYMENT_METHODS: PaymentMethod[] = ['Cash', 'Bank transfer', 'EcoCash', 'InnBucks', 'Card', 'Other'];
const EPS = 0.005;

// ============================================================================
// Shared helpers (also used by ParentFees)
// ============================================================================
export type PayStatus = 'paid' | 'partial' | 'unpaid' | 'none';
export const statusOf = (billed: number, paid: number): PayStatus =>
  billed <= EPS ? (paid > EPS ? 'paid' : 'none') : paid >= billed - EPS ? 'paid' : paid > EPS ? 'partial' : 'unpaid';

export const StatusBadge: React.FC<{ s: PayStatus }> = ({ s }) =>
  s === 'paid' ? <Badge tone="green">Paid</Badge> : s === 'partial' ? <Badge tone="amber">Partial</Badge> : s === 'unpaid' ? <Badge tone="red">Unpaid</Badge> : <Badge>—</Badge>;

/** FIFO-allocate each student-term's payments across that term's invoices. Returns invoiceId -> amount paid. */
export function allocatePayments(invoices: Invoice[], payments: Payment[]): Map<string, number> {
  const paid = new Map<string, number>();
  for (const p of payments) {
    const k = `${p.studentId}|${p.termId}`;
    paid.set(k, (paid.get(k) ?? 0) + p.amount);
  }
  const groups = new Map<string, Invoice[]>();
  for (const i of invoices) {
    const k = `${i.studentId}|${i.termId}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }
  const out = new Map<string, number>();
  groups.forEach((list, k) => {
    let left = paid.get(k) ?? 0;
    list.sort((a, b) => a.issuedDate.localeCompare(b.issuedDate) || a.invoiceNo.localeCompare(b.invoiceNo));
    list.forEach((inv, idx) => {
      const take = idx === list.length - 1 ? left : Math.min(left, inv.total);
      out.set(inv.id, Math.max(0, take));
      left -= Math.max(0, take);
    });
  });
  return out;
}

export const waDigits = (phone?: string) => {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `263${d.slice(1)}`;
  return d;
};

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function intWords(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` and ${intWords(n % 100)}` : ''}`;
  if (n < 1e6) return `${intWords(Math.floor(n / 1000))} thousand${n % 1000 ? `${n % 1000 < 100 ? ' and' : ''} ${intWords(n % 1000)}` : ''}`;
  return `${intWords(Math.floor(n / 1e6))} million${n % 1e6 ? ` ${intWords(n % 1e6)}` : ''}`;
}
export function amountInWords(amount: number): string {
  const dollars = Math.floor(amount + EPS);
  const cents = Math.round((amount - dollars) * 100);
  const w = `${intWords(dollars)} US dollar${dollars === 1 ? '' : 's'}${cents ? ` and ${cents}/100` : ''} only`;
  return w[0]!.toUpperCase() + w.slice(1);
}

/** Render a document into the print-only area and open the print dialog. */
export function usePrinter() {
  const [node, setNode] = useState<React.ReactNode>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!tick) return;
    const t = setTimeout(() => window.print(), 80);
    return () => clearTimeout(t);
  }, [tick]);
  const print = useCallback((n: React.ReactNode) => { setNode(n); setTick((x) => x + 1); }, []);
  return { print, host: <div className="print-only">{node}</div> };
}

/** On-screen paper preview with a Print button. */
export const DocPreview: React.FC<{ open: boolean; title: string; onClose: () => void; onPrint: () => void; children: React.ReactNode; extra?: React.ReactNode }> = ({ open, title, onClose, onPrint, children, extra }) => (
  <Modal open={open} onClose={onClose} title={title} size="xl"
    footer={<>{extra}<Button variant="outline" onClick={onClose}>Close</Button><Button icon={<Printer size={16} />} onClick={onPrint}>Print</Button></>}>
    <div className="-mx-5 -my-5 bg-slate-200/70 p-3 sm:p-6 dark:bg-black/40">
      <div className="paper mx-auto max-w-[210mm] shadow-xl ring-1 ring-black/5">{children}</div>
    </div>
  </Modal>
);

export const Paper: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('w-full bg-white p-8 font-sans text-[12px] leading-snug text-slate-900 print:p-0 dark:text-white', className)}>{children}</div>
);

export const Letterhead: React.FC<{ settings?: SchoolSettings; title: string; compact?: boolean }> = ({ settings, title, compact }) => (
  <div className="mb-4">
    <div className={cx('flex items-center gap-4 border-b-[3px] border-double border-slate-800', compact ? 'pb-2' : 'pb-3')}>
      <div className={cx('flex shrink-0 items-center justify-center rounded-full border-2 border-slate-800 font-display tracking-tight font-bold', compact ? 'h-12 w-12 text-lg' : 'h-16 w-16 text-2xl')}>
        {(settings?.name ?? 'S').split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className={cx('font-serif font-bold uppercase leading-tight tracking-wide', compact ? 'text-[19px]' : 'text-[24px]')}>{settings?.name ?? 'School'}</h1>
        {settings?.motto && !compact && <p className="font-display tracking-tight text-[13px] text-slate-700 dark:text-slate-200">“{settings.motto}”</p>}
        <p className="mt-0.5 text-[11px] text-slate-700 dark:text-slate-200">{settings?.address}</p>
        <p className="text-[11px] text-slate-700 dark:text-slate-200">{[settings?.phone, settings?.email, settings?.website].filter(Boolean).join('  ·  ')}</p>
      </div>
      <div className="text-right">
        <p className={cx('font-bold uppercase tracking-[0.18em]', compact ? 'text-[14px]' : 'text-[17px]')}>{title}</p>
      </div>
    </div>
  </div>
);

export const PaymentInstructions: React.FC<{ settings?: SchoolSettings; admissionNo?: string; doc?: boolean }> = ({ settings, admissionNo, doc }) => {
  const custom: string | undefined = (settings as any)?.paymentInstructions ?? (settings as any)?.paymentDetails;
  const ref = admissionNo ?? 'the learner’s admission number';
  const lines: [string, string][] = [
    ['Bank transfer (USD)', `Pay into the school’s USD account (details from the bursary). Use ${ref} as the reference and send proof of payment to ${settings?.email ?? 'the school office'}.`],
    ['EcoCash / InnBucks', `Pay to the school merchant code available from the bursary. Enter ${ref} as the reference.`],
    ['Cash or card at the bursary', 'Monday to Friday, 07:30 – 16:00. Always ask for an official receipt.'],
  ];
  if (doc) {
    return (
      <div className="rounded border border-slate-400 px-3 py-2 text-[11px]">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider">How to pay</p>
        {custom ? <p className="whitespace-pre-line">{custom}</p> : (
          <ul className="space-y-0.5">{lines.map(([h, b]) => <li key={h}><b>{h}:</b> {b}</li>)}</ul>
        )}
        <p className="mt-1">Payment reference: <b>{ref}</b>{settings?.phone ? <> · Bursary: {settings.phone}</> : null}</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {custom && <p className="whitespace-pre-line text-slate-600 dark:text-slate-300">{custom}</p>}
      {lines.map(([h, b]) => (
        <div key={h} className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.03]">
          <p className="font-semibold text-slate-800 dark:text-slate-100">{h}</p>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">{b}</p>
        </div>
      ))}
      <p className="text-slate-600 dark:text-slate-300">Reference: <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-bold text-slate-700 dark:bg-white/[0.06] dark:text-slate-200">{ref}</span></p>
    </div>
  );
};

const docCell = 'border border-slate-400 px-2 py-1.5';

export const BillTo: React.FC<{ student?: Student; cls?: SchoolClass }> = ({ student, cls }) => {
  const g = student?.guardians?.[0];
  return (
    <div className="text-[12px]">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Bill to</p>
      <p className="mt-0.5 text-[14px] font-bold">{fullName(student)}</p>
      <p>Adm No. {student?.admissionNo} · {cls?.name ?? ''}{student?.boarding === 'boarder' ? ' · Boarder' : ''}</p>
      {g && <p className="mt-1">c/o {g.name} ({g.relation}) · {g.phone}{g.email ? ` · ${g.email}` : ''}</p>}
      {student?.address && <p>{student.address}</p>}
    </div>
  );
};

export const InvoiceDoc: React.FC<{ inv: Invoice; student?: Student; cls?: SchoolClass; settings?: SchoolSettings; paid: number }> = ({ inv, student, cls, settings, paid }) => {
  const sub = sum(inv.items.map((i) => i.amount));
  const bal = inv.total - paid;
  return (
    <Paper>
      <Letterhead settings={settings} title="Invoice" />
      <div className="mb-4 flex flex-wrap justify-between gap-4">
        <BillTo student={student} cls={cls} />
        <table className="text-[12px]">
          <tbody>
            {([['Invoice No.', inv.invoiceNo], ['Term', termById(settings, inv.termId)?.name ?? inv.termId], ['Issued', fmtDate(inv.issuedDate)], ['Due date', fmtDate(inv.dueDate)]] as const).map(([k, v]) => (
              <tr key={k}><td className="pr-3 font-semibold text-slate-600 dark:text-slate-300">{k}</td><td className="text-right font-bold">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="bg-slate-100"><th className={cx(docCell, 'w-10 text-left')}>#</th><th className={cx(docCell, 'text-left')}>Description</th><th className={cx(docCell, 'w-32 text-right')}>Amount</th></tr></thead>
        <tbody>
          {inv.items.map((it, i) => (
            <tr key={i}><td className={docCell}>{i + 1}</td><td className={docCell}>{it.name}</td><td className={cx(docCell, 'text-right tabular-nums')}>{money(it.amount)}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td className={cx(docCell, 'text-right font-semibold')} colSpan={2}>Subtotal</td><td className={cx(docCell, 'text-right tabular-nums')}>{money(sub)}</td></tr>
          {!!inv.discount && <tr><td className={cx(docCell, 'text-right font-semibold')} colSpan={2}>Discount{inv.note ? ` — ${inv.note}` : ''}</td><td className={cx(docCell, 'text-right tabular-nums')}>−{money(inv.discount)}</td></tr>}
          <tr className="bg-slate-50"><td className={cx(docCell, 'text-right font-bold uppercase')} colSpan={2}>Total due</td><td className={cx(docCell, 'text-right font-bold tabular-nums')}>{money(inv.total)}</td></tr>
          <tr><td className={cx(docCell, 'text-right font-semibold')} colSpan={2}>Paid to date</td><td className={cx(docCell, 'text-right tabular-nums')}>{money(paid)}</td></tr>
          <tr className="bg-slate-100"><td className={cx(docCell, 'text-right text-[13px] font-bold uppercase')} colSpan={2}>Balance</td><td className={cx(docCell, 'text-right text-[13px] font-bold tabular-nums')}>{money(bal)}</td></tr>
        </tfoot>
      </table>
      {inv.note && !inv.discount && <p className="mt-2 text-[11px] italic">Note: {inv.note}</p>}
      <div className="mt-5"><PaymentInstructions settings={settings} admissionNo={student?.admissionNo} doc /></div>
      <p className="mt-6 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-600 dark:text-slate-300">All fees are payable in US dollars. Thank you for your prompt payment. · Printed {fmtDate(todayISO())}</p>
    </Paper>
  );
};

export const ReceiptDoc: React.FC<{ p: Payment; student?: Student; cls?: SchoolClass; settings?: SchoolSettings; balanceAfter: number; receivedBy: string }> = ({ p, student, cls, settings, balanceAfter, receivedBy }) => (
  <Paper className="border-b border-dashed border-slate-400 pb-10 print:pb-6">
    <Letterhead settings={settings} title="Official receipt" compact />
    <div className="mb-3 flex flex-wrap justify-between gap-2 text-[12px]">
      <p>Receipt No. <b className="text-[14px]">{p.receiptNo}</b></p>
      <p>Date: <b>{fmtDate(p.date)}</b></p>
    </div>
    <table className="w-full border-collapse text-[12px]">
      <tbody>
        <tr><td className={cx(docCell, 'w-40 font-semibold')}>Received from</td><td className={cx(docCell, 'font-bold')}>{student?.guardians?.[0]?.name ? `${student.guardians[0].name} on behalf of ` : ''}{fullName(student)}</td></tr>
        <tr><td className={cx(docCell, 'font-semibold')}>Admission No. / Class</td><td className={docCell}>{student?.admissionNo} · {cls?.name ?? ''}</td></tr>
        <tr><td className={cx(docCell, 'font-semibold')}>The sum of</td><td className={cx(docCell, 'italic')}>{amountInWords(p.amount)}</td></tr>
        <tr><td className={cx(docCell, 'font-semibold')}>Being payment for</td><td className={docCell}>School fees — {termById(settings, p.termId)?.name ?? p.termId}{p.note ? ` (${p.note})` : ''}</td></tr>
        <tr><td className={cx(docCell, 'font-semibold')}>Payment method</td><td className={docCell}>{p.method}{p.reference ? ` · Ref: ${p.reference}` : ''}</td></tr>
      </tbody>
    </table>
    <div className="mt-3 flex flex-wrap items-stretch justify-between gap-4">
      <div className="flex items-center gap-3 border-2 border-slate-800 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider">Amount</span>
        <span className="text-[20px] font-bold tabular-nums">{money(p.amount)}</span>
      </div>
      <div className="text-right text-[12px]">
        <p>Balance after this payment ({termById(settings, p.termId)?.name ?? p.termId}):</p>
        <p className="text-[15px] font-bold">{balanceAfter <= EPS ? (balanceAfter < -EPS ? `${money(-balanceAfter)} credit` : 'Fully paid — $0.00') : money(balanceAfter)}</p>
      </div>
    </div>
    <div className="mt-8 grid grid-cols-2 gap-8 text-[11px]">
      <div><div className="h-6 border-b border-slate-800" /><p className="mt-1">Received by: <b>{receivedBy}</b></p></div>
      <div><div className="flex h-6 items-end justify-center border-b border-dashed border-slate-500 text-[9px] uppercase tracking-widest text-slate-400">Official stamp</div><p className="mt-1">Signature &amp; stamp</p></div>
    </div>
    <p className="mt-4 text-center text-[10px] text-slate-600 dark:text-slate-300">This receipt is valid only when issued from the school system. Keep it for your records.</p>
  </Paper>
);

export interface StatementEntry { date: string; kind: 'invoice' | 'payment'; ref: string; desc: string; debit: number; credit: number }

export function statementEntries(sid: string, invoices: Invoice[], payments: Payment[], settings?: SchoolSettings, termId?: string): StatementEntry[] {
  const inScope = (t: string) => !termId || termId === 'all' || t === termId;
  const e: StatementEntry[] = [
    ...invoices.filter((i) => i.studentId === sid && inScope(i.termId)).map((i): StatementEntry => ({
      date: i.issuedDate, kind: 'invoice', ref: i.invoiceNo, desc: `Fees invoice — ${termById(settings, i.termId)?.name ?? i.termId}${i.discount ? ` (less discount ${money(i.discount)})` : ''}`, debit: i.total, credit: 0,
    })),
    ...payments.filter((p) => p.studentId === sid && inScope(p.termId)).map((p): StatementEntry => ({
      date: p.date, kind: 'payment', ref: p.receiptNo, desc: `Payment — ${p.method}${p.reference ? ` (${p.reference})` : ''}`, debit: 0, credit: p.amount,
    })),
  ];
  return e.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'invoice' ? -1 : 1) || a.ref.localeCompare(b.ref));
}

export const StatementDoc: React.FC<{ student?: Student; cls?: SchoolClass; settings?: SchoolSettings; entries: StatementEntry[]; scopeLabel: string }> = ({ student, cls, settings, entries, scopeLabel }) => {
  let run = 0;
  const debit = sum(entries.map((e) => e.debit)), credit = sum(entries.map((e) => e.credit));
  return (
    <Paper>
      <Letterhead settings={settings} title="Statement" />
      <div className="mb-4 flex flex-wrap justify-between gap-4">
        <BillTo student={student} cls={cls} />
        <table className="text-[12px]"><tbody>
          <tr><td className="pr-3 font-semibold text-slate-600 dark:text-slate-300">Statement date</td><td className="text-right font-bold">{fmtDate(todayISO())}</td></tr>
          <tr><td className="pr-3 font-semibold text-slate-600 dark:text-slate-300">Period</td><td className="text-right font-bold">{scopeLabel}</td></tr>
        </tbody></table>
      </div>
      <table className="w-full border-collapse text-[11.5px]">
        <thead><tr className="bg-slate-100">
          <th className={cx(docCell, 'w-24 text-left')}>Date</th><th className={cx(docCell, 'w-28 text-left')}>Reference</th><th className={cx(docCell, 'text-left')}>Description</th>
          <th className={cx(docCell, 'w-24 text-right')}>Charges</th><th className={cx(docCell, 'w-24 text-right')}>Payments</th><th className={cx(docCell, 'w-24 text-right')}>Balance</th>
        </tr></thead>
        <tbody>
          {entries.map((e, i) => {
            run += e.debit - e.credit;
            return (
              <tr key={i}>
                <td className={docCell}>{fmtDate(e.date)}</td><td className={cx(docCell, 'font-mono text-[10.5px]')}>{e.ref}</td><td className={docCell}>{e.desc}</td>
                <td className={cx(docCell, 'text-right tabular-nums')}>{e.debit ? money(e.debit) : ''}</td>
                <td className={cx(docCell, 'text-right tabular-nums')}>{e.credit ? money(e.credit) : ''}</td>
                <td className={cx(docCell, 'text-right font-semibold tabular-nums')}>{money(run)}</td>
              </tr>
            );
          })}
          {!entries.length && <tr><td colSpan={6} className={cx(docCell, 'text-center italic')}>No transactions.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100">
            <td className={cx(docCell, 'text-right font-bold uppercase')} colSpan={3}>Totals / balance due</td>
            <td className={cx(docCell, 'text-right font-bold tabular-nums')}>{money(debit)}</td>
            <td className={cx(docCell, 'text-right font-bold tabular-nums')}>{money(credit)}</td>
            <td className={cx(docCell, 'text-right text-[13px] font-bold tabular-nums')}>{money(debit - credit)}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-5"><PaymentInstructions settings={settings} admissionNo={student?.admissionNo} doc /></div>
      <p className="mt-6 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-600 dark:text-slate-300">Please contact the bursary{settings?.phone ? ` on ${settings.phone}` : ''} if you have any queries regarding this statement.</p>
    </Paper>
  );
};

// ============================================================================
// Page
// ============================================================================
interface FinData {
  settings?: SchoolSettings;
  students: Student[];
  studentIdx: Map<string, Student>;
  classIdx: Map<string, SchoolClass>;
  classes: SchoolClass[];
  staffIdx: Map<string, Staff>;
  invoices: Invoice[];
  payments: Payment[];
  structures: FeeStructure[];
  alloc: Map<string, number>;
  terms: Term[];
  /** billed & paid per `${studentId}|${termId}` */
  st: Map<string, { billed: number; paid: number }>;
}

type TabId = 'overview' | 'structures' | 'billing' | 'payments' | 'balances';

export default function Finance() {
  const settings = useSettings();
  const { data: students, loading: l1 } = useCollection('students');
  const { data: invoices, loading: l2 } = useCollection('invoices');
  const { data: payments, loading: l3 } = useCollection('payments');
  const { data: structures } = useCollection('feeStructures');
  const { data: classArr } = useCollection('classes');
  const classIdx = useIndex('classes');
  const staffIdx = useIndex('staff');
  const [tab, setTab] = useState<TabId>('overview');
  const printer = usePrinter();

  const D: FinData = useMemo(() => {
    const st = new Map<string, { billed: number; paid: number }>();
    const get = (k: string) => st.get(k) ?? st.set(k, { billed: 0, paid: 0 }).get(k)!;
    invoices.forEach((i) => { get(`${i.studentId}|${i.termId}`).billed += i.total; });
    payments.forEach((p) => { get(`${p.studentId}|${p.termId}`).paid += p.amount; });
    return {
      settings, students, studentIdx: new Map(students.map((s) => [s.id, s])), classIdx, classes: [...classArr].sort(classSort), staffIdx,
      invoices, payments, structures, alloc: allocatePayments(invoices, payments), terms: settings?.terms ?? [], st,
    };
  }, [settings, students, classIdx, classArr, staffIdx, invoices, payments, structures]);

  const [payOpen, setPayOpen] = useState(false);
  const canPay = useCan('payments');

  return (
    <div>
      <div className="no-print">
        <PageHeader eyebrow="Finance" title="Fees & finance" subtitle="Billing, collections and debtors — all amounts in USD."
          actions={canPay && <Button variant="secondary" icon={<Plus size={16} />} onClick={() => setPayOpen(true)}>Record payment</Button>} />
        <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'structures', label: 'Fee structures' },
          { id: 'billing', label: 'Billing' },
          { id: 'payments', label: 'Payments' },
          { id: 'balances', label: 'Balances' },
        ]} />
        {l1 || l2 || l3 ? <Spinner /> : (
          <>
            {tab === 'overview' && <Overview D={D} />}
            {tab === 'structures' && <Structures D={D} />}
            {tab === 'billing' && <Billing D={D} print={printer.print} />}
            {tab === 'payments' && <Payments D={D} print={printer.print} onRecord={() => setPayOpen(true)} />}
            {tab === 'balances' && <Balances D={D} print={printer.print} />}
          </>
        )}
      </div>
      <RecordPayment open={payOpen} onClose={() => setPayOpen(false)} D={D} print={printer.print} />
      {printer.host}
    </div>
  );
}

// ------------------------------------------------------------- helpers ------
const TermSelect: React.FC<{ D: FinData; value: string; onChange: (v: string) => void; allowAll?: boolean; className?: string }> = ({ D, value, onChange, allowAll, className }) => (
  <Select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
    {allowAll && <option value="all">All terms</option>}
    {D.terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === D.settings?.currentTermId ? ' (current)' : ''}</option>)}
  </Select>
);

const useDefaultTerm = (D: FinData) => {
  const [t, setT] = useState('');
  useEffect(() => { if (!t && D.settings) setT(currentTerm(D.settings)?.id ?? ''); }, [D.settings, t]);
  return [t, setT] as const;
};

const moneyTick = (v: number) => (Math.abs(v) >= 1000 ? `$${round1(v / 1000)}k` : `$${v}`);
const tipStyle = { borderRadius: 12, fontSize: 12, border: '1px solid #dfe5e2' };
const axisTick = { fill: '#8f9f97', fontSize: 11 };

const weekStart = (iso: string) => {
  const d = parseISO(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
};

function receiptProps(D: FinData, p: Payment) {
  const list = D.payments.filter((x) => x.studentId === p.studentId && x.termId === p.termId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.receiptNo.localeCompare(b.receiptNo));
  const idx = list.findIndex((x) => x.id === p.id);
  const paidUpTo = sum(list.slice(0, idx < 0 ? list.length : idx + 1).map((x) => x.amount)) + (idx < 0 ? p.amount : 0);
  const billed = D.st.get(`${p.studentId}|${p.termId}`)?.billed ?? 0;
  const student = D.studentIdx.get(p.studentId);
  const rb = p.receivedBy ? D.staffIdx.get(p.receivedBy) : undefined;
  return { p, student, cls: student ? D.classIdx.get(student.classId) : undefined, settings: D.settings, balanceAfter: billed - paidUpTo, receivedBy: rb ? staffName(rb) : p.receivedBy ?? '—' };
}

// ============================================================ Overview ======
function Overview({ D }: { D: FinData }) {
  const [termId, setTermId] = useDefaultTerm(D);
  const invs = D.invoices.filter((i) => i.termId === termId);
  const pays = D.payments.filter((p) => p.termId === termId);
  const billed = sum(invs.map((i) => i.total));
  const collected = sum(pays.map((p) => p.amount));

  const perStudent = useMemo(() => {
    const ids = new Set([...invs.map((i) => i.studentId), ...pays.map((p) => p.studentId)]);
    return [...ids].map((sid) => ({ sid, ...(D.st.get(`${sid}|${termId}`) ?? { billed: 0, paid: 0 }) }));
  }, [invs, pays, D.st, termId]);
  const outstanding = sum(perStudent.map((x) => Math.max(0, x.billed - x.paid)));
  const counts = { paid: 0, partial: 0, unpaid: 0 };
  perStudent.forEach((x) => { const s = statusOf(x.billed, x.paid); if (s !== 'none') counts[s]++; });

  const weekly = useMemo(() => {
    if (!pays.length) return [];
    const m = new Map<string, number>();
    pays.forEach((p) => { const w = weekStart(p.date); m.set(w, (m.get(w) ?? 0) + p.amount); });
    const keys = [...m.keys()].sort();
    const out: { week: string; label: string; amount: number }[] = [];
    for (let w = keys[0]!; w <= keys[keys.length - 1]!; w = addDays(w, 7)) out.push({ week: w, label: fmtDate(w, { day: 'numeric', month: 'short' }), amount: round1(m.get(w) ?? 0) });
    return out;
  }, [pays]);

  const byMethod = PAYMENT_METHODS.map((m) => ({ method: m, amount: round1(sum(pays.filter((p) => p.method === m).map((p) => p.amount))) })).filter((x) => x.amount > 0);

  const byClass = useMemo(() => {
    const m = new Map<string, number>();
    perStudent.forEach((x) => {
      const bal = x.billed - x.paid;
      if (bal <= EPS) return;
      const cid = D.studentIdx.get(x.sid)?.classId ?? '';
      m.set(cid, (m.get(cid) ?? 0) + bal);
    });
    return D.classes.filter((c) => m.has(c.id)).map((c) => ({ name: c.name, amount: round1(m.get(c.id)!) }));
  }, [perStudent, D]);

  const recent = [...pays].sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo)).slice(0, 8);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <TermSelect D={D} value={termId} onChange={setTermId} className="sm:w-60" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total billed" value={money(billed)} sub={`${invs.length} invoices`} icon={<FileText size={18} />} />
        <StatCard label="Collected" value={money(collected)} sub={`${pays.length} payments`} icon={<Wallet size={18} />} tone="green" />
        <StatCard label="Outstanding" value={money(outstanding)} sub={`${counts.partial + counts.unpaid} students owing`} icon={<Banknote size={18} />} tone="rose" />
        <StatCard label="Collection rate" value={pct(billed ? (collected / billed) * 100 : null, 1)} icon={<TrendingUp size={18} />} tone="violet" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {([['Fully paid', counts.paid, 'text-brand-600 dark:text-brand-400', 'bg-brand-500'], ['Partially paid', counts.partial, 'text-marigold-600 dark:text-marigold-400', 'bg-marigold-500'], ['Unpaid', counts.unpaid, 'text-rose-600 dark:text-rose-400', 'bg-rose-500']] as const).map(([l, n, c, bg]) => {
          const total = counts.paid + counts.partial + counts.unpaid;
          return (
            <div key={l} className="card p-4">
              <div className="flex items-baseline justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{l}</p><p className={cx('text-2xl font-bold', c)}>{n}</p></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className={cx('h-full rounded-full', bg)} style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></div>
              <p className="mt-1 text-[11px] text-slate-400">{pct(total ? (n / total) * 100 : null)} of billed students</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Collections by week" subtitle="Week starting (Mon)" className="lg:col-span-2">
          {weekly.length ? (
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weekly} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs><linearGradient id="finArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a04c" stopOpacity={0.3} /><stop offset="100%" stopColor="#16a04c" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} minTickGap={16} />
                <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={moneyTick} />
                <Tooltip contentStyle={tipStyle} formatter={(v: any) => [money(v), 'Collected']} labelFormatter={(l: any) => `Week of ${l}`} />
                <Area type="monotone" dataKey="amount" stroke="#0e833e" strokeWidth={2} fill="url(#finArea)" activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer></div>
          ) : <EmptyState title="No payments this term" />}
        </Card>
        <Card title="By payment method">
          {byMethod.length ? (
            <div className="h-64"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMethod} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
                <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={moneyTick} />
                <YAxis type="category" dataKey="method" tickLine={false} axisLine={false} tick={axisTick} width={86} />
                <Tooltip cursor={{ fill: 'rgba(148,163,184,.12)' }} contentStyle={tipStyle} formatter={(v: any) => [money(v), 'Collected']} />
                <Bar dataKey="amount" fill="#16a04c" radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer></div>
          ) : <EmptyState title="No payments" />}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Outstanding by class" className="lg:col-span-2">
          {byClass.length ? (
            <div style={{ height: Math.max(200, byClass.length * 28 + 30) }}><ResponsiveContainer width="100%" height="100%">
              <BarChart data={byClass} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-slate-200 dark:text-white/10" />
                <XAxis type="number" tickLine={false} axisLine={false} tick={axisTick} tickFormatter={moneyTick} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} tick={axisTick} width={90} interval={0} />
                <Tooltip cursor={{ fill: 'rgba(148,163,184,.12)' }} contentStyle={tipStyle} formatter={(v: any) => [money(v), 'Outstanding']} />
                <Bar dataKey="amount" fill="#f43f5e" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer></div>
          ) : <EmptyState title="Nothing outstanding" body="Every billed student has paid in full." icon={<Check size={22} />} />}
        </Card>
        <Card title="Recent payments" bodyClass="p-0">
          {recent.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              {recent.map((p) => {
                const s = D.studentIdx.get(p.studentId);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar name={fullName(s)} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{fullName(s)}</p>
                      <p className="text-xs text-slate-400">{fmtDate(p.date)} · {p.method}</p>
                    </div>
                    <p className="text-sm font-bold tabular-nums text-brand-600 dark:text-brand-400">{money(p.amount)}</p>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState title="No payments yet" />}
        </Card>
      </div>
    </div>
  );
}

// ========================================================== Structures ======
function Structures({ D }: { D: FinData }) {
  const { toast, confirm } = useUI();
  const can = useCan('feeStructures');
  const [termId, setTermId] = useDefaultTerm(D);
  const [edit, setEdit] = useState<Partial<FeeStructure> | null>(null);
  const [copy, setCopy] = useState<FeeStructure | null>(null);
  const list = D.structures.filter((s) => termId === 'all' || s.termId === termId)
    .sort((a, b) => (LEVELS.find((l) => l.level === a.levels[0])?.order ?? 99) - (LEVELS.find((l) => l.level === b.levels[0])?.order ?? 99) || a.name.localeCompare(b.name));

  const del = async (s: FeeStructure) => {
    if (!(await confirm({ title: `Delete "${s.name}"?`, body: 'Existing invoices are not affected.', confirmText: 'Delete', danger: true }))) return;
    await store.remove('feeStructures', s.id);
    toast('Fee structure deleted.');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TermSelect D={D} value={termId} onChange={setTermId} allowAll className="sm:w-60" />
        {can && <Button icon={<Plus size={16} />} onClick={() => setEdit({ name: '', termId: termId === 'all' ? D.settings?.currentTermId : termId, levels: [], boarding: 'all', items: [{ name: 'Tuition', amount: 0 }] })}>New fee structure</Button>}
      </div>
      {!list.length ? <Card><EmptyState title="No fee structures" body="Create fee structures to generate invoices for a term." /></Card> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <div key={s.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-slate-900 dark:text-white">{s.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{termById(D.settings, s.termId)?.name ?? s.termId}</p>
                </div>
                <Badge tone={s.boarding === 'boarder' ? 'violet' : s.boarding === 'day' ? 'sky' : 'slate'}>{s.boarding === 'boarder' ? 'Boarders' : s.boarding === 'day' ? 'Day scholars' : 'All learners'}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">{s.levels.map((l) => <Badge key={l} tone="blue">{l}</Badge>)}</div>
              <ul className="mt-4 flex-1 space-y-1 text-sm">
                {s.items.map((i, k) => <li key={k} className="flex justify-between gap-2 text-slate-600 dark:text-slate-300"><span>{i.name}</span><span className="tabular-nums">{money(i.amount)}</span></li>)}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">{money(sum(s.items.map((i) => i.amount)))}</span>
                {can && <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEdit(s)} aria-label="Edit" />
                  <Button size="sm" variant="ghost" icon={<Copy size={14} />} onClick={() => setCopy(s)}>Copy to term</Button>
                  <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" icon={<Trash2 size={14} />} onClick={() => del(s)} aria-label="Delete" />
                </div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <StructureModal D={D} value={edit} onClose={() => setEdit(null)} />
      <CopyModal D={D} src={copy} onClose={() => setCopy(null)} />
    </div>
  );
}

function StructureModal({ D, value, onClose }: { D: FinData; value: Partial<FeeStructure> | null; onClose: () => void }) {
  const { toast } = useUI();
  const settings = useSettings();
  const [f, setF] = useState<Partial<FeeStructure>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (value) setF({ ...value, items: value.items?.map((i) => ({ ...i })) ?? [], levels: [...(value.levels ?? [])] }); }, [value]);
  const items = f.items ?? [];
  const levels = f.levels ?? [];
  const toggle = (l: string) => setF({ ...f, levels: levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l] });
  const setItem = (i: number, patch: Partial<FeeItem>) => setF({ ...f, items: items.map((it, k) => (k === i ? { ...it, ...patch } : it)) });
  const valid = !!f.name?.trim() && !!f.termId && levels.length > 0 && items.length > 0 && items.every((i) => i.name.trim() && i.amount >= 0);
  const save = async () => {
    setBusy(true);
    try {
      const data: FeeStructure = {
        ...(f as FeeStructure), id: f.id ?? newId(), name: f.name!.trim(), termId: f.termId!,
        levels: LEVELS.map((l) => l.level).filter((l) => levels.includes(l)), boarding: f.boarding ?? 'all',
        items: items.map((i) => ({ name: i.name.trim(), amount: Number(i.amount) || 0 })),
      };
      await store.set('feeStructures', data);
      toast(f.id ? 'Fee structure updated.' : 'Fee structure created.');
      onClose();
    } catch (e: any) { toast(e.message, 'error'); }
    setBusy(false);
  };
  return (
    <Modal open={!!value} onClose={onClose} title={f.id ? 'Edit fee structure' : 'New fee structure'} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!valid}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2"><Input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. O-Level day fees — Term 1 2027" /></Field>
        <Field label="Term" required><TermSelect D={D} value={f.termId ?? ''} onChange={(v) => setF({ ...f, termId: v })} /></Field>
        <Field label="Applies to">
          <div className="pt-0.5"><Segmented value={f.boarding ?? 'all'} onChange={(v) => setF({ ...f, boarding: v })}
            options={[{ id: 'all', label: 'All' }, { id: 'day', label: 'Day' }, { id: 'boarder', label: 'Boarders' }]} /></div>
        </Field>
        <div className="sm:col-span-2">
          <span className="label">Levels <span className="text-rose-500 dark:text-rose-300">*</span></span>
          {(['primary', 'secondary'] as const).filter((sec) => !settings?.schoolType || settings.schoolType === sec).map((sec) => {
            const ls = LEVELS.filter((l) => l.section === sec);
            const all = ls.every((l) => levels.includes(l.level));
            return (
              <div key={sec} className="mb-2">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-semibold capitalize text-slate-500 dark:text-slate-400">{sec}</span>
                  <button type="button" className="link text-xs" onClick={() => setF({ ...f, levels: all ? levels.filter((x) => !ls.some((l) => l.level === x)) : [...new Set([...levels, ...ls.map((l) => l.level)])] })}>{all ? 'Clear' : 'Select all'}</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ls.map((l) => (
                    <button type="button" key={l.level} onClick={() => toggle(l.level)}
                      className={cx('rounded-lg border px-2.5 py-1 text-xs font-semibold transition', levels.includes(l.level)
                        ? 'border-slate-200 bg-slate-100 text-slate-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200'
                        : 'border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/5')}>
                      {l.level}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sm:col-span-2">
          <span className="label">Line items</span>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2">
                <Input className="flex-1" value={it.name} placeholder="Item" onChange={(e) => setItem(i, { name: e.target.value })} />
                <div className="relative w-32"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <Input className="pl-6 text-right" type="number" min={0} step="0.01" value={it.amount} onChange={(e) => setItem(i, { amount: Number(e.target.value) })} /></div>
                <Button variant="ghost" icon={<X size={16} />} onClick={() => setF({ ...f, items: items.filter((_, k) => k !== i) })} aria-label="Remove" />
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => setF({ ...f, items: [...items, { name: '', amount: 0 }] })}>Add item</Button>
            <p className="text-sm">Total <b className="text-lg tabular-nums">{money(sum(items.map((i) => Number(i.amount) || 0)))}</b></p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CopyModal({ D, src, onClose }: { D: FinData; src: FeeStructure | null; onClose: () => void }) {
  const { toast } = useUI();
  const [termId, setTermId] = useState('');
  const [name, setName] = useState('');
  useEffect(() => {
    if (!src) return;
    const other = D.terms.find((t) => t.start > (termById(D.settings, src.termId)?.start ?? '')) ?? D.terms.find((t) => t.id !== src.termId);
    setTermId(other?.id ?? src.termId);
  }, [src, D.terms, D.settings]);
  useEffect(() => {
    if (!src) return;
    const from = termById(D.settings, src.termId)?.name, to = termById(D.settings, termId)?.name;
    setName(from && to && src.name.includes(from) ? src.name.replace(from, to) : src.name);
  }, [src, termId, D.settings]);
  const exists = !!src && D.structures.some((s) => s.termId === termId && s.name === name);
  const go = async () => {
    if (!src) return;
    const { id, createdAt, updatedAt, ...rest } = src;
    await store.add('feeStructures', { ...rest, id: newId(), termId, name, items: src.items.map((i) => ({ ...i })) });
    toast(`Copied to ${termById(D.settings, termId)?.name}.`);
    onClose();
  };
  return (
    <Modal open={!!src} onClose={onClose} title="Copy fee structure to term" size="sm"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={!termId || !name.trim() || termId === src?.termId}>Copy</Button></>}>
      <div className="space-y-4">
        <Field label="Target term"><TermSelect D={D} value={termId} onChange={setTermId} /></Field>
        <Field label="New name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {exists && <p className="text-xs text-marigold-600 dark:text-marigold-400">A structure with this name already exists in that term.</p>}
      </div>
    </Modal>
  );
}

// ============================================================= Billing ======
function Billing({ D, print }: { D: FinData; print: (n: React.ReactNode) => void }) {
  const { toast, confirm } = useUI();
  const can = useCan('invoices');
  const [termId, setTermId] = useDefaultTerm(D);
  const term = termById(D.settings, termId);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    const has = new Set(D.invoices.filter((i) => i.termId === termId).map((i) => i.studentId));
    const structs = D.structures.filter((s) => s.termId === termId);
    const out: { s: Student; items: FeeItem[]; structureId?: string; total: number }[] = [];
    let skipped = 0, noStruct = 0;
    for (const s of D.students) {
      if (s.status !== 'active') continue;
      if (has.has(s.id)) { skipped++; continue; }
      const c = D.classIdx.get(s.classId);
      const b = s.boarding ?? 'day';
      const app = structs.filter((f) => c && f.levels.includes(c.level) && ((f.boarding ?? 'all') === 'all' || f.boarding === b));
      if (!app.length) { noStruct++; continue; }
      const items = app.flatMap((f) => f.items.map((i) => ({ ...i })));
      out.push({ s, items, structureId: app[0]!.id, total: sum(items.map((i) => i.amount)) });
    }
    return { out, skipped, noStruct, total: sum(out.map((x) => x.total)) };
  }, [D, termId]);

  const generate = async () => {
    if (!term || !preview.out.length) return;
    if (!(await confirm({ title: `Generate ${preview.out.length} invoices?`, body: `Total ${money(preview.total)} for ${term.name}. Due ${fmtDate(addDays(term.start, 14))}.`, confirmText: 'Generate' }))) return;
    setBusy(true);
    const prefix = `INV-${term.year}-`;
    let n = parseInt(nextNumber(D.invoices.map((i) => i.invoiceNo), prefix).slice(prefix.length), 10);
    const today = todayISO(), due = addDays(term.start, 14);
    const ops: WriteOp[] = preview.out.map((x) => {
      const id = newId();
      const inv: Invoice = { id, invoiceNo: `${prefix}${pad(n++)}`, studentId: x.s.id, termId, structureId: x.structureId, items: x.items, total: x.total, issuedDate: today, dueDate: due };
      return { op: 'set', col: 'invoices', id, data: inv };
    });
    try {
      for (let i = 0; i < ops.length; i += 400) await store.commit(ops.slice(i, i + 400));
      toast(`Generated ${ops.length} invoices.`);
    } catch (e: any) { toast(e.message, 'error'); }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3"><TermSelect D={D} value={termId} onChange={setTermId} className="sm:w-60" /></div>
      {can && (
        <Card title="Generate invoices" subtitle="Bills every active student from the term’s fee structures (by class level and day/boarding status).">
          <div className="grid gap-4 sm:grid-cols-4">
            <div><p className="label">To invoice</p><p className="text-2xl font-bold text-slate-900 dark:text-white">{preview.out.length}</p></div>
            <div><p className="label">Total</p><p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{money(preview.total)}</p></div>
            <div><p className="label">Already invoiced</p><p className="text-2xl font-bold text-slate-400">{preview.skipped}</p></div>
            <div><p className="label">No matching structure</p><p className={cx('text-2xl font-bold', preview.noStruct ? 'text-marigold-600 dark:text-marigold-400' : 'text-slate-400')}>{preview.noStruct}</p></div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" icon={<FilePlus2 size={16} />} loading={busy} disabled={!preview.out.length} onClick={generate}>Generate {preview.out.length || ''} invoices</Button>
            {term && <p className="text-xs text-slate-500 dark:text-slate-400">Issued today · due {fmtDate(addDays(term.start, 14))} (term start + 14 days)</p>}
          </div>
        </Card>
      )}
      <InvoicesTable D={D} termId={termId} print={print} />
    </div>
  );
}

function InvoicesTable({ D, termId, print }: { D: FinData; termId: string; print: (n: React.ReactNode) => void }) {
  const { toast, confirm } = useUI();
  const can = useCan('invoices');
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState<'' | PayStatus>('');
  const [view, setView] = useState<Invoice | null>(null);
  const [edit, setEdit] = useState<Invoice | null>(null);

  const rows = useMemo(() => D.invoices.filter((i) => i.termId === termId).map((inv) => {
    const s = D.studentIdx.get(inv.studentId);
    const paid = D.alloc.get(inv.id) ?? 0;
    return { inv, s, paid, bal: inv.total - paid, st: statusOf(inv.total, paid) };
  }).filter((r) => (!classId || r.s?.classId === classId) && (!status || r.st === status) && (!q || (r.s && studentMatches(r.s, q)) || r.inv.invoiceNo.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.inv.invoiceNo.localeCompare(b.inv.invoiceNo)), [D, termId, q, classId, status]);

  const [limit, setLimit] = useState(100);
  useEffect(() => setLimit(100), [termId, q, classId, status]);

  const del = async (inv: Invoice) => {
    if (!(await confirm({ title: `Delete invoice ${inv.invoiceNo}?`, body: 'Payments are kept and will show as credit on the student’s account.', confirmText: 'Delete', danger: true }))) return;
    await store.remove('invoices', inv.id);
    toast('Invoice deleted.');
  };

  const docFor = (inv: Invoice) => {
    const s = D.studentIdx.get(inv.studentId);
    return <InvoiceDoc inv={inv} student={s} cls={s ? D.classIdx.get(s.classId) : undefined} settings={D.settings} paid={D.alloc.get(inv.id) ?? 0} />;
  };

  return (
    <Card title="Invoices" subtitle={`${rows.length} invoice(s) · ${money(sum(rows.map((r) => r.inv.total)))} billed · ${money(sum(rows.map((r) => Math.max(0, r.bal))))} outstanding`} bodyClass="p-5 pt-3">
      <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_180px_160px]">
        <SearchInput value={q} onChange={setQ} placeholder="Search student, adm no, invoice no…" />
        <Select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{D.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="">Any status</option><option value="paid">Paid</option><option value="partial">Partial</option><option value="unpaid">Unpaid</option></Select>
      </div>
      {!rows.length ? <EmptyState title="No invoices" body="Generate invoices for this term or adjust the filters." /> : (
        <TableWrap>
          <thead><tr><th className="th">Invoice</th><th className="th">Student</th><th className="th">Class</th><th className="th text-right">Total</th><th className="th text-right">Paid</th><th className="th text-right">Balance</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody>
            {rows.slice(0, limit).map(({ inv, s, paid, bal, st }) => (
              <tr key={inv.id} className="tr tr-hover">
                <td className="td font-mono text-xs">{inv.invoiceNo}{!!inv.discount && <Badge tone="blue" className="ml-1.5">−{money(inv.discount)}</Badge>}</td>
                <td className="td"><p className="font-semibold text-slate-800 dark:text-slate-100">{fullName(s)}</p><p className="text-[11px] text-slate-400">{s?.admissionNo}</p></td>
                <td className="td text-slate-500 dark:text-slate-400">{s ? D.classIdx.get(s.classId)?.name : ''}</td>
                <td className="td text-right tabular-nums">{money(inv.total)}</td>
                <td className="td text-right tabular-nums text-brand-600 dark:text-brand-400">{money(paid)}</td>
                <td className={cx('td text-right font-semibold tabular-nums', bal > EPS ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400')}>{money(bal)}</td>
                <td className="td"><StatusBadge s={st} /></td>
                <td className="td whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" icon={<Eye size={14} />} onClick={() => setView(inv)} aria-label="View" />
                  {can && <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => setEdit(inv)} aria-label="Edit" />}
                  {can && <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" icon={<Trash2 size={14} />} onClick={() => del(inv)} aria-label="Delete" />}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {rows.length > limit && <div className="mt-3 text-center"><Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 200)}>Show more ({rows.length - limit})</Button></div>}
      <DocPreview open={!!view} title={view ? `Invoice ${view.invoiceNo}` : ''} onClose={() => setView(null)} onPrint={() => view && print(docFor(view))}>{view && docFor(view)}</DocPreview>
      <InvoiceEditModal inv={edit} onClose={() => setEdit(null)} />
    </Card>
  );
}

function InvoiceEditModal({ inv, onClose }: { inv: Invoice | null; onClose: () => void }) {
  const { toast } = useUI();
  const [items, setItems] = useState<FeeItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');
  const [discPct, setDiscPct] = useState('');
  useEffect(() => {
    if (!inv) return;
    setItems(inv.items.map((i) => ({ ...i }))); setDiscount(inv.discount ?? 0); setNote(inv.note ?? ''); setDue(inv.dueDate); setDiscPct('');
  }, [inv]);
  const sub = sum(items.map((i) => Number(i.amount) || 0));
  const total = Math.max(0, round2(sub - discount));
  const save = async () => {
    if (!inv) return;
    await store.update('invoices', inv.id, { items: items.map((i) => ({ name: i.name.trim(), amount: Number(i.amount) || 0 })), discount: discount || undefined, note: note.trim() || undefined, dueDate: due, total });
    toast('Invoice updated.');
    onClose();
  };
  return (
    <Modal open={!!inv} onClose={onClose} title={inv ? `Edit ${inv.invoiceNo}` : ''} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!items.length || items.some((i) => !i.name.trim()) || discount > sub}>Save</Button></>}>
      <div className="space-y-4">
        <div className="space-y-2">
          <span className="label">Items</span>
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <Input className="flex-1" value={it.name} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              <Input className="w-32 text-right" type="number" min={0} step="0.01" value={it.amount} onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, amount: Number(e.target.value) } : x)))} />
              <Button variant="ghost" icon={<X size={16} />} onClick={() => setItems(items.filter((_, k) => k !== i))} aria-label="Remove" />
            </div>
          ))}
          <Button size="sm" variant="outline" icon={<Plus size={14} />} onClick={() => setItems([...items, { name: '', amount: 0 }])}>Add item</Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Discount ($)"><Input type="number" min={0} step="0.01" value={discount} onChange={(e) => { setDiscount(Number(e.target.value) || 0); setDiscPct(''); }} /></Field>
          <Field label="…or discount %"><Input type="number" min={0} max={100} value={discPct} placeholder="e.g. 25" onChange={(e) => { setDiscPct(e.target.value); const p = Number(e.target.value); if (Number.isFinite(p)) setDiscount(round2((sub * p) / 100)); }} /></Field>
          <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Note" hint="Shown on the invoice, e.g. “Sibling discount (25%)”"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-6 rounded-xl bg-slate-50 p-3 text-sm dark:bg-white/[0.03]">
          <span>Subtotal <b className="tabular-nums">{money(sub)}</b></span>
          <span>Discount <b className="tabular-nums">−{money(discount)}</b></span>
          <span>Total <b className="text-base tabular-nums">{money(total)}</b></span>
        </div>
      </div>
    </Modal>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ============================================================ Payments ======
function RecordPayment({ open, onClose, D, print }: { open: boolean; onClose: () => void; D: FinData; print: (n: React.ReactNode) => void }) {
  const { profile } = useAuth();
  const { toast } = useUI();
  const [q, setQ] = useState('');
  const [sid, setSid] = useState('');
  const [termId, setTermId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Payment | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ(''); setSid(''); setAmount(''); setMethod('Cash'); setReference(''); setDate(todayISO()); setNote(''); setSaved(null);
    setTermId(currentTerm(D.settings)?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const bal = (id: string) => { const x = D.st.get(`${id}|${termId}`); return x ? x.billed - x.paid : 0; };
  const matches = useMemo(() => (q.trim().length < 1 ? [] : D.students.filter((s) => studentMatches(s, q.trim())).slice(0, 8)), [q, D.students]);
  const student = D.studentIdx.get(sid);
  const amt = Number(amount);
  const valid = !!student && !!termId && Number.isFinite(amt) && amt > 0 && !!date;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    const year = date.slice(0, 4);
    const receiptNo = nextNumber(D.payments.map((p) => p.receiptNo), `RCT-${year}-`);
    const p: Payment = {
      id: newId(), receiptNo, studentId: sid, termId, amount: round2(amt), method, reference: reference.trim() || undefined, date,
      receivedBy: profile?.staffId ?? profile?.name, note: note.trim() || undefined,
    };
    try {
      await store.set('payments', p);
      setSaved(p);
      toast(`Payment ${receiptNo} recorded.`);
    } catch (e: any) { toast(e.message, 'error'); }
    setBusy(false);
  };

  const receipt = saved && <ReceiptDoc {...receiptProps(D, saved)} />;

  return (
    <Modal open={open} onClose={onClose} title={saved ? 'Payment recorded' : 'Record payment'} size={saved ? 'xl' : 'md'}
      footer={saved ? <>
        <Button variant="outline" onClick={onClose}>Done</Button>
        <Button variant="outline" icon={<Plus size={16} />} onClick={() => { setSaved(null); setSid(''); setQ(''); setAmount(''); setReference(''); setNote(''); }}>Record another</Button>
        <Button icon={<Printer size={16} />} onClick={() => receipt && print(receipt)}>Print receipt</Button>
      </> : <>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="secondary" onClick={submit} loading={busy} disabled={!valid}>Save payment</Button>
      </>}>
      {saved ? (
        <div className="-mx-5 -my-5 bg-slate-200/70 p-3 sm:p-6 dark:bg-black/40"><div className="paper mx-auto max-w-[210mm] shadow-xl">{receipt}</div></div>
      ) : (
        <div className="space-y-4">
          <Field label="Student" required>
            {student ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-100 p-3 dark:border-white/10 dark:bg-white/[0.06]">
                <Avatar name={fullName(student)} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">{fullName(student)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{student.admissionNo} · {D.classIdx.get(student.classId)?.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">Balance</p>
                  <p className={cx('font-bold tabular-nums', bal(sid) > EPS ? 'text-rose-600 dark:text-rose-400' : 'text-brand-600 dark:text-brand-400')}>{money(bal(sid))}</p>
                </div>
                <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => setSid('')} aria-label="Change student" />
              </div>
            ) : (
              <div>
                <SearchInput value={q} onChange={setQ} placeholder="Type a name or admission number…" />
                {matches.length > 0 && (
                  <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-white/[0.05] dark:border-white/10">
                    {matches.map((s) => (
                      <li key={s.id}>
                        <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => { setSid(s.id); if (!amount && bal(s.id) > 0) setAmount(String(round2(bal(s.id)))); }}>
                          <Avatar name={fullName(s)} size={28} />
                          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{fullName(s)}</p><p className="text-[11px] text-slate-400">{s.admissionNo} · {D.classIdx.get(s.classId)?.name}{s.status !== 'active' ? ` · ${s.status}` : ''}</p></div>
                          <span className={cx('text-sm font-semibold tabular-nums', bal(s.id) > EPS ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400')}>{money(bal(s.id))}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Term" required><TermSelect D={D} value={termId} onChange={setTermId} /></Field>
            <Field label="Amount (USD)" required hint={student && amt > 0 ? `Balance after: ${money(bal(sid) - amt)}` : undefined}>
              <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Method" required><Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
            <Field label="Reference" hint={method === 'Cash' ? 'Optional for cash' : 'Bank / EcoCash transaction ID'}><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
            <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Payments({ D, print, onRecord }: { D: FinData; print: (n: React.ReactNode) => void; onRecord: () => void }) {
  const { profile } = useAuth();
  const { toast, confirm } = useUI();
  const isAdmin = profile?.role === 'admin';
  const canPay = useCan('payments');
  const [termId, setTermId] = useDefaultTerm(D);
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<Payment | null>(null);
  const [limit, setLimit] = useState(100);

  const rows = useMemo(() => D.payments.filter((p) => (termId === 'all' || p.termId === termId) && (!method || p.method === method)
    && (!from || p.date >= from) && (!to || p.date <= to)
    && (!q || p.receiptNo.toLowerCase().includes(q.toLowerCase()) || (p.reference ?? '').toLowerCase().includes(q.toLowerCase()) || (() => { const s = D.studentIdx.get(p.studentId); return !!s && studentMatches(s, q); })()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.receiptNo.localeCompare(a.receiptNo)), [D, termId, method, from, to, q]);
  useEffect(() => setLimit(100), [termId, method, from, to, q]);
  const total = sum(rows.map((p) => p.amount));

  const exportCSV = () => download(`payments_${termId}_${todayISO()}.csv`, toCSV(rows.map((p) => {
    const s = D.studentIdx.get(p.studentId);
    const r = receiptProps(D, p);
    return { Receipt: p.receiptNo, Date: p.date, 'Admission No': s?.admissionNo ?? '', Student: fullName(s), Class: s ? D.classIdx.get(s.classId)?.name ?? '' : '', Term: termById(D.settings, p.termId)?.name ?? p.termId, Method: p.method, Reference: p.reference ?? '', Amount: p.amount.toFixed(2), 'Received by': r.receivedBy, Note: p.note ?? '' };
  })));

  const voidPayment = async (p: Payment) => {
    if (!(await confirm({ title: `Void receipt ${p.receiptNo}?`, body: `This permanently deletes the ${money(p.amount)} payment and increases the student’s balance.`, confirmText: 'Void payment', danger: true }))) return;
    await store.remove('payments', p.id);
    toast('Payment voided.');
  };

  return (
    <Card title="Payments" subtitle={`${rows.length} payment(s) · ${money(total)}`}
      actions={<>
        <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={exportCSV} disabled={!rows.length}>Export CSV</Button>
        {canPay && <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={onRecord}>Record payment</Button>}
      </>} bodyClass="p-5 pt-3">
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_170px_150px_150px_150px]">
        <SearchInput value={q} onChange={setQ} placeholder="Student, receipt, reference…" />
        <TermSelect D={D} value={termId} onChange={setTermId} allowAll />
        <Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="">All methods</option>{PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}</Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To" />
      </div>
      {!rows.length ? <EmptyState title="No payments match" icon={<Receipt size={22} />} /> : (
        <TableWrap>
          <thead><tr><th className="th">Receipt</th><th className="th">Date</th><th className="th">Student</th><th className="th">Term</th><th className="th">Method</th><th className="th">Reference</th><th className="th text-right">Amount</th><th className="th" /></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((p) => {
              const s = D.studentIdx.get(p.studentId);
              return (
                <tr key={p.id} className="tr tr-hover">
                  <td className="td font-mono text-xs">{p.receiptNo}</td>
                  <td className="td whitespace-nowrap text-slate-500 dark:text-slate-400">{fmtDate(p.date)}</td>
                  <td className="td"><p className="font-semibold text-slate-800 dark:text-slate-100">{fullName(s)}</p><p className="text-[11px] text-slate-400">{s?.admissionNo} · {s ? D.classIdx.get(s.classId)?.name : ''}</p></td>
                  <td className="td whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">{termById(D.settings, p.termId)?.name ?? p.termId}</td>
                  <td className="td"><Badge tone={p.method === 'Cash' ? 'green' : p.method === 'EcoCash' || p.method === 'InnBucks' ? 'violet' : 'sky'}>{p.method}</Badge></td>
                  <td className="td font-mono text-xs text-slate-500 dark:text-slate-400">{p.reference ?? '—'}</td>
                  <td className="td text-right font-semibold tabular-nums">{money(p.amount)}</td>
                  <td className="td whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" icon={<Printer size={14} />} onClick={() => setView(p)} aria-label="Receipt" />
                    {isAdmin && <Button size="sm" variant="ghost" className="text-rose-600 dark:text-rose-400" icon={<Trash2 size={14} />} onClick={() => voidPayment(p)} aria-label="Void" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="tr"><td className="td font-bold" colSpan={6}>Total</td><td className="td text-right font-bold tabular-nums">{money(total)}</td><td /></tr></tfoot>
        </TableWrap>
      )}
      {rows.length > limit && <div className="mt-3 text-center"><Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 200)}>Show more ({rows.length - limit})</Button></div>}
      <DocPreview open={!!view} title={view ? `Receipt ${view.receiptNo}` : ''} onClose={() => setView(null)} onPrint={() => view && print(<ReceiptDoc {...receiptProps(D, view)} />)}>
        {view && <ReceiptDoc {...receiptProps(D, view)} />}
      </DocPreview>
    </Card>
  );
}

// ============================================================ Balances ======
export function reminderText(student: Student, balance: number, settings?: SchoolSettings, termName?: string, className?: string) {
  const g = student.guardians?.[0];
  return `Dear ${g?.name ?? 'Parent/Guardian'}, this is a friendly reminder from ${settings?.name ?? 'the school'} that the fees balance for ${student.firstName} ${student.lastName} (${student.admissionNo}${className ? `, ${className}` : ''})${termName ? ` for ${termName}` : ''} is ${money(balance)}. Kindly settle at your earliest convenience, using ${student.admissionNo} as the payment reference. If you have already paid, please disregard this message. Thank you. — Bursary${settings?.phone ? `, ${settings.phone}` : ''}`;
}

function Balances({ D, print }: { D: FinData; print: (n: React.ReactNode) => void }) {
  const { toast } = useUI();
  const [termId, setTermId] = useDefaultTerm(D);
  const [classId, setClassId] = useState('');
  const [owing, setOwing] = useState(true);
  const [q, setQ] = useState('');
  const [stmt, setStmt] = useState<Student | null>(null);
  const [limit, setLimit] = useState(100);
  const term = termById(D.settings, termId);

  const rows = useMemo(() => {
    const agg = new Map<string, { billed: number; paid: number }>();
    D.st.forEach((v, k) => {
      const [sid, tid] = k.split('|') as [string, string];
      if (termId !== 'all' && tid !== termId) return;
      const a = agg.get(sid) ?? { billed: 0, paid: 0 };
      a.billed += v.billed; a.paid += v.paid;
      agg.set(sid, a);
    });
    return D.students.filter((s) => s.status === 'active' || agg.has(s.id)).map((s) => {
      const a = agg.get(s.id) ?? { billed: 0, paid: 0 };
      return { s, ...a, bal: round2(a.billed - a.paid) };
    }).filter((r) => (!classId || r.s.classId === classId) && (!owing || r.bal > EPS) && (!q || studentMatches(r.s, q)))
      .sort((a, b) => b.bal - a.bal || a.s.lastName.localeCompare(b.s.lastName));
  }, [D, termId, classId, owing, q]);
  useEffect(() => setLimit(100), [termId, classId, owing, q]);

  const tot = { billed: sum(rows.map((r) => r.billed)), paid: sum(rows.map((r) => r.paid)), bal: sum(rows.map((r) => r.bal)) };
  const scopeLabel = termId === 'all' ? 'All terms' : term?.name ?? termId;

  const exportCSV = () => download(`balances_${termId}_${todayISO()}.csv`, toCSV(rows.map((r) => ({
    'Admission No': r.s.admissionNo, Student: fullName(r.s), Class: D.classIdx.get(r.s.classId)?.name ?? '', Guardian: r.s.guardians?.[0]?.name ?? '', Phone: r.s.guardians?.[0]?.phone ?? '',
    Billed: r.billed.toFixed(2), Paid: r.paid.toFixed(2), Balance: r.bal.toFixed(2),
  }))));

  const reminder = (r: { s: Student; bal: number }) => reminderText(r.s, r.bal, D.settings, termId === 'all' ? undefined : term?.name, D.classIdx.get(r.s.classId)?.name);
  const copyReminder = async (r: { s: Student; bal: number }) => {
    try { await navigator.clipboard.writeText(reminder(r)); toast('Reminder copied to clipboard.'); }
    catch { toast('Could not access the clipboard.', 'error'); }
  };

  const stmtDoc = (s: Student) => <StatementDoc student={s} cls={D.classIdx.get(s.classId)} settings={D.settings} entries={statementEntries(s.id, D.invoices, D.payments, D.settings, termId)} scopeLabel={scopeLabel} />;

  return (
    <Card title="Balances & debtors" subtitle={`${rows.length} student(s) · ${scopeLabel}`}
      actions={<Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={exportCSV} disabled={!rows.length}>Export CSV</Button>} bodyClass="p-5 pt-3">
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_170px_170px_auto] lg:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Search student…" />
        <TermSelect D={D} value={termId} onChange={setTermId} allowAll />
        <Select value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">All classes</option>{D.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" className="h-4 w-4 rounded accent-brand-600" checked={owing} onChange={(e) => setOwing(e.target.checked)} /> Only with balance
        </label>
      </div>
      <div className="mb-4 grid grid-cols-3 gap-3">
        {([['Billed', tot.billed, ''], ['Paid', tot.paid, 'text-brand-600 dark:text-brand-400'], ['Balance', tot.bal, 'text-rose-600 dark:text-rose-400']] as const).map(([l, v, c]) => (
          <div key={l} className="rounded-xl bg-slate-50 p-3 dark:bg-white/[0.03]"><p className="label">{l}</p><p className={cx('text-lg font-bold tabular-nums text-slate-900 dark:text-white', c)}>{money(v)}</p></div>
        ))}
      </div>
      {!rows.length ? <EmptyState title={owing ? 'No outstanding balances' : 'No students'} icon={<Users size={22} />} /> : (
        <TableWrap>
          <thead><tr><th className="th">Student</th><th className="th">Class</th><th className="th">Guardian</th><th className="th text-right">Billed</th><th className="th text-right">Paid</th><th className="th text-right">Balance</th><th className="th" /></tr></thead>
          <tbody>
            {rows.slice(0, limit).map((r) => {
              const g = r.s.guardians?.[0];
              const wa = waDigits(g?.phone);
              return (
                <tr key={r.s.id} className="tr tr-hover">
                  <td className="td"><p className="font-semibold text-slate-800 dark:text-slate-100">{fullName(r.s)}</p><p className="text-[11px] text-slate-400">{r.s.admissionNo}{r.s.status !== 'active' ? ` · ${r.s.status}` : ''}</p></td>
                  <td className="td text-slate-500 dark:text-slate-400">{D.classIdx.get(r.s.classId)?.name}</td>
                  <td className="td text-xs text-slate-500 dark:text-slate-400">{g ? <>{g.name}<br />{g.phone}</> : '—'}</td>
                  <td className="td text-right tabular-nums">{money(r.billed)}</td>
                  <td className="td text-right tabular-nums text-brand-600 dark:text-brand-400">{money(r.paid)}</td>
                  <td className={cx('td text-right font-bold tabular-nums', r.bal > EPS ? 'text-rose-600 dark:text-rose-400' : r.bal < -EPS ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400')}>{money(r.bal)}</td>
                  <td className="td whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" icon={<FileText size={14} />} onClick={() => setStmt(r.s)}>Statement</Button>
                    {r.bal > EPS && <Button size="sm" variant="ghost" icon={<ClipboardCopy size={14} />} onClick={() => copyReminder(r)} title="Copy reminder SMS" aria-label="Copy reminder" />}
                    {r.bal > EPS && wa && (
                      <a href={`https://wa.me/${wa}?text=${encodeURIComponent(reminder(r))}`} target="_blank" rel="noreferrer" title="Send via WhatsApp"
                        className="inline-flex h-8 items-center justify-center rounded-xl px-2 text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"><MessageCircle size={15} /></a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr className="tr"><td className="td font-bold" colSpan={3}>Totals</td><td className="td text-right font-bold tabular-nums">{money(tot.billed)}</td><td className="td text-right font-bold tabular-nums">{money(tot.paid)}</td><td className="td text-right font-bold tabular-nums">{money(tot.bal)}</td><td /></tr></tfoot>
        </TableWrap>
      )}
      {rows.length > limit && <div className="mt-3 text-center"><Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 200)}>Show more ({rows.length - limit})</Button></div>}
      <DocPreview open={!!stmt} title={stmt ? `Statement — ${fullName(stmt)}` : ''} onClose={() => setStmt(null)} onPrint={() => stmt && print(stmtDoc(stmt))}>{stmt && stmtDoc(stmt)}</DocPreview>
    </Card>
  );
}
