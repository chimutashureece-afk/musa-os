import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {AlertTriangle, BarChart3, Lightbulb, Target, Users} from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, PageHeader, Segmented, Select, StatCard } from '../../components/ui';
import { useSettings } from '../../context/AuthContext';
import { useIndex } from '../../lib/store';
import { avg, cx, gradeColor, gradeFor } from '../../lib/utils';
import { ANN_STYLE, resultPct, tipKey } from '../../lib/acegrader/helpers';
import { useAceSubmissions } from '../../lib/acegrader/hooks';
import type { Annotation, Submission } from '../../types';

const bandColor = (p: number) => (p < 50 ? '#e11d48' : p < 65 ? '#d97706' : '#059669');
const bandLabel = (p: number) => (p < 50 ? 'Weak' : p < 65 ? 'Developing' : 'Secure');
const ANN_HEX: Record<Annotation['type'], string> = { praise: '#059669', error: '#e11d48', grammar: '#d97706', warning: '#bd6a07' };

const ChartTip: React.FC<{ active?: boolean; payload?: any[]; label?: any; fmt: (d: any) => React.ReactNode }> = ({ active, payload, fmt }) =>
  active && payload?.length ? (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-white/10 dark:bg-ink-700 dark:text-slate-100">{fmt(payload[0].payload)}</div>
  ) : null;

export default function Insights() {
  const nav = useNavigate();
  const settings = useSettings();
  const { data: subs } = useAceSubmissions();
  const rubricsIdx = useIndex('rubrics');
  const classes = useIndex('classes');

  const rubricOptions = useMemo(() => {
    const m = new Map<string, { id: string; title: string; n: number }>();
    subs.forEach((s) => { const e = m.get(s.rubricId) ?? { id: s.rubricId, title: rubricsIdx.get(s.rubricId)?.title ?? s.rubricTitle, n: 0 }; e.n++; m.set(s.rubricId, e); });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [subs, rubricsIdx]);

  const [rubricId, setRubricId] = useState('');
  const [classId, setClassId] = useState('');
  const [scope, setScope] = useState<'all' | 'approved'>('all');
  useEffect(() => { if (!rubricId && rubricOptions.length) setRubricId(rubricOptions[0]!.id); }, [rubricOptions, rubricId]);

  const classOptions = useMemo(() => [...new Set(subs.filter((s) => s.rubricId === rubricId).map((s) => s.classId))].map((id) => classes.get(id)).filter(Boolean), [subs, rubricId, classes]);
  useEffect(() => { if (classId && !classOptions.some((c) => c!.id === classId)) setClassId(''); }, [classOptions, classId]);

  /** latest submission per student for this rubric (+class), excluding returned scripts */
  const data = useMemo(() => {
    const latest = new Map<string, Submission>();
    subs.filter((s) => s.rubricId === rubricId && (!classId || s.classId === classId) && s.status !== 'returned' && (scope === 'all' || s.status === 'approved'))
      .forEach((s) => { const cur = latest.get(s.studentId); if (!cur || s.timestamp > cur.timestamp) latest.set(s.studentId, s); });
    return [...latest.values()];
  }, [subs, rubricId, classId, scope]);

  const stats = useMemo(() => {
    const pcts = data.map((s) => resultPct(s.result) ?? 0);
    // per criterion
    const crit = new Map<string, { name: string; earned: number; max: number; n: number; order: number }>();
    data.forEach((s) => s.result.breakdown.forEach((b, i) => {
      const e = crit.get(b.name) ?? { name: b.name, earned: 0, max: 0, n: 0, order: i };
      e.earned += b.pointsEarned; e.max += b.maxPoints; e.n++; crit.set(b.name, e);
    }));
    const criteria = [...crit.values()].map((c) => ({ name: c.name, pct: c.max ? Math.round((c.earned / c.max) * 1000) / 10 : 0, n: c.n, avgPts: c.n ? Math.round((c.earned / c.n) * 10) / 10 : 0, maxPts: c.n ? Math.round((c.max / c.n) * 10) / 10 : 0 }))
      .sort((a, b) => a.pct - b.pct);
    // histogram
    const hist = Array.from({ length: 10 }, (_, i) => ({ band: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`, lo: i * 10, n: 0 }));
    pcts.forEach((p) => hist[Math.min(9, Math.floor(p / 10))]!.n++);
    // annotation types
    const annCounts: Record<Annotation['type'], number> = { praise: 0, error: 0, grammar: 0, warning: 0 };
    data.forEach((s) => s.result.annotations.forEach((a) => (annCounts[a.type] = (annCounts[a.type] ?? 0) + 1)));
    const anns = (Object.keys(annCounts) as Annotation['type'][]).map((t) => ({ type: t, label: ANN_STYLE[t].label, n: annCounts[t], perScript: data.length ? Math.round((annCounts[t] / data.length) * 10) / 10 : 0 })).sort((a, b) => b.n - a.n);
    // common grammar corrections
    const fixes = new Map<string, { text: string; n: number }>();
    data.forEach((s) => s.result.annotations.filter((a) => a.type === 'grammar' || a.type === 'error').forEach((a) => {
      const k = a.comment.toLowerCase().replace(/[“”"'].*?[“”"']/g, '').replace(/[^a-z\s]/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
      if (!k) return;
      const e = fixes.get(k) ?? { text: a.comment, n: 0 }; e.n++; fixes.set(k, e);
    }));
    // tips
    const tips = new Map<string, { text: string; n: number; students: Set<string> }>();
    data.forEach((s) => s.result.improvementTips.forEach((t) => {
      const k = tipKey(t);
      if (!k) return;
      const e = tips.get(k) ?? { text: t, n: 0, students: new Set<string>() };
      e.n++; e.students.add(s.studentId); if (t.length < e.text.length) e.text = t; tips.set(k, e);
    }));
    const below = data.map((s) => ({ s, p: resultPct(s.result) ?? 0 })).filter((x) => x.p < 50).sort((a, b) => a.p - b.p);
    return {
      avg: avg(pcts), median: pcts.length ? [...pcts].sort((a, b) => a - b)[Math.floor(pcts.length / 2)]! : null,
      criteria, hist, anns, below,
      tips: [...tips.values()].sort((a, b) => b.students.size - a.students.size || b.n - a.n).slice(0, 6),
      fixes: [...fixes.values()].filter((f) => f.n > 1).sort((a, b) => b.n - a.n).slice(0, 5),
    };
  }, [data]);

  const weakest = stats.criteria[0];
  const cls = classId ? classes.get(classId) : data[0] ? classes.get(data[0].classId) : undefined;

  if (!subs.length) {
    return (
      <div>
        <PageHeader eyebrow="AceGrader" title="Teaching insights" subtitle="Turn marking into teaching: see which skills your class needs next." />
        <Card><EmptyState icon={<BarChart3 size={22} />} title="No marked scripts yet" body="Insights appear once you've marked a batch of scripts." action={<Button onClick={() => nav('/acegrader/mark')}>Mark scripts</Button>} /></Card>
      </div>
    );
  }

  const tick = { fill: 'currentColor', fontSize: 11 };

  return (
    <div>
      <PageHeader eyebrow="AceGrader" title="Teaching insights" subtitle="Turn marking into teaching: which skills does the class need next?" />

      <div className="card mb-6 grid gap-4 p-4 sm:grid-cols-[1fr_220px_auto] sm:items-end">
        <Field label="Rubric">
          <Select value={rubricId} onChange={(e) => setRubricId(e.target.value)}>
            {rubricOptions.map((r) => <option key={r.id} value={r.id}>{r.title} ({r.n})</option>)}
          </Select>
        </Field>
        <Field label="Class">
          <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classOptions.map((c) => <option key={c!.id} value={c!.id}>{c!.name}</option>)}
          </Select>
        </Field>
        <Segmented value={scope} onChange={setScope} options={[{ id: 'all', label: 'All marked' }, { id: 'approved', label: 'Approved only' }]} />
      </div>

      {!data.length ? <Card><EmptyState title="No scripts for this selection" body="Try including unapproved scripts or another class." /></Card> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Learners" value={data.length} sub="latest script each" icon={<Users size={18} />} />
            <StatCard label="Class average" value={stats.avg == null ? '—' : `${Math.round(stats.avg)}%`} sub={stats.median != null ? `median ${Math.round(stats.median)}%` : undefined} tone="green" icon={<BarChart3 size={18} />} />
            <StatCard label="Below 50%" value={stats.below.length} sub={`${Math.round((stats.below.length / data.length) * 100)}% of learners`} tone="rose" icon={<AlertTriangle size={18} />} />
            <StatCard label="Teach next" value={<span className="block truncate text-lg">{weakest?.name ?? '—'}</span>} sub={weakest ? `avg ${Math.round(weakest.pct)}% — weakest skill` : undefined} tone="amber" icon={<Target size={18} />} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Skills by criterion" subtitle="Average % of marks earned — weakest first" className="lg:col-span-2">
              <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                {[['#e11d48', 'Weak (< 50%)'], ['#d97706', 'Developing (50–64%)'], ['#059669', 'Secure (65%+)']].map(([c, l]) => <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
              </div>
              <div className="text-slate-500 dark:text-slate-400" style={{ height: Math.max(160, stats.criteria.length * 46 + 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.criteria} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }} barCategoryGap={10}>
                    <CartesianGrid horizontal={false} stroke="currentColor" strokeOpacity={0.12} />
                    <XAxis type="number" domain={[0, 100]} tick={tick} tickFormatter={(v) => `${v}%`} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={170} tick={tick} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'currentColor', fillOpacity: 0.06 }} content={<ChartTip fmt={(d) => <><b>{d.name}</b><br />{d.pct}% · {bandLabel(d.pct)}<br />avg {d.avgPts}/{d.maxPts} marks · {d.n} scripts</>} />} />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {stats.criteria.map((c) => <Cell key={c.name} fill={bandColor(c.pct)} />)}
                      <LabelList dataKey="pct" position="right" formatter={(v: any) => `${Math.round(Number(v))}%`} style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Score distribution" subtitle="Number of learners per 10% band">
              <div className="h-60 text-slate-500 dark:text-slate-400">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.hist} margin={{ top: 16, right: 4, bottom: 0, left: -24 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.12} />
                    <XAxis dataKey="band" tick={{ ...tick, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'currentColor', fillOpacity: 0.06 }} content={<ChartTip fmt={(d) => <><b>{d.band}%</b><br />{d.n} learner{d.n === 1 ? '' : 's'}</>} />} />
                    <Bar dataKey="n" radius={[4, 4, 0, 0]}>
                      {stats.hist.map((h) => <Cell key={h.band} fill={h.lo < 50 ? '#fb7185' : '#16a04c'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-slate-400">Bars below the 50% line are shown in rose.</p>
            </Card>

            <Card title="Margin notes by type" subtitle="What the marker flagged across all scripts">
              <div className="h-44 text-slate-500 dark:text-slate-400">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.anns} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 8 }} barCategoryGap={8}>
                    <XAxis type="number" hide allowDecimals={false} />
                    <YAxis type="category" dataKey="label" width={80} tick={tick} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: 'currentColor', fillOpacity: 0.06 }} content={<ChartTip fmt={(d) => <><b>{d.label}</b><br />{d.n} notes · {d.perScript} per script</>} />} />
                    <Bar dataKey="n" radius={[0, 4, 4, 0]} maxBarSize={20}>
                      {stats.anns.map((a) => <Cell key={a.type} fill={ANN_HEX[a.type]} />)}
                      <LabelList dataKey="n" position="right" style={{ fill: 'currentColor', fontSize: 11, fontWeight: 600 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {!!stats.fixes.length && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <p className="label">Recurring errors</p>
                  <ul className="space-y-1">
                    {stats.fixes.map((f) => <li key={f.text} className="flex items-center justify-between gap-2 text-sm"><span className="truncate text-slate-600 dark:text-slate-300">{f.text}</span><Badge tone="amber">×{f.n}</Badge></li>)}
                  </ul>
                </div>
              )}
            </Card>

            <Card title={<span className="flex items-center gap-2"><Lightbulb size={15} className="text-slate-400 dark:text-slate-400" /> Most common next steps</span>} subtitle="Similar improvement tips grouped — plan a whole-class lesson around the top ones">
              {!stats.tips.length ? <p className="text-sm text-slate-400">No improvement tips recorded.</p> : (
                <ol className="space-y-3">
                  {stats.tips.map((t, i) => {
                    const share = (t.students.size / data.length) * 100;
                    return (
                      <li key={t.text}>
                        <div className="flex items-start gap-3">
                          <span className="font-hand text-lg font-bold leading-6 text-rose-700 dark:text-rose-300">{i + 1}.</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-800 dark:text-slate-100">{t.text}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><div className="h-full rounded-full bg-marigold-500" style={{ width: `${share}%` }} /></div>
                              <span className="w-24 text-right text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t.students.size} learner{t.students.size === 1 ? '' : 's'} · {Math.round(share)}%</span>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>

            <Card title={<span className="flex items-center gap-2"><AlertTriangle size={15} className="text-rose-500 dark:text-rose-300" /> Learners below 50%</span>} subtitle="Candidates for intervention or extra support" bodyClass="p-0">
              {!stats.below.length ? <EmptyState title="Nobody below 50%" body="Every learner in this selection scored at least half marks." /> : (
                <ul className="divide-y divide-slate-100 dark:divide-white/[0.05]">
                  {stats.below.map(({ s, p }) => {
                    const g = gradeFor(p, classes.get(s.classId) ?? cls, settings);
                    const weak = [...s.result.breakdown].sort((a, b) => a.pointsEarned / a.maxPoints - b.pointsEarned / b.maxPoints)[0];
                    return (
                      <li key={s.id}>
                        <Link to={`/acegrader/review/${s.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{s.studentName}</p>
                            {weak && <p className="truncate text-xs text-slate-500 dark:text-slate-400">Weakest: {weak.name} ({weak.pointsEarned}/{weak.maxPoints})</p>}
                          </div>
                          <span className={cx('text-sm font-bold', gradeColor(g?.grade))}>{Math.round(p)}%{g ? ` · ${g.grade}` : ''}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
