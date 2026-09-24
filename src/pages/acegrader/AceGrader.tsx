import React, { Suspense, lazy } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import {BarChart3, ClipboardCheck, Home, Library, PenLine} from 'lucide-react';
import { EmptyState, Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useCollection } from '../../lib/store';
import { cx } from '../../lib/utils';
import { aiAvailable } from '../../lib/acegrader/engine';

const Overview = lazy(() => import('./Overview'));
const MarkSession = lazy(() => import('./MarkSession'));
const ReviewQueue = lazy(() => import('./ReviewQueue'));
const SubmissionDetail = lazy(() => import('./SubmissionDetail'));
const RubricLibrary = lazy(() => import('./RubricLibrary'));
const RubricBuilder = lazy(() => import('./RubricBuilder'));
const Insights = lazy(() => import('./Insights'));

const SubNav: React.FC = () => {
  const { data: subs } = useCollection('submissions');
  const pending = subs.filter((s) => s.status === 'pending-review').length;
  const items = [
    { to: '/acegrader', end: true, label: 'Overview', icon: Home },
    { to: '/acegrader/mark', label: 'Mark scripts', icon: PenLine },
    { to: '/acegrader/review', label: 'Review', icon: ClipboardCheck, count: pending },
    { to: '/acegrader/rubrics', label: 'Rubrics', icon: Library },
    { to: '/acegrader/insights', label: 'Insights', icon: BarChart3 },
  ];
  return (
    <div className="no-print mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 dark:border-white/10 dark:text-slate-300">
          <PenLine size={17} />
        </div>
        <div className="leading-tight">
          <p className="font-display tracking-tight text-lg font-bold text-slate-900 dark:text-white">AceGrader</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Script marking</p>
        </div>
      </div>
      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:ml-4 sm:pb-0">
        {items.map((it) => (
          <NavLink key={it.label} to={it.to} end={it.end}
            className={({ isActive }) => cx('relative flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition',
              isActive ? 'bg-brand-800 text-white dark:bg-brand-600 dark:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white')}>
            <it.icon size={15} />{it.label}
            {!!it.count && <span className="ml-0.5 rounded-full bg-slate-200 px-1.5 text-[10px] font-bold text-slate-700 dark:bg-white/10 dark:text-slate-200">{it.count}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
};

export default function AceGrader() {
  const { profile } = useAuth();
  if (profile && profile.role !== 'admin' && profile.role !== 'teacher')
    return <EmptyState title="No access" body="AceGrader is available to teachers and administrators." />;
  return (
    <div className="animate-fade-in">
      <SubNav />
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route index element={<Overview />} />
          <Route path="mark" element={<MarkSession />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="review/:id" element={<SubmissionDetail />} />
          <Route path="rubrics" element={<RubricLibrary />} />
          <Route path="rubrics/new" element={<RubricBuilder />} />
          <Route path="rubrics/:id" element={<RubricBuilder />} />
          <Route path="insights" element={<Insights />} />
          <Route path="*" element={<Navigate to="/acegrader" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
