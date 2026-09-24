import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { CollectionName, SchoolClass, Student } from '../types';
import { canWrite } from './permissions';
import { useCollection } from './store';
import { classSort } from './utils';

export const useCan = (col: CollectionName) => canWrite(useAuth().profile?.role, col);

/** Classes sorted by level. */
export function useClasses(): SchoolClass[] {
  const { data } = useCollection('classes');
  return useMemo(() => [...data].sort(classSort), [data]);
}

/** Active students of a class, sorted by surname. */
export function useClassStudents(classId?: string): Student[] {
  const { data } = useCollection('students');
  return useMemo(
    () => data.filter((s) => s.classId === classId && s.status === 'active').sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
    [data, classId],
  );
}

/**
 * Classes relevant to the signed-in user: admins see all; teachers see classes they
 * teach or are class teacher of (falls back to all if none); parents/students see their children's classes.
 */
export function useMyClasses(): SchoolClass[] {
  const { profile } = useAuth();
  const classes = useClasses();
  const { data: allocs } = useCollection('allocations');
  return useMemo(() => {
    if (!profile) return [];
    if (profile.role === 'admin' || profile.role === 'bursar') return classes;
    if (profile.role === 'teacher') {
      const ids = new Set(allocs.filter((a) => a.teacherId === profile.staffId).map((a) => a.classId));
      classes.forEach((c) => c.classTeacherId === profile.staffId && ids.add(c.id));
      const mine = classes.filter((c) => ids.has(c.id));
      return mine.length ? mine : classes;
    }
    const ids = new Set(profile.classIds ?? []);
    return classes.filter((c) => ids.has(c.id));
  }, [profile, classes, allocs]);
}

/** Subjects a teacher teaches in a class (admins: all subjects allocated to the class). */
export function useClassSubjects(classId?: string) {
  const { profile } = useAuth();
  const { data: allocs } = useCollection('allocations');
  const { data: subjects } = useCollection('subjects');
  return useMemo(() => {
    const al = allocs.filter((a) => a.classId === classId);
    const mineOnly = profile?.role === 'teacher' && al.some((a) => a.teacherId === profile.staffId);
    const ids = new Set(al.filter((a) => !mineOnly || a.teacherId === profile!.staffId).map((a) => a.subjectId));
    return subjects.filter((s) => ids.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [allocs, subjects, classId, profile]);
}

/** Students linked to a parent / student account. */
export function useMyChildren(): Student[] {
  const { profile } = useAuth();
  const { data } = useCollection('students');
  return useMemo(() => data.filter((s) => profile?.studentIds?.includes(s.id)), [data, profile]);
}
