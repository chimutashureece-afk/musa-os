import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
} from 'firebase/auth';
import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { Section, UserProfile, SchoolSettings, Staff } from '../types';
import { getFirebase, isFirebaseConfigured } from '../lib/firebase';
import { FirestoreBackend, LocalBackend } from '../lib/backend';
import { store, useCollection, useIndex } from '../lib/store';
import { newSchoolSettings, starterSubjects } from '../lib/defaults';
import { friendlyAuthError } from '../lib/authErrors';

type Mode = 'firebase' | 'demo';

const DEMO_KEY = 'musa-demo';

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
  /** Open a blank practice school in this browser (nothing is sent to Firebase). */
  startDemo: (type: Section) => void;
  /** Leave the practice school and wipe it. */
  endDemo: () => void;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  // while registering, the auth listener must not report "not linked to a school" before the batch lands
  const registering = useRef(false);
  const demoActive = useRef(false);

  /** Load the signed-in user's profile and connect the store to their school. */
  const openProfile = async (uid: string): Promise<UserProfile> => {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) throw Object.assign(new Error('no profile'), { code: 'musa/no-profile' });
    const p = { ...(snap.data() as UserProfile), id: uid };
    if (p.disabled) throw Object.assign(new Error('This account has been disabled. Contact your school administrator.'), { code: 'musa/disabled' });
    store.configure(new FirestoreBackend(db, p.schoolId), p);
    setProfile(p); setMode('firebase'); setError(null);
    return p;
  };

  const enterDemo = (type: Section, fresh: boolean) => {
    const lb = new LocalBackend();
    if (fresh || !LocalBackend.hasData()) {
      LocalBackend.clearAll();
      const me: UserProfile = { id: 'demo-admin', name: 'You', email: 'practice@musa-os', role: 'admin', schoolId: 'practice', createdAt: Date.now() };
      lb.replaceAll({
        settings: [newSchoolSettings(type === 'primary' ? 'Practice Primary School' : 'Practice High School', type)],
        subjects: starterSubjects(type),
        users: [me],
      });
    }
    let me: UserProfile | undefined;
    try { me = (JSON.parse(localStorage.getItem('musa-demo:v1:users') || '[]') as UserProfile[]).find((u) => u.id === 'demo-admin'); } catch { /* ignore */ }
    me ??= { id: 'demo-admin', name: 'You', email: 'practice@musa-os', role: 'admin', schoolId: 'practice' };
    demoActive.current = true;
    store.configure(lb, me);
    try { localStorage.setItem(DEMO_KEY, type); } catch { /* ignore */ }
    setProfile(me); setMode('demo'); setError(null); setReady(true);
  };

  useEffect(() => {
    let demo: string | null = null;
    try { demo = localStorage.getItem(DEMO_KEY); } catch { /* ignore */ }
    if (demo === 'primary' || demo === 'secondary') enterDemo(demo, false);
    if (!isFirebaseConfigured) { setReady(true); return; }
    // clear anything the old in-browser sample school left behind
    try { Object.keys(localStorage).filter((k) => k.startsWith('aceschool:v1:') || k === 'ace-demo-role').forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    const { auth, db } = getFirebase();
    return onAuthStateChanged(auth, async (fbUser) => {
      if (demoActive.current) return;
      if (!fbUser) { setProfile(null); setMode(null); setReady(true); return; }
      if (registering.current) return;
      try {
        await openProfile(fbUser.uid);
      } catch (e: any) {
        if (e?.code === 'musa/no-profile') {
          setError('Your sign-up didn’t finish, so this account has no school yet. Go to “Create an account” and enter the same email and password to finish setting it up. Staff: ask your school office to add you.');
        } else setError(friendlyAuthError(e));
        setProfile(null);
        await signOut(auth).catch(() => {});
      }
      setReady(true);
    });
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    ready, mode, profile, error, configured: isFirebaseConfigured,
    login: async (email, password) => {
      setError(null);
      demoActive.current = false;
      const { auth } = getFirebase();
      registering.current = true; // keep the auth listener quiet; we load the profile here
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        try { await openProfile(cred.user.uid); }
        catch (e: any) {
          await signOut(auth).catch(() => {});
          if (e?.code === 'musa/no-profile') throw new Error('This account has no school yet. If you were setting up a new school, go to “Create an account” and use the same email and password to finish. Staff: ask your school office to add you.');
          throw e;
        }
        setReady(true);
      } finally {
        registering.current = false;
      }
    },
    registerSchool: async ({ name, email, password, schoolName, schoolType }) => {
      setError(null);
      demoActive.current = false;
      const { auth, db } = getFirebase();
      const mail = email.trim();
      registering.current = true;
      try {
        // 1. the login. If the email already exists, it may be a sign-up that stopped half-way
        //    (for example the database rules weren't published yet) — sign in and finish it.
        let user = auth.currentUser?.email?.toLowerCase() === mail.toLowerCase() ? auth.currentUser : null;
        if (!user) {
          try {
            user = (await createUserWithEmailAndPassword(auth, mail, password)).user;
          } catch (e: any) {
            if (e?.code !== 'auth/email-already-in-use') throw e;
            try { user = (await signInWithEmailAndPassword(auth, mail, password)).user; } catch { throw e; }
            const existing = await getDoc(doc(db, 'users', user.uid));
            if (existing.exists()) { await openProfile(user.uid); setReady(true); return; } // already set up: just go in
          }
        }
        if (!user.displayName) await updateProfile(user, { displayName: name }).catch(() => {});

        // 2. school, its settings and the first admin — in one batch, as the security rules require
        const schoolId = `sch-${user.uid.slice(0, 10).toLowerCase()}`;
        const b = writeBatch(db);
        b.set(doc(db, 'schools', schoolId), { name: schoolName, schoolType, ownerUid: user.uid, createdAt: Date.now() });
        b.set(doc(db, 'schools', schoolId, 'settings', 'main'), newSchoolSettings(schoolName, schoolType));
        const p: UserProfile = { id: user.uid, name, email: mail, role: 'admin', schoolId, createdAt: Date.now() };
        b.set(doc(db, 'users', user.uid), p);
        await b.commit();

        // 3. the usual ZIMSEC subjects for this kind of school. Not critical — the admin can add them.
        try {
          const subj = writeBatch(db);
          for (const s of starterSubjects(schoolType)) subj.set(doc(db, 'schools', schoolId, 'subjects', s.id), s);
          await subj.commit();
        } catch (e) { console.warn('Starter subjects not added', e); }

        await openProfile(user.uid);
        setReady(true);
      } finally {
        registering.current = false;
      }
    },
    resetPassword: async (email) => { await sendPasswordResetEmail(getFirebase().auth, email.trim()); },
    logout: async () => {
      if (mode === 'demo') { demoActive.current = false; LocalBackend.clearAll(); try { localStorage.removeItem(DEMO_KEY); localStorage.removeItem('musa-tour'); } catch { /* ignore */ } }
      else if (isFirebaseConfigured) await signOut(getFirebase().auth);
      setProfile(null); setMode(null);
    },
    startDemo: (type) => enterDemo(type, true),
    endDemo: () => {
      demoActive.current = false;
      LocalBackend.clearAll();
      try { localStorage.removeItem(DEMO_KEY); localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
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
