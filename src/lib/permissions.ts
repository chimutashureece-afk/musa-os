import { CollectionName, Role, UserProfile } from '../types';

/** Collections each role may write to (mirrored in firestore.rules). */
const WRITE: Record<Role, CollectionName[] | '*'> = {
  admin: '*',
  teacher: ['attendance', 'assessments', 'marks', 'remarks', 'incidents', 'rubrics', 'submissions', 'corrections', 'announcements', 'books', 'loans'],
  bursar: ['feeStructures', 'invoices', 'payments', 'announcements'],
  parent: [],
  student: [],
};

export function canWrite(role: Role | undefined, col: CollectionName): boolean {
  if (!role) return false;
  const w = WRITE[role];
  return w === '*' || w.includes(col);
}

export type Scope =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'in'; field: string; values: string[] }; // field 'id' = document id

const STUDENT_SCOPED: CollectionName[] = ['marks', 'invoices', 'payments', 'incidents', 'loans', 'reports', 'remarks', 'submissions'];

/** What part of a collection a user is allowed to read (mirrored in firestore.rules). */
export function scopeFor(col: CollectionName, p: UserProfile | null): Scope {
  if (!p) return { kind: 'none' };
  const role = p.role;
  if (role === 'admin') return { kind: 'all' };
  if (role === 'teacher') {
    if (['invoices', 'payments', 'feeStructures'].includes(col)) return { kind: 'none' };
    if (col === 'users') return { kind: 'in', field: 'id', values: [p.id] };
    return { kind: 'all' };
  }
  if (role === 'bursar') {
    if (['rubrics', 'submissions', 'corrections'].includes(col)) return { kind: 'none' };
    if (col === 'users') return { kind: 'in', field: 'id', values: [p.id] };
    return { kind: 'all' };
  }
  // parent / student
  const ids = p.studentIds ?? [];
  if (col === 'students') return { kind: 'in', field: 'id', values: ids };
  if (STUDENT_SCOPED.includes(col)) return { kind: 'in', field: 'studentId', values: ids };
  if (col === 'attendance') return { kind: 'in', field: 'classId', values: p.classIds ?? [] };
  if (col === 'users') return { kind: 'in', field: 'id', values: [p.id] };
  if (['rubrics', 'corrections', 'marks_all'].includes(col)) return { kind: 'none' };
  // classes, subjects, staff, allocations, timetable, assessments, events, announcements, books, feeStructures, settings
  return { kind: 'all' };
}

export const isStaffRole = (r?: Role) => r === 'admin' || r === 'teacher' || r === 'bursar';
