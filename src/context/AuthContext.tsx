import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
} from 'firebase/auth';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { Section, UserProfile, SchoolSettings, Staff } from '../types';
import { getFirebase, isFirebaseConfigured } from '../lib/firebase';
import { FirestoreBackend } from '../lib/backend';
import { store, useCollection, useIndex } from '../lib/store';
import { newSchoolSettings, starterSubjects } from '../lib/defaults';

type Mode = 'firebase';

export interface RegisterArgs { name: string; email: string; password: string; schoolName: string; schoolType: Section }

interface AuthCtx {
  ready: boolean;
  /** False when the build has no Firebase keys — sign-in cannot work until they are added. */
  configured: boolean;
  mode: Mode | null;
  profile: UserProfile | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  registerSchool: (args: RegisterArgs) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(!isFirebaseConfigured);
  const [mode, setMode] = useState<Mode | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // while registering, the auth listener must not report "not linked to a school" before the batch lands
  const registering = useRef(false);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    // clear anything the old in-browser sample school left behind
    try { Object.keys(localStorage).filter((k) => k.startsWith('aceschool:v1:') || k === 'ace-demo-role').forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    const { auth, db } = getFirebase();
    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) { setProfile(null); setMode(null); setReady(true); return; }
      if (registering.current) return;
      try {
        const snap = await getDoc(doc(db, 'users', fbUser.uid));
        if (!snap.exists()) {
          setError('This account is not linked to a school yet. Ask your school administrator to add you.');
          setProfile(null);
          await signOut(auth);
        } else {
          const p = { ...(snap.data() as UserProfile), id: fbUser.uid };
          if (p.disabled) { setError('This account has been disabled. Contact your school administrator.'); await signOut(auth); }
          else {
            store.configure(new FirestoreBackend(db, p.schoolId), p);
            setProfile(p); setMode('firebase'); setError(null);
          }
        }
      } catch (e: any) {
        setError(e.message);
      }
      setReady(true);
    });
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    ready, mode, profile, error, configured: isFirebaseConfigured,
    login: async (email, password) => {
      setError(null);
      await signInWithEmailAndPassword(getFirebase().auth, email.trim(), password);
    },
    registerSchool: async ({ name, email, password, schoolName, schoolType }) => {
      setError(null);
      const { auth, db } = getFirebase();
      registering.current = true;
      try {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(cred.user, { displayName: name });
        const schoolId = `sch-${cred.user.uid.slice(0, 10).toLowerCase()}`;
        // 1. school, its settings and the first admin — together, as the security rules require
        const b = writeBatch(db);
        b.set(doc(db, 'schools', schoolId), { name: schoolName, schoolType, ownerUid: cred.user.uid, createdAt: Date.now() });
        b.set(doc(db, 'schools', schoolId, 'settings', 'main'), newSchoolSettings(schoolName, schoolType));
        const p: UserProfile = { id: cred.user.uid, name, email: email.trim(), role: 'admin', schoolId, createdAt: Date.now() };
        b.set(doc(db, 'users', cred.user.uid), p);
        await b.commit();
        // 2. the usual ZIMSEC subjects for this kind of school (needs the admin profile to exist first)
        const subj = writeBatch(db);
        for (const s of starterSubjects(schoolType)) subj.set(doc(db, 'schools', schoolId, 'subjects', s.id), s);
        await subj.commit();
        store.configure(new FirestoreBackend(db, schoolId), p);
        setProfile(p); setMode('firebase'); setReady(true);
      } finally {
        registering.current = false;
      }
    },
    resetPassword: async (email) => { await sendPasswordResetEmail(getFirebase().auth, email.trim()); },
    logout: async () => {
      if (isFirebaseConfigured) await signOut(getFirebase().auth);
      setProfile(null); setMode(null);
    },
  }), [ready, mode, profile, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

// ----------------------------------------------------------------- helpers --
export function useSettings(): SchoolSettings | undefined {
  return useCollection('settings').data[0];
}

/** The signed-in user's staff record (teachers/admin/bursar). */
export function useMyStaff(): Staff | undefined {
  const { profile } = useAuth();
  const staff = useIndex('staff');
  return profile?.staffId ? staff.get(profile.staffId) : undefined;
}
