// Join requests: people who sign up with a school's code wait here until the head
// accepts them. Everything is live (onSnapshot), so a request shows up on the
// head's screen the moment it is sent, and the person gets in the moment it is accepted.
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where, writeBatch, setDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signOut, updateProfile } from 'firebase/auth';
import { getFirebase, getSecondaryAuth, isFirebaseConfigured } from './firebase';
import { JoinRequest, Role, Staff, UserProfile } from '../types';
import { makeJoinCode } from './defaults';
import { store, newId } from './store';

export const REQUEST_ROLES: { role: JoinRequest['role']; label: string; hint: string }[] = [
  { role: 'teacher', label: 'Teacher', hint: 'Registers, marks and report remarks' },
  { role: 'bursar', label: 'Bursar', hint: 'Fees, receipts and statements' },
  { role: 'parent', label: 'Parent / guardian', hint: 'Your child’s results, attendance and fees' },
  { role: 'student', label: 'Learner', hint: 'Your timetable, results and notices' },
];

const online = () => isFirebaseConfigured && store.kind === 'firebase';

/** Live list of pending requests for the head's school. */
export function usePendingRequests(profile: UserProfile | null): JoinRequest[] {
  const [list, setList] = useState<JoinRequest[]>([]);
  const schoolId = profile?.role === 'admin' ? profile.schoolId : null;
  useEffect(() => {
    setList([]);
    if (!schoolId || !online()) return;
    const { db } = getFirebase();
    const q = query(collection(db, 'joinRequests'), where('schoolId', '==', schoolId), where('status', '==', 'pending'));
    return onSnapshot(q, (snap) => {
      setList(snap.docs.map((d) => ({ ...(d.data() as JoinRequest), id: d.id })).sort((a, b) => b.createdAt - a.createdAt));
    }, (err) => console.warn('[joinRequests]', err));
  }, [schoolId]);
  return list;
}

/** Look a school up by its join code (anyone may do this, even before signing up). */
export async function findSchoolByCode(code: string): Promise<{ schoolId: string; name: string } | null> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 6) return null;
  const { db } = getFirebase();
  const snap = await getDoc(doc(db, 'schoolCodes', clean));
  return snap.exists() ? (snap.data() as { schoolId: string; name: string }) : null;
}

/** Give an existing school a join code if it doesn't have one yet. */
export async function ensureJoinCode(schoolId: string, schoolName: string, current?: string): Promise<string> {
  if (current) return current;
  const { db } = getFirebase();
  const code = makeJoinCode();
  await setDoc(doc(db, 'schoolCodes', code), { schoolId, name: schoolName, createdAt: Date.now() });
  await store.update('settings', 'main', { joinCode: code });
  return code;
}

const splitName = (full: string) => {
  const parts = full.trim().replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : '';
  return { first: parts.join(' ') || full.trim(), last };
};

/** Staff record for a new teacher/bursar, so they show in the directory and can be allocated classes. */
function staffFor(name: string, email: string, role: Role, taken: number): Staff {
  const { first, last } = splitName(name);
  return {
    id: newId(), staffNo: `S${String(taken + 1).padStart(3, '0')}`, title: '', firstName: first, lastName: last, gender: 'F',
    position: role === 'bursar' ? 'Bursar' : 'Teacher', department: role === 'bursar' ? 'Finance' : 'Teaching',
    phone: '', email, hireDate: new Date().toISOString().slice(0, 10), status: 'active', createdAt: Date.now(),
  };
}

export interface AcceptOptions { role: JoinRequest['role']; staffId?: string; studentIds?: string[] }

/** Accept: create their profile (and a staff record for staff) and mark the request approved — in one batch. */
export async function acceptRequest(r: JoinRequest, o: AcceptOptions) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  let staffId = o.staffId;
  if ((o.role === 'teacher' || o.role === 'bursar') && !staffId) {
    const st = staffFor(r.name, r.email, o.role, store.peek('staff').length);
    b.set(doc(db, 'schools', r.schoolId, 'staff', st.id), st);
    staffId = st.id;
  }
  const students = store.peek('students');
  const studentIds = o.role === 'parent' || o.role === 'student' ? (o.studentIds ?? []) : undefined;
  const classIds = studentIds ? [...new Set(studentIds.map((id) => students.find((s) => s.id === id)?.classId).filter(Boolean) as string[])] : undefined;
  const p: UserProfile = {
    id: r.uid, name: r.name, email: r.email, role: o.role, schoolId: r.schoolId, createdAt: Date.now(),
    ...(staffId && (o.role === 'teacher' || o.role === 'bursar') ? { staffId } : {}),
    ...(studentIds ? { studentIds, classIds } : {}),
  };
  b.set(doc(db, 'users', r.uid), p);
  b.update(doc(db, 'joinRequests', r.uid), { status: 'approved', decidedAt: Date.now() });
  await b.commit();
}

export async function declineRequest(r: JoinRequest) {
  const { db } = getFirebase();
  const b = writeBatch(db);
  b.update(doc(db, 'joinRequests', r.uid), { status: 'declined', decidedAt: Date.now() });
  await b.commit();
}

export interface NewAccount { name: string; email: string; password: string; role: JoinRequest['role'] | 'admin'; studentIds?: string[] }

/** The head creates a login directly and chooses its password. */
export async function createAccount(schoolId: string, a: NewAccount) {
  if (!online()) {
    // browser-only demo: just add the profile so it appears in the list
    await store.set('users', { id: newId(), name: a.name, email: a.email, role: a.role, schoolId, createdAt: Date.now() });
    return;
  }
  const sec = getSecondaryAuth();
  const cred = await createUserWithEmailAndPassword(sec, a.email.trim(), a.password);
  await updateProfile(cred.user, { displayName: a.name }).catch(() => {});
  await signOut(sec).catch(() => {});
  const ops: Parameters<typeof store.commit>[0] = [];
  let staffId: string | undefined;
  if (a.role === 'teacher' || a.role === 'bursar' || a.role === 'admin') {
    const st = staffFor(a.name, a.email.trim(), a.role, store.peek('staff').length);
    if (a.role === 'admin') { st.position = 'Administrator'; st.department = 'Administration'; }
    ops.push({ op: 'set', col: 'staff', id: st.id, data: st });
    staffId = st.id;
  }
  const students = store.peek('students');
  const studentIds = a.role === 'parent' || a.role === 'student' ? (a.studentIds ?? []) : undefined;
  const classIds = studentIds ? [...new Set(studentIds.map((id) => students.find((s) => s.id === id)?.classId).filter(Boolean) as string[])] : undefined;
  const p: UserProfile = {
    id: cred.user.uid, name: a.name, email: a.email.trim(), role: a.role, schoolId, createdAt: Date.now(),
    ...(staffId ? { staffId } : {}), ...(studentIds ? { studentIds, classIds } : {}),
  };
  ops.push({ op: 'set', col: 'users', id: p.id, data: p as any });
  await store.commit(ops);
}
