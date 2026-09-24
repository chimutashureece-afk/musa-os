import React, { useMemo, useState } from 'react';
import {CheckCircle2, CreditCard, FileText, Printer, Receipt, Wallet} from 'lucide-react';
import { useSettings } from '../../context/AuthContext';
import { useMyChildren } from '../../lib/hooks';
import { useCollection, useIndex } from '../../lib/store';
import { currentTerm, cx, fmtDate, fullName, money, sum, termById } from '../../lib/utils';
import type { Invoice, Payment, SchoolSettings, Student } from '../../types';
import { Avatar, Badge, Button, Card, EmptyState, PageHeader, Spinner, TableWrap } from '../../components/ui';
import {
  allocatePayments, DocPreview, InvoiceDoc, PaymentInstructions, statementEntries, StatementDoc, StatusBadge, statusOf, usePrinter,
} from './Finance';

const EPS = 0.005;

export default function ParentFees() {
  const settings = useSettings();
  const children = useMyChildren();
  const { data: invoices, loading: l1 } = useCollection('invoices');
  const { data: payments, loading: l2 } = useCollection('payments');
  const classIdx = useIndex('classes');
  const printer = usePrinter();
  const alloc = useMemo(() => allocatePayments(invoices, payments), [invoices, payments]);

  const [preview, setPreview] = useState<{ title: string; node: React.ReactNode } | null>(null);

  const term = currentTerm(settings);
  const grand = sum(children.map((c) => sum(invoices.filter((i) => i.studentId === c.id).map((i) => i.total)) - sum(payments.filter((p) => p.studentId === c.id).map((p) => p.amount))));

  return (
    <div>
      <div className="no-print">
        <PageHeader eyebrow="Finance" title="School fees" subtitle={`Invoices, payments and balances${term ? ` · ${term.name}` : ''}. All amounts in USD.`} />
        {l1 || l2 ? <Spinner /> : !children.length ? (
          <Card><EmptyState title="No linked learners" body="Your account is not linked to a student yet. Please contact the school office." /></Card>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
            <div className="space-y-5">
              {children.length > 1 && (
                <div className={cx('card flex items-center justify-between gap-4 p-5', grand > EPS ? '' : 'border-brand-200 dark:border-brand-500/30')}>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total balance, all children</p>
                    <p className={cx('mt-1 text-3xl font-bold tabular-nums', grand > EPS ? 'text-rose-600 dark:text-rose-400' : 'text-brand-600 dark:text-brand-400')}>{money(Math.max(0, grand))}</p>
                  </div>
                  <Wallet className="text-slate-300 dark:text-slate-600" size={36} />
                </div>
              )}
              {children.map((c) => (
                <ChildFees key={c.id} child={c} settings={settings} className={classIdx.get(c.classId)?.name ?? ''}
                  invoices={invoices.filter((i) => i.studentId === c.id)} payments={payments.filter((p) => p.studentId === c.id)} alloc={alloc}
                  onPreview={(title, node) => setPreview({ title, node })} />
              ))}
            </div>
            <div>
              <Card title={<span className="flex items-center gap-2"><CreditCard size={16} /> How to pay</span>} className="xl:sticky xl:top-20">
                <PaymentInstructions settings={settings} admissionNo={children.length === 1 ? children[0]!.admissionNo : undefined} />
                {children.length > 1 && (
                  <div className="mt-3 space-y-1 text-sm">
                    {children.map((c) => <p key={c.id} className="text-slate-600 dark:text-slate-300">{c.firstName}: <span className="font-mono font-bold">{c.admissionNo}</span></p>)}
                  </div>
                )}
                <p className="mt-4 text-xs text-slate-400">Queries? Contact the bursary{settings?.phone ? ` on ${settings.phone}` : ''}{settings?.email ? ` or ${settings.email}` : ''}.</p>
              </Card>
            </div>
          </div>
        )}
      </div>
      <DocPreview open={!!preview} title={preview?.title ?? ''} onClose={() => setPreview(null)} onPrint={() => preview && printer.print(preview.node)}>{preview?.node}</DocPreview>
      {printer.host}
    </div>
  );
}

function ChildFees({ child, settings, className, invoices, payments, alloc, onPreview }: {
  child: Student; settings?: SchoolSettings; className: string; invoices: Invoice[]; payments: Payment[];
  alloc: Map<string, number>; onPreview: (title: string, node: React.ReactNode) => void;
}) {
  const classIdx = useIndex('classes');
  const cls = classIdx.get(child.classId);
  const term = currentTerm(settings);
  const termInv = invoices.filter((i) => i.termId === term?.id);
  const termPay = payments.filter((p) => p.termId === term?.id).sort((a, b) => b.date.localeCompare(a.date));
  const billed = sum(termInv.map((i) => i.total));
  const paid = sum(termPay.map((p) => p.amount));
  const termBal = billed - paid;
  const overall = sum(invoices.map((i) => i.total)) - sum(payments.map((p) => p.amount));
  const arrears = overall - termBal;

  const history = useMemo(() => {
    const ids = [...new Set([...invoices.map((i) => i.termId), ...payments.map((p) => p.termId)])];
    return ids.map((tid) => {
      const b = sum(invoices.filter((i) => i.termId === tid).map((i) => i.total));
      const p = sum(payments.filter((x) => x.termId === tid).map((x) => x.amount));
      return { tid, term: termById(settings, tid), billed: b, paid: p, bal: b - p };
    }).sort((a, b) => (b.term?.start ?? b.tid).localeCompare(a.term?.start ?? a.tid));
  }, [invoices, payments, settings]);

  const statement = () => onPreview(`Statement — ${fullName(child)}`,
    <StatementDoc student={child} cls={cls} settings={settings} entries={statementEntries(child.id, invoices, payments, settings, 'all')} scopeLabel="All terms" />);
  const invoiceDoc = (inv: Invoice) => onPreview(`Invoice ${inv.invoiceNo}`,
    <InvoiceDoc inv={inv} student={child} cls={cls} settings={settings} paid={alloc.get(inv.id) ?? 0} />);

  const clear = termBal <= EPS;

  return (
    <Card
      title={<span className="flex items-center gap-2.5"><Avatar name={fullName(child)} size={32} />{fullName(child)}</span>}
      subtitle={`${className} · Adm No. ${child.admissionNo}${child.boarding === 'boarder' ? ' · Boarder' : ''}`}
      actions={<Button size="sm" variant="outline" icon={<Printer size={14} />} onClick={statement}>Statement</Button>}>
      <div className="grid gap-5 md:grid-cols-[240px_1fr]">
        <div className={cx('rounded-2xl p-5', clear ? 'bg-slate-100 dark:bg-white/[0.06]' : 'bg-slate-100 dark:bg-white/[0.06]')}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Balance · {term?.name ?? 'Current term'}</p>
          <p className={cx('mt-1 text-4xl font-bold tracking-tight tabular-nums', clear ? 'text-brand-600 dark:text-brand-400' : 'text-rose-600 dark:text-rose-400')}>{money(Math.max(0, termBal))}</p>
          {clear ? (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300"><CheckCircle2 size={15} /> {billed ? 'Fully paid — thank you!' : 'No fees billed yet'}</p>
          ) : termInv[0] ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Due by <b>{fmtDate(termInv[0].dueDate)}</b></p> : null}
          {termBal < -EPS && <p className="mt-1 text-xs text-sky-700 dark:text-sky-300">Credit of {money(-termBal)} carried.</p>}
          <div className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Billed</span><span className="tabular-nums">{money(billed)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Paid</span><span className="tabular-nums">{money(paid)}</span></div>
            {Math.abs(arrears) > EPS && <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">{arrears > 0 ? 'Previous arrears' : 'Previous credit'}</span><span className={cx('font-semibold tabular-nums', arrears > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-sky-600 dark:text-sky-400')}>{money(Math.abs(arrears))}</span></div>}
          </div>
        </div>

        <div className="space-y-4">
          {termInv.length ? termInv.map((inv) => (
            <div key={inv.id} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Invoice <span className="font-mono">{inv.invoiceNo}</span></p>
                <div className="flex items-center gap-2">
                  <StatusBadge s={statusOf(inv.total, alloc.get(inv.id) ?? 0)} />
                  <Button size="sm" variant="ghost" icon={<FileText size={14} />} onClick={() => invoiceDoc(inv)}>View</Button>
                </div>
              </div>
              <ul className="space-y-1 text-sm">
                {inv.items.map((it, k) => <li key={k} className="flex justify-between gap-3 text-slate-600 dark:text-slate-300"><span>{it.name}</span><span className="tabular-nums">{money(it.amount)}</span></li>)}
                {!!inv.discount && <li className="flex justify-between gap-3 text-sky-600 dark:text-sky-400"><span>Discount{inv.note ? ` — ${inv.note}` : ''}</span><span className="tabular-nums">−{money(inv.discount)}</span></li>}
                <li className="flex justify-between gap-3 border-t border-slate-100 pt-1 font-bold text-slate-900 dark:border-white/[0.06] dark:text-white"><span>Total</span><span className="tabular-nums">{money(inv.total)}</span></li>
              </ul>
            </div>
          )) : <p className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">No invoice has been issued for {term?.name ?? 'this term'} yet.</p>}

          <div>
            <p className="label">Payments this term</p>
            {termPay.length ? (
              <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 dark:divide-white/[0.05] dark:border-white/10">
                {termPay.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <Receipt size={15} className="shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1"><p className="font-semibold text-slate-800 dark:text-slate-100">{fmtDate(p.date)} · {p.method}</p><p className="font-mono text-[11px] text-slate-400">{p.receiptNo}{p.reference ? ` · ${p.reference}` : ''}</p></div>
                    <span className="font-bold tabular-nums text-brand-600 dark:text-brand-400">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500 dark:text-slate-400">No payments recorded this term.</p>}
          </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="mt-6">
          <p className="label mb-2">History</p>
          <TableWrap>
            <thead><tr><th className="th">Term</th><th className="th text-right">Billed</th><th className="th text-right">Paid</th><th className="th text-right">Balance</th><th className="th">Status</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.tid} className="tr">
                  <td className="td font-semibold text-slate-800 dark:text-slate-100">{h.term?.name ?? h.tid}{h.tid === term?.id && <Badge tone="blue" className="ml-2">Current</Badge>}</td>
                  <td className="td text-right tabular-nums">{money(h.billed)}</td>
                  <td className="td text-right tabular-nums text-brand-600 dark:text-brand-400">{money(h.paid)}</td>
                  <td className={cx('td text-right font-semibold tabular-nums', h.bal > EPS ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400')}>{money(h.bal)}</td>
                  <td className="td"><StatusBadge s={statusOf(h.billed, h.paid)} /></td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}
    </Card>
  );
}
