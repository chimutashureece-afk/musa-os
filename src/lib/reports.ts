import {
  Allocation, Assessment, AttendanceRegister, Mark, PublishedReport, ReportRemark, SchoolClass, SchoolSettings, Staff, Student, Subject,
} from '../types';
import { avg, gradeFor, rank, round1, staffName, termById, termPercent } from './utils';

export interface ReportInputs {
  cls: SchoolClass;
  termId: string;
  students: Student[]; // students in this class
  allocations: Allocation[]; // all allocations (filtered inside)
  subjects: Map<string, Subject>;
  staff: Map<string, Staff>;
  assessments: Assessment[]; // all (filtered inside)
  marks: Map<string, Mark>; // key `${assessmentId}_${studentId}`
  attendance: AttendanceRegister[]; // all (filtered inside)
  remarks: Map<string, ReportRemark>; // key `${studentId}_${termId}`
  settings: SchoolSettings;
}

export interface ReportRow extends Omit<PublishedReport, 'id' | 'publishedAt'> {
  student: Student;
}

/** Compute report-card rows for every student in a class for a term. */
export function computeClassReports(inp: ReportInputs): ReportRow[] {
  const { cls, termId, students, settings } = inp;
  const term = termById(settings, termId);
  const allocs = inp.allocations.filter((a) => a.classId === cls.id);
  const subjectIds = [...new Set(allocs.map((a) => a.subjectId))].filter((id) => inp.subjects.has(id));
  subjectIds.sort((a, b) => inp.subjects.get(a)!.name.localeCompare(inp.subjects.get(b)!.name));
  const termAssess = inp.assessments.filter((a) => a.classId === cls.id && a.termId === termId);
  const regs = inp.attendance.filter((r) => r.classId === cls.id && (!term || (r.date >= term.start && r.date <= term.end)));

  const rows: ReportRow[] = students.map((s) => {
    const subjects = subjectIds.map((sid) => {
      const subj = inp.subjects.get(sid)!;
      const as = termAssess.filter((a) => a.subjectId === sid);
      const p = termPercent(as, inp.marks, s.id);
      const g = gradeFor(p, cls, settings);
      const alloc = allocs.find((a) => a.subjectId === sid);
      const comments = as.map((a) => inp.marks.get(`${a.id}_${s.id}`)?.comment).filter(Boolean);
      return {
        subjectId: sid,
        name: subj.name,
        mark: p == null ? null : Math.round(p),
        grade: g?.grade ?? '—',
        remark: g?.remark ?? 'No marks',
        teacher: staffName(alloc ? inp.staff.get(alloc.teacherId) : undefined),
        comment: comments[comments.length - 1],
      };
    });
    const marks = subjects.map((x) => x.mark).filter((m): m is number => m != null);
    const a = avg(marks);
    let present = 0, total = 0;
    for (const r of regs) {
      const m = r.records[s.id];
      if (!m) continue;
      total++;
      if (m === 'P' || m === 'L') present++;
    }
    const rem = inp.remarks.get(`${s.id}_${termId}`);
    return {
      student: s,
      studentId: s.id,
      classId: cls.id,
      className: cls.name,
      termId,
      subjects,
      average: a == null ? null : round1(a),
      position: null,
      classSize: students.length,
      attendance: { present, total },
      remarks: { classTeacher: rem?.classTeacher, head: rem?.head, conduct: rem?.conduct },
    };
  });

  const ranks = rank(rows, (r) => r.average);
  rows.forEach((r) => (r.position = ranks.get(r) ?? null));
  return rows.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
}

export function autoTeacherComment(avgPct: number | null, firstName: string): string {
  if (avgPct == null) return '';
  if (avgPct >= 80) return `${firstName} has produced outstanding work this term. Keep aiming high!`;
  if (avgPct >= 70) return `A very good term for ${firstName}. Consistent effort is paying off.`;
  if (avgPct >= 60) return `${firstName} is making good progress. More practice will lift the weaker subjects.`;
  if (avgPct >= 50) return `A fair effort. ${firstName} should focus on revision and completing all homework.`;
  return `${firstName} needs to work much harder and seek help from teachers. Parents are encouraged to follow up.`;
}

export function autoHeadComment(avgPct: number | null): string {
  if (avgPct == null) return '';
  if (avgPct >= 75) return 'Excellent results. Well done.';
  if (avgPct >= 60) return 'Good work. Keep it up.';
  if (avgPct >= 50) return 'Satisfactory. There is room for improvement.';
  return 'Must improve. Please see the class teacher.';
}
