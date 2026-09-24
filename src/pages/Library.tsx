import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {AlertTriangle, BookOpen, BookPlus, Library as LibraryIcon, Pencil, Plus, RotateCcw, Trash2, TrendingUp} from 'lucide-react';
import { Book, Loan, Student } from '../types';
import { store, useCollection, useIndex } from '../lib/store';
import { useCan } from '../lib/hooks';
import { addDays, cx, fmtDate, fullName, studentMatches, todayISO } from '../lib/utils';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Segmented, Select, StatCard, TableWrap, Tabs, useUI } from '../components/ui';

type TabId = 'catalogue' | 'loans' | 'stats';
type BookDraft = { id?: string; title: string; author: string; isbn: string; category: string; copies: string; shelf: string };

const isActive = (l: Loan) => !l.returned;
const isOverdue = (l: Loan, today: string) => !l.returned && l.due < today;

export default function LibraryPage() {
  const { toast, confirm } = useUI();
  const canBooks = useCan('books');
  const canLoans = useCan('loans');
  const { data: books } = useCollection('books');
  const { data: loans } = useCollection('loans');
  const { data: students } = useCollection('students');
  const studentIdx = useIndex('students');
  const classIdx = useIndex('classes');
  const bookIdx = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const today = todayISO();

  const [tab, setTab] = useState<TabId>('catalogue');
  const activeByBook = useMemo(() => {
    const m = new Map<string, number>();
    loans.forEach((l) => { if (isActive(l)) m.set(l.bookId, (m.get(l.bookId) ?? 0) + 1); });
    return m;
  }, [loans]);
  const available = (b: Book) => Math.max(0, b.copies - (activeByBook.get(b.id) ?? 0));
  const categories = useMemo(() => [...new Set(books.map((b) => b.category).filter(Boolean))].sort(), [books]);
  const overdueCount = loans.filter((l) => isOverdue(l, today)).length;
  const activeCount = loans.filter(isActive).length;

  // ------------------------------------------------------------ catalogue
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [bookDraft, setBookDraft] = useState<BookDraft | null>(null);
  const shownBooks = books.filter((b) => (!cat || b.category === cat) && (!q || `${b.title} ${b.author} ${b.isbn ?? ''} ${b.shelf ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.title.localeCompare(b.title));

  const saveBook = async () => {
    if (!bookDraft) return;
    const copies = parseInt(bookDraft.copies, 10);
    if (!bookDraft.title.trim() || !bookDraft.author.trim() || !bookDraft.category.trim()) { toast('Title, author and category are required', 'error'); return; }
    if (!Number.isFinite(copies) || copies < 0) { toast('Copies must be 0 or more', 'error'); return; }
    if (bookDraft.id && copies < (activeByBook.get(bookDraft.id) ?? 0)) { toast(`There are ${activeByBook.get(bookDraft.id)} copies on loan — copies can't be lower than that`, 'error'); return; }
    const data: Omit<Book, 'id'> = { title: bookDraft.title.trim(), author: bookDraft.author.trim(), category: bookDraft.category.trim(), copies };
    if (bookDraft.isbn.trim()) data.isbn = bookDraft.isbn.trim();
    if (bookDraft.shelf.trim()) data.shelf = bookDraft.shelf.trim();
    try {
      if (bookDraft.id) {
        const old = bookIdx.get(bookDraft.id);
        await store.set('books', { ...data, id: bookDraft.id, ...(old?.createdAt ? { createdAt: old.createdAt } : {}) });
        toast('Book updated');
      } else { await store.add('books', data); toast('Book added to catalogue'); }
      setBookDraft(null);
    } catch (e: any) { toast(e.message ?? 'Could not save', 'error'); }
  };
  const deleteBook = async (b: Book) => {
    if (activeByBook.get(b.id)) { toast('This book has copies on loan — return them first', 'error'); return; }
    if (!(await confirm({ title: 'Delete book?', body: `“${b.title}” will be removed from the catalogue. Loan history is kept.`, confirmText: 'Delete', danger: true }))) return;
    await store.remove('books', b.id);
    toast('Book deleted', 'info');
  };

  // ---------------------------------------------------------------- loans
  const [loanFilter, setLoanFilter] = useState<'active' | 'overdue' | 'returned'>('active');
  const [lq, setLq] = useState('');
  const [issue, setIssue] = useState<{ studentId: string; bookId: string; due: string; sq: string; bq: string } | null>(null);
  const shownLoans = loans.filter((l) => (loanFilter === 'active' ? isActive(l) : loanFilter === 'overdue' ? isOverdue(l, today) : !!l.returned))
    .filter((l) => {
      if (!lq) return true;
      const s = studentIdx.get(l.studentId), b = bookIdx.get(l.bookId);
      return `${s ? `${s.firstName} ${s.lastName} ${s.admissionNo}` : ''} ${b?.title ?? ''}`.toLowerCase().includes(lq.toLowerCase());
    })
    .sort((a, b) => (loanFilter === 'returned' ? (b.returned ?? '').localeCompare(a.returned ?? '') : a.due.localeCompare(b.due)));

  const returnLoan = async (l: Loan) => {
    await store.update('loans', l.id, { returned: today });
    toast(`“${bookIdx.get(l.bookId)?.title ?? 'Book'}” returned`);
  };
  const deleteLoan = async (l: Loan) => {
    if (!(await confirm({ title: 'Delete loan record?', confirmText: 'Delete', danger: true }))) return;
    await store.remove('loans', l.id);
  };
  const issueBook = async () => {
    if (!issue?.studentId || !issue.bookId) { toast('Choose a learner and a book', 'error'); return; }
    const b = bookIdx.get(issue.bookId);
    if (!b || available(b) <= 0) { toast('No copies of this book are available', 'error'); return; }
    if (issue.due < today) { toast('Due date is in the past', 'error'); return; }
    await store.add('loans', { bookId: issue.bookId, studentId: issue.studentId, issued: today, due: issue.due });
    toast(`Issued “${b.title}” to ${fullName(studentIdx.get(issue.studentId))}`);
    setIssue(null);
  };

  const studentOptions = useMemo(() => {
    if (!issue) return [];
    return students.filter((s) => s.status === 'active' && studentMatches(s, issue.sq)).sort((a, b) => a.lastName.localeCompare(b.lastName)).slice(0, 8);
  }, [students, issue]);
  const bookOptions = useMemo(() => {
    if (!issue) return [];
    return books.filter((b) => available(b) > 0 && (!issue.bq || `${b.title} ${b.author}`.toLowerCase().includes(issue.bq.toLowerCase()))).sort((a, b) => a.title.localeCompare(b.title)).slice(0, 8);
  }, [books, issue, activeByBook]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- stats
  const stats = useMemo(() => {
    const byBook = new Map<string, number>();
    const byCat = new Map<string, number>();
    loans.forEach((l) => {
      byBook.set(l.bookId, (byBook.get(l.bookId) ?? 0) + 1);
      const c = bookIdx.get(l.bookId)?.category ?? 'Unknown';
      byCat.set(c, (byCat.get(c) ?? 0) + 1);
    });
    const top = [...byBook.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, n]) => ({ book: bookIdx.get(id), n }));
    const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([category, loans]) => ({ category, loans }));
    const borrowers = new Map<string, number>();
    loans.forEach((l) => borrowers.set(l.studentId, (borrowers.get(l.studentId) ?? 0) + 1));
    const readers = [...borrowers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => ({ s: studentIdx.get(id), n, id }));
    return { top, cats, readers };
  }, [loans, bookIdx, studentIdx]);
  const totalCopies = books.reduce((a, b) => a + b.copies, 0);

  const studentCell = (s?: Student, id?: string) => s
    ? <div><Link to={`/students/${s.id}`} className="font-semibold text-slate-800 hover:underline dark:text-slate-100">{fullName(s)}</Link><p className="text-[11px] text-slate-400">{s.admissionNo} · {classIdx.get(s.classId)?.name ?? ''}</p></div>
    : <span className="text-slate-400">{id ? 'Unknown learner' : '—'}</span>;

  return (
    <div>
      <PageHeader eyebrow="Resource centre" title="Library" subtitle="Catalogue, loans and reading trends."
        actions={
          <>
            {canLoans && <Button variant="secondary" icon={<BookOpen size={16} />} onClick={() => setIssue({ studentId: '', bookId: '', due: addDays(today, 14), sq: '', bq: '' })}>Issue book</Button>}
            {canBooks && <Button variant="outline" icon={<BookPlus size={16} />} onClick={() => setBookDraft({ title: '', author: '', isbn: '', category: cat, copies: '1', shelf: '' })}>Add book</Button>}
          </>
        } />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Titles" value={books.length} sub={`${totalCopies} copies`} icon={<LibraryIcon size={18} />} />
        <StatCard label="On loan" value={activeCount} sub={totalCopies ? `${Math.round((activeCount / totalCopies) * 100)}% of stock` : undefined} icon={<BookOpen size={18} />} tone="violet" onClick={() => { setTab('loans'); setLoanFilter('active'); }} />
        <StatCard label="Overdue" value={overdueCount} icon={<AlertTriangle size={18} />} tone={overdueCount ? 'rose' : 'green'} onClick={() => { setTab('loans'); setLoanFilter('overdue'); }} />
        <StatCard label="Total loans" value={loans.length} sub="all time" icon={<TrendingUp size={18} />} tone="green" onClick={() => setTab('stats')} />
      </div>

      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'catalogue', label: 'Catalogue', count: books.length },
        { id: 'loans', label: 'Loans', count: activeCount },
        { id: 'stats', label: 'Stats' },
      ]} />

      {tab === 'catalogue' && (
        <Card title="Catalogue" actions={
          <>
            <Select value={cat} onChange={(e) => setCat(e.target.value)} className="w-40">
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <SearchInput value={q} onChange={setQ} className="w-56" placeholder="Title, author, ISBN…" />
          </>
        }>
          {shownBooks.length === 0 ? <EmptyState title={books.length ? 'No books match' : 'The catalogue is empty'} icon={<LibraryIcon size={22} />} /> : (
            <TableWrap>
              <thead><tr><th className="th pl-5">Title</th><th className="th">Category</th><th className="th">Shelf</th><th className="th">ISBN</th><th className="th text-right">Copies</th><th className="th text-right">Available</th>{canBooks && <th className="th pr-5" />}</tr></thead>
              <tbody>
                {shownBooks.map((b) => {
                  const av = available(b);
                  return (
                    <tr key={b.id} className="tr tr-hover">
                      <td className="td pl-5"><p className="font-semibold text-slate-800 dark:text-slate-100">{b.title}</p><p className="text-xs text-slate-500 dark:text-slate-400">{b.author}</p></td>
                      <td className="td"><Badge>{b.category}</Badge></td>
                      <td className="td text-xs text-slate-500 dark:text-slate-400">{b.shelf ?? '—'}</td>
                      <td className="td font-mono text-[11px] text-slate-400">{b.isbn ?? '—'}</td>
                      <td className="td text-right tabular-nums">{b.copies}</td>
                      <td className="td text-right"><Badge tone={av === 0 ? 'red' : av <= 1 ? 'amber' : 'green'}>{av} / {b.copies}</Badge></td>
                      {canBooks && (
                        <td className="td pr-5 text-right whitespace-nowrap">
                          <button onClick={() => setBookDraft({ id: b.id, title: b.title, author: b.author, isbn: b.isbn ?? '', category: b.category, copies: String(b.copies), shelf: b.shelf ?? '' })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => deleteBook(b)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Delete"><Trash2 size={14} /></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === 'loans' && (
        <Card title="Loans" actions={
          <>
            <Segmented value={loanFilter} onChange={setLoanFilter} options={[
              { id: 'active', label: `Active (${activeCount})` }, { id: 'overdue', label: `Overdue (${overdueCount})` }, { id: 'returned', label: 'Returned' },
            ]} />
            <SearchInput value={lq} onChange={setLq} className="w-52" placeholder="Learner or book…" />
          </>
        }>
          {shownLoans.length === 0 ? <EmptyState title="No loans here" icon={<BookOpen size={22} />} /> : (
            <TableWrap>
              <thead><tr><th className="th pl-5">Book</th><th className="th">Learner</th><th className="th">Issued</th><th className="th">Due</th><th className="th">Status</th>{canLoans && <th className="th pr-5" />}</tr></thead>
              <tbody>
                {shownLoans.map((l) => {
                  const b = bookIdx.get(l.bookId);
                  const od = isOverdue(l, today);
                  const daysLate = od ? Math.round((new Date(today).getTime() - new Date(l.due).getTime()) / 86400000) : 0;
                  return (
                    <tr key={l.id} className={cx('tr tr-hover', od && 'bg-slate-100 dark:bg-rose-500/[0.04]')}>
                      <td className="td pl-5"><p className="font-semibold text-slate-800 dark:text-slate-100">{b?.title ?? 'Deleted book'}</p><p className="text-xs text-slate-500 dark:text-slate-400">{b?.author}</p></td>
                      <td className="td">{studentCell(studentIdx.get(l.studentId), l.studentId)}</td>
                      <td className="td text-xs text-slate-500 dark:text-slate-400">{fmtDate(l.issued)}</td>
                      <td className={cx('td text-xs', od ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>{fmtDate(l.due)}</td>
                      <td className="td">
                        {l.returned ? <Badge tone="green">Returned {fmtDate(l.returned, { day: 'numeric', month: 'short' })}</Badge>
                          : od ? <Badge tone="red"><AlertTriangle size={10} /> Overdue {daysLate}d</Badge>
                          : <Badge tone="blue">On loan</Badge>}
                      </td>
                      {canLoans && (
                        <td className="td pr-5 text-right whitespace-nowrap">
                          {!l.returned && <Button size="sm" variant="outline" icon={<RotateCcw size={13} />} onClick={() => returnLoan(l)}>Return</Button>}
                          {l.returned && <button onClick={() => deleteLoan(l)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10" title="Delete record"><Trash2 size={14} /></button>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      )}

      {tab === 'stats' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Loans by category" subtitle="All-time loans per catalogue category">
            {stats.cats.length === 0 ? <EmptyState title="No loans yet" /> : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.cats} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-white/10" vertical={false} />
                    <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#8f9f97' }} tickLine={false} axisLine={false} interval={0} angle={-25} textAnchor="end" height={50} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#8f9f97' }} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,.12)' }} contentStyle={{ borderRadius: 12, border: '1px solid rgba(148,163,184,.3)', fontSize: 12, background: 'rgba(255,255,255,.96)', color: '#131b18' }} formatter={(v: any) => [v, 'Loans']} />
                    <Bar dataKey="loans" fill="#0e833e" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <Card title="Most borrowed" subtitle="Top 10 titles" bodyClass="p-0">
            {stats.top.length === 0 ? <EmptyState title="No loans yet" /> : (
              <ol className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {stats.top.map(({ book, n }, i) => (
                  <li key={book?.id ?? i} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', i < 3 ? 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400')}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{book?.title ?? 'Deleted book'}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{book?.author} · {book?.category}</p>
                    </div>
                    <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{n}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title="Top readers" subtitle="Learners with the most loans" bodyClass="p-0">
            {stats.readers.length === 0 ? <EmptyState title="No loans yet" /> : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {stats.readers.map((r) => (
                  <li key={r.id} className="flex items-center justify-between px-5 py-2.5">{studentCell(r.s, r.id)}<Badge tone="blue">{r.n} loan{r.n === 1 ? '' : 's'}</Badge></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Overdue" subtitle={`${overdueCount} book${overdueCount === 1 ? '' : 's'} past due date`} actions={overdueCount > 0 && <Button size="sm" variant="outline" onClick={() => { setTab('loans'); setLoanFilter('overdue'); }}>View all</Button>}>
            {overdueCount === 0 ? <p className="text-sm text-brand-600 dark:text-brand-400">All loans are within their due dates.</p> : (
              <ul className="space-y-2">
                {loans.filter((l) => isOverdue(l, today)).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate"><span className="font-semibold text-slate-800 dark:text-slate-100">{fullName(studentIdx.get(l.studentId))}</span> <span className="text-slate-500 dark:text-slate-400">· {bookIdx.get(l.bookId)?.title}</span></span>
                    <Badge tone="red">due {fmtDate(l.due, { day: 'numeric', month: 'short' })}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* book modal */}
      <Modal open={!!bookDraft} onClose={() => setBookDraft(null)} title={bookDraft?.id ? 'Edit book' : 'Add book'}
        footer={<><Button variant="outline" onClick={() => setBookDraft(null)}>Cancel</Button><Button onClick={saveBook}>{bookDraft?.id ? 'Save changes' : 'Add book'}</Button></>}>
        {bookDraft && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" required className="sm:col-span-2"><Input autoFocus value={bookDraft.title} onChange={(e) => setBookDraft({ ...bookDraft, title: e.target.value })} /></Field>
            <Field label="Author" required><Input value={bookDraft.author} onChange={(e) => setBookDraft({ ...bookDraft, author: e.target.value })} /></Field>
            <Field label="Category" required>
              <Input list="lib-cats" value={bookDraft.category} onChange={(e) => setBookDraft({ ...bookDraft, category: e.target.value })} placeholder="e.g. Literature" />
              <datalist id="lib-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="ISBN"><Input value={bookDraft.isbn} onChange={(e) => setBookDraft({ ...bookDraft, isbn: e.target.value })} /></Field>
            <Field label="Shelf"><Input value={bookDraft.shelf} onChange={(e) => setBookDraft({ ...bookDraft, shelf: e.target.value })} placeholder="e.g. LIT-3" /></Field>
            <Field label="Copies" required hint={bookDraft.id ? `${activeByBook.get(bookDraft.id) ?? 0} currently on loan` : undefined}><Input type="number" min={0} value={bookDraft.copies} onChange={(e) => setBookDraft({ ...bookDraft, copies: e.target.value })} /></Field>
          </div>
        )}
      </Modal>

      {/* issue modal */}
      <Modal open={!!issue} onClose={() => setIssue(null)} title="Issue a book" size="lg"
        footer={<><Button variant="outline" onClick={() => setIssue(null)}>Cancel</Button><Button icon={<Plus size={15} />} disabled={!issue?.studentId || !issue?.bookId} onClick={issueBook}>Issue book</Button></>}>
        {issue && (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <span className="label">Learner</span>
              <SearchInput value={issue.sq} onChange={(v) => setIssue({ ...issue, sq: v })} placeholder="Name or admission no…" />
              <ul className="mt-2 space-y-1">
                {studentOptions.map((s) => {
                  const on = issue.studentId === s.id;
                  const out = loans.filter((l) => l.studentId === s.id && isActive(l)).length;
                  return (
                    <li key={s.id}>
                      <button onClick={() => setIssue({ ...issue, studentId: s.id })} className={cx('flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition',
                        on ? 'border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/[0.06]' : 'border-slate-100 hover:bg-slate-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]')}>
                        <span><span className="font-semibold text-slate-800 dark:text-slate-100">{fullName(s)}</span><span className="block text-[11px] text-slate-400">{s.admissionNo} · {classIdx.get(s.classId)?.name}</span></span>
                        {out > 0 && <Badge tone="amber">{out} out</Badge>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <span className="label">Book (available copies only)</span>
              <SearchInput value={issue.bq} onChange={(v) => setIssue({ ...issue, bq: v })} placeholder="Title or author…" />
              <ul className="mt-2 space-y-1">
                {bookOptions.map((b) => {
                  const on = issue.bookId === b.id;
                  return (
                    <li key={b.id}>
                      <button onClick={() => setIssue({ ...issue, bookId: b.id })} className={cx('flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition',
                        on ? 'border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/[0.06]' : 'border-slate-100 hover:bg-slate-50 dark:border-white/[0.06] dark:hover:bg-white/[0.03]')}>
                        <span className="min-w-0"><span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{b.title}</span><span className="block truncate text-[11px] text-slate-400">{b.author}</span></span>
                        <Badge tone="green">{available(b)} left</Badge>
                      </button>
                    </li>
                  );
                })}
                {bookOptions.length === 0 && <li className="py-3 text-center text-xs text-slate-400">No available books match.</li>}
              </ul>
              <Field label="Due date" className="mt-4"><Input type="date" min={today} value={issue.due} onChange={(e) => setIssue({ ...issue, due: e.target.value })} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
