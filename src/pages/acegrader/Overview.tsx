import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {ArrowRight, BarChart3, CheckCircle2, ClipboardCheck, Clock, FilePlus2, FlaskConical, GraduationCap, PenLine, TrendingUp, Zap} from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, StatCard } from '../../components/ui';
import { useAuth, useSettings } from '../../context/AuthContext';
import { useCan } from '../../lib/hooks';
import { useCollection, useIndex } from '../../lib/store';
import { avg, cx, currentTerm, fmtDate, gradeColor, gradeFor } from '../../lib/utils';
import { AI_MODEL, aiAvailable } from '../../lib/acegrader/engine';
import { MINUTES_PER_SCRIPT, resultPct } from '../../lib/acegrader/helpers';
import { useAceSubmissions } from '../../lib/acegrader/hooks';
import { AiChip, SimBadge, StatusBadge } from './parts';

export default function Overview() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const settings = useSettings();
  const term = currentTerm(settings);
  const can = useCan('submissions');
  const { data: subs } = useAceSubmissions();
  const { data: rubrics } = useCollection('rubrics');
  const { data: corrections } = useCollection('corrections');
  const classes = useIndex('classes');

  const s = useMemo(() => {
    const termSubs = subs.filter((x) => x.termId === term?.id);
    const pcts = termSubs.map((x) => resultPct(x.result)).filter((x): x is number => x != null);
    const minutes = termSubs.length * MINUTES_PER_SCRIPT;
    return {
      marked: termSubs.length,
      pending: subs.filter((x) => x.status === 'pending-review').length,
      avg: avg(pcts),
      hours: minutes / 60,
      approved: termSubs.filter((x) => x.status === 'approved').length,
      below: pcts.filter((p) => p < 50).length,
    };
  }, [subs, term]);

  const myRubrics = rubrics.filter((r) => r.ownerId === profile?.staffId).length;

  return (
    <div>
      <PageHeader eyebrow={term ? `AceGrader · ${term.name}` : 'AceGrader'} title="Marking desk"
        subtitle="AceGrader marks against your rubrics, you review and approve — marks flow straight into the gradebook."
        actions={can && <Button variant="secondary" icon={<PenLine size={16} />} onClick={() => nav('/acegrader/mark')}>New marking session</Button>} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Scripts marked" value={s.marked} sub="this term" icon={<GraduationCap size={18} />} onClick={() => nav('/acegrader/review?status=all')} />
        <StatCard label="Pending review" value={s.pending} sub={s.pending ? 'awaiting your approval' : 'all caught up'} tone="amber" icon={<ClipboardCheck size={18} />} onClick={() => nav('/acegrader/review')} />
        <StatCard label="Average score" value={s.avg == null ? '—' : `${Math.round(s.avg)}%`} sub={s.below ? `${s.below} below 50%` : 'this term'} tone="green" icon={<TrendingUp size={18} />} onClick={() => nav('/acegrader/insights')} />
        <StatCard label="Time saved" value={`${s.hours < 10 ? s.hours.toFixed(1) : Math.round(s.hours)} h`} sub={`≈ ${MINUTES_PER_SCRIPT} min per script`} tone="violet" icon={<Clock size={18} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* quick actions */}
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { to: '/acegrader/mark', icon: PenLine, title: 'Mark scripts', body: 'Batch upload & mark', tone: 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200', show: can },
              { to: '/acegrader/rubrics/new', icon: FilePlus2, title: 'New rubric', body: 'Build or import', tone: 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200', show: can },
              { to: '/acegrader/review', icon: ClipboardCheck, title: 'Review queue', body: `${s.pending} waiting`, tone: 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200', show: true },
            ].filter((a) => a.show).map((a) => (
              <Link key={a.to} to={a.to} className="card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                <div className={cx('rounded-lg p-2.5', a.tone)}><a.icon size={18} /></div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">{a.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{a.body}</p>
                </div>
                <ArrowRight size={16} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" />
              </Link>
            ))}
          </div>

          <Card title="Recently marked" actions={<Link to="/acegrader/review?status=all" className="link text-xs font-semibold">View all</Link>} bodyClass="p-0">
            {!subs.length ? (
              <EmptyState title="No marked scripts yet" body="Run your first marking session — upload a batch of scripts and AceGrader marks them against your rubric."
                action={can && <Button onClick={() => nav('/acegrader/mark')} icon={<PenLine size={15} />}>Start marking</Button>} />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                {subs.slice(0, 8).map((x) => {
                  const p = resultPct(x.result);
                  const g = gradeFor(p, classes.get(x.classId), settings);
                  return (
                    <li key={x.id}>
                      <Link to={`/acegrader/review/${x.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{x.studentName}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{x.rubricTitle} · {classes.get(x.classId)?.name ?? '—'} · {fmtDate(x.timestamp, { day: 'numeric', month: 'short' })}</p>
                        </div>
                        <div className="hidden gap-1 sm:flex">{x.result.simulated && <SimBadge />}<StatusBadge status={x.status} /></div>
                        <div className="w-16 text-right">
                          <p className="font-hand text-lg font-bold leading-none text-rose-700 dark:text-rose-300">{x.result.totalScore}/{x.result.maxTotalScore}</p>
                          <p className={cx('text-xs font-bold', gradeColor(g?.grade))}>{p == null ? '—' : `${Math.round(p)}%`}{g ? ` · ${g.grade}` : ''}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {/* marking mode */}
          <div className="card relative overflow-hidden p-5">
            
            <div className="relative">
              <div className="mb-3 flex items-center gap-2">
                <div className={cx('rounded-lg p-2', aiAvailable ? 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200' : 'bg-slate-100 text-slate-700 dark:bg-white/[0.06] dark:text-slate-200')}>{aiAvailable ? <Zap size={16} /> : <FlaskConical size={16} />}</div>
                <p className="font-bold text-slate-900 dark:text-white">{aiAvailable ? 'Full marking on' : 'Quick marking mode'}</p>
                
              </div>
              {aiAvailable ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">Reads typed work, photos, scans and PDFs, and adapts to the corrections you make.</p>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">Typed scripts get an estimated mark based on length, vocabulary, structure, accuracy and rubric key points. Turn on full marking in Settings to read handwritten and scanned scripts.</p>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-white/[0.04]"><p className="text-lg font-bold text-slate-900 dark:text-white">{corrections.length}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Corrections learnt</p></div>
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-white/[0.04]"><p className="text-lg font-bold text-slate-900 dark:text-white">{rubrics.length}</p><p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Rubrics{myRubrics ? ` · ${myRubrics} yours` : ''}</p></div>
              </div>
            </div>
          </div>

          <Card title="How it works">
            <ol className="space-y-3 text-sm">
              {[
                ['Build a rubric', 'Criteria + marks, or import an existing marking scheme.'],
                ['Upload scripts', 'Photos, PDFs, Word or typed text — matched to learners by filename.'],
                ['Review & correct', 'Adjust any criterion; AceGrader learns your standard.'],
                ['Approve', 'Scaled marks post to the gradebook; print feedback sheets.'],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-300 font-sans text-xs font-semibold text-slate-500 dark:border-white/15 dark:text-slate-400">{i + 1}</span>
                  <div><p className="font-semibold text-slate-800 dark:text-slate-100">{t}</p><p className="text-slate-500 dark:text-slate-400">{b}</p></div>
                </li>
              ))}
            </ol>
          </Card>

          <Link to="/acegrader/insights" className="card flex items-center gap-3 p-4 transition hover:shadow-md">
            <BarChart3 size={18} className="text-slate-400 dark:text-slate-400" />
            <div className="flex-1"><p className="text-sm font-semibold text-slate-900 dark:text-white">Class insights</p><p className="text-xs text-slate-500 dark:text-slate-400">Weakest skills, score spread, common errors</p></div>
            {s.approved > 0 && <Badge tone="green"><CheckCircle2 size={11} /> {s.approved} approved</Badge>}
          </Link>
        </div>
      </div>
    </div>
  );
}
