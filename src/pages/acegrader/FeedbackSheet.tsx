import React from 'react';
import type { GradingResult, SchoolSettings } from '../../types';
import { fmtDate } from '../../lib/utils';

/** Printable student feedback sheet (render inside a .print-only container). */
export const FeedbackSheet: React.FC<{
  settings?: SchoolSettings; result: GradingResult; studentName: string; className?: string; subjectName?: string; assessmentName?: string;
  rubricTitle: string; grade?: string | null; teacher?: string; date: number;
}> = ({ settings, result, studentName, className, subjectName, assessmentName, rubricTitle, grade, teacher, date }) => {
  const p = result.maxTotalScore ? Math.round((result.totalScore / result.maxTotalScore) * 100) : 0;
  return (
    <div className="paper print-page mx-auto max-w-[190mm] bg-white p-2 text-[12px] leading-relaxed text-black">
      <header className="mb-4 border-b-2 border-black pb-3 text-center">
        <h1 className="font-serif text-2xl font-bold uppercase tracking-wide">{settings?.name ?? 'School'}</h1>
        {settings?.motto && <p className="font-display tracking-tight">“{settings.motto}”</p>}
        <p className="text-[11px]">{[settings?.address, settings?.phone, settings?.email].filter(Boolean).join(' · ')}</p>
        <p className="mt-2 text-sm font-bold uppercase tracking-[0.2em]">Marked work — feedback sheet</p>
      </header>
      <table className="mb-4 w-full text-[12px]">
        <tbody>
          <tr><td className="py-0.5 font-semibold">Learner</td><td>{studentName}</td><td className="font-semibold">Class</td><td>{className ?? '—'}</td></tr>
          <tr><td className="py-0.5 font-semibold">Subject</td><td>{subjectName ?? '—'}</td><td className="font-semibold">Date</td><td>{fmtDate(date)}</td></tr>
          <tr><td className="py-0.5 font-semibold">Task</td><td colSpan={3}>{assessmentName ? `${assessmentName} — ` : ''}{rubricTitle}</td></tr>
        </tbody>
      </table>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-400 px-2 py-1 text-left">Criterion</th>
            <th className="w-16 border border-gray-400 px-2 py-1">Mark</th>
            <th className="border border-gray-400 px-2 py-1 text-left">Comment</th>
          </tr>
        </thead>
        <tbody>
          {result.breakdown.map((b) => (
            <tr key={b.name}>
              <td className="border border-gray-400 px-2 py-1 align-top font-semibold">{b.name}</td>
              <td className="border border-gray-400 px-2 py-1 text-center align-top">{b.pointsEarned}/{b.maxPoints}</td>
              <td className="border border-gray-400 px-2 py-1 align-top">{b.justification.replace(/\s*\((Simulated estimate|Estimate) — please verify\.\)/, '')}</td>
            </tr>
          ))}
          <tr className="bg-gray-100 font-bold">
            <td className="border border-gray-400 px-2 py-1">Total</td>
            <td className="border border-gray-400 px-2 py-1 text-center">{result.totalScore}/{result.maxTotalScore}</td>
            <td className="border border-gray-400 px-2 py-1">{p}%{grade ? ` · Grade ${grade}` : ''}</td>
          </tr>
        </tbody>
      </table>
      {result.feedback && (
        <section className="mt-4">
          <h2 className="mb-1 font-bold uppercase tracking-wider">Teacher's comment</h2>
          <p className="font-hand text-[15px]">{result.feedback}</p>
        </section>
      )}
      {!!result.improvementTips.length && (
        <section className="mt-3">
          <h2 className="mb-1 font-bold uppercase tracking-wider">Next steps</h2>
          <ol className="list-decimal pl-5">{result.improvementTips.map((t, i) => <li key={i}>{t}</li>)}</ol>
        </section>
      )}
      <footer className="mt-10 grid grid-cols-2 gap-10 text-[11px]">
        <div className="border-t border-black pt-1">Teacher{teacher ? `: ${teacher}` : ''}</div>
        <div className="border-t border-black pt-1">Parent / guardian signature</div>
      </footer>
    </div>
  );
};

export default FeedbackSheet;
