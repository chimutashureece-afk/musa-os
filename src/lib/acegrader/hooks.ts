import { useMemo } from 'react';
import { useAuth, useSettings } from '../../context/AuthContext';
import { useMyClasses } from '../hooks';
import { useCollection } from '../store';
import { currentTerm } from '../utils';
import type { Submission } from '../../types';

/** Submissions visible in AceGrader for the signed-in user (admins: all; teachers: own or in their classes), newest first. */
export function useAceSubmissions(): { data: Submission[]; loading: boolean } {
  const { profile } = useAuth();
  const { data, loading } = useCollection('submissions');
  const classes = useMyClasses();
  const out = useMemo(() => {
    const ids = new Set(classes.map((c) => c.id));
    const list = profile?.role === 'admin' ? data : data.filter((s) => s.teacherId === profile?.staffId || ids.has(s.classId));
    return [...list].sort((a, b) => b.timestamp - a.timestamp);
  }, [data, classes, profile]);
  return { data: out, loading };
}

export function useCurrentTermId() {
  const settings = useSettings();
  return currentTerm(settings)?.id ?? '';
}

/** Owner or admin may edit/delete a rubric. */
export function useRubricOwner() {
  const { profile } = useAuth();
  return (ownerId?: string) => profile?.role === 'admin' || (!!ownerId && ownerId === profile?.staffId) || (!ownerId && profile?.role === 'teacher');
}
