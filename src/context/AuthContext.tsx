import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
  signInAnonymously,
} from 'firebase/auth';
import { deleteDoc, deleteField, doc, getDoc, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { JoinRequest, Role, Section, UserProfile, SchoolSettings, Staff } from '../types';
import { getFirebase, isFirebaseConfigured } from '../lib/firebase';
import { FirestoreBackend, LocalBackend } from '../lib/backend';
import { store, useCollection, useIndex } from '../lib/store';
import { makeJoinCode, newSchoolSettings, starterSubjects } from '../lib/defaults';
import { findSchoolByCode } from '../lib/joinRequests';
import { friendlyAuthError } from '../lib/authErrors';

type Mode = 'firebase' | 'demo';

/** Only used when the build has no Firebase keys: the demo then lives in this browser. */
const LOCAL_DEMO_KEY = 'musa-demo';

export interface RegisterArgs { name: string; email: string; password: string; schoolName: string; schoolType: Section }
export interface JoinArgs { code: string; name: string; email: string; password: string; role: JoinRequest['role']; note?: string }
export interface ViewAs { role: Role; staffId?: string; studentIds?: string[]; classIds?: string[] }

interface AuthCtx {
  ready: boolean;
  /** False when the build has no Firebase keys — sign-in cannot work until they are added. */
  configured: boolean;
  mode: Mode | null;
  profile: UserProfile | null;
  error: string | null;
  /** Signed up with a school code and waiting for the head to accept. */
  pending: JoinRequest | null;
  requestToJoin: (a: JoinArgs) => Promise<void>;
  cancelRequest: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  registerSchool: (args: RegisterArgs) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Create a demo account (anonymous Firebase login) with its own empty school. Data is saved. */
  startDemo: (type: Section) => Promise<void>;
  /** Demo only: look at the school as another role. */
  switchRole: (v: ViewAs) => Promise<void>;
  /** Leave the demo. The demo login is signed out on this device. */
  endDemo: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

const demoName = (type: Section) => (type === 'primary' ? 'Demo Primary School' : 'Demo High School');

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<JoinRequest | null>(null);
  const watchers = useRef<(() => void)[]>([]);
  const stopWatching = () => { watchers.current.forEach((u) => u()); watchers.current = []; };
  // while signing in / registering we load the profile ourselves, so the auth listener stays quiet
  const busy = useRef(false);
  const localDemo = useRef<LocalBackend | null>(null);

  const use = (p: UserProfile, backend: FirestoreBackend | LocalBackend) => {
    store.configure(backend, p);
    setProfile(p); setMode(p.demo ? 'demo' : 'firebase'); setError(null);
  };

  /** Load the signed-in user's profile and connect the store to their school. */
  const openProfile = async (uid: string): Promise<UserProfile> => {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) throw Object.assign(new Error('no profile'), { code: 'musa/no-profile' });
    const p = { ...(snap.data() as UserProfile), id: uid };
    if (p.disabled) throw Object.assign(new Error('This account has been disabled. Contact your school administrator.'), { code: 'musa/disabled' });
    use(p, new FirestoreBackend(db, p.schoolId));
    return p;
  };

  /** Wait for the head to accept: the moment a profile appears, go in. */
  const watchApproval = (uid: string) => {
    stopWatching();
    const { db } = getFirebase();
    watchers.current.push(onSnapshot(doc(db, 'users', uid), (snap) => {
      if (snap.exists()) { stopWatching(); setPending(null); openProfile(uid).catch((e) => setError(friendlyAuthError(e))); }
    }, () => {}));
    watchers.current.push(onSnapshot(doc(db, 'joinRequests', uid), (snap) => {
      if (snap.exists()) setPending({ ...(snap.data() as JoinRequest), id: uid });
    }, () => {}));
  };

  /** Profile if there is one; otherwise a pending join request; otherwise 'musa/no-profile'. */
  const resolveAccount = async (uid: string) => {
    try { await openProfile(uid); return; }
    catch (e: any) {
      if (e?.code !== 'musa/no-profile') throw e;
      const { db } = getFirebase();
      const req = await getDoc(doc(db, 'joinRequests', uid)).catch(() => null);
      if (!req?.exists()) throw e;
      store.reset(); setProfile(null); setMode(null);
      setPending({ ...(req.data() as JoinRequest), id: uid });
      watchApproval(uid);
    }
  };

  // ------------------------------------------------ browser-only demo (no Firebase keys)
  const openLocalDemo = (type: Section | null) => {
    const lb = new LocalBackend();
    if (type) {
      LocalBackend.clearAll();
      const me: UserProfile = { id: 'demo-me', name: 'Demo user', email: '', role: 'admin', schoolId: 'demo', demo: true, createdAt: Date.now() };
      lb.replaceAll({ settings: [newSchoolSettings(demoName(type), type)], subjects: starterSubjects(type), users: [me] });
    }
    let me: UserProfile | undefined;
    try { me = (JSON.parse(localStorage.getItem('musa-demo:v1:users') || '[]') as UserProfile[]).find((u) => u.id === 'demo-me'); } catch { /* ignore */ }
    if (!me) return false;
    localDemo.current = lb;
    use({ ...me, demo: true }, lb);
    try { localStorage.setItem(LOCAL_DEMO_KEY, '1'); } catch { /* ignore */ }
    return true;
  };

  useEffect(() => {
    // clear anything older versions left behind in this browser
    try { Object.keys(localStorage).filter((k) => k.startsWith('aceschool:v1:') || k === 'ace-demo-role').forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
    if (!isFirebaseConfigured) {
      let had = false;
      try { had = localStorage.getItem(LOCAL_DEMO_KEY) === '1'; } catch { /* ignore */ }
      if (had) openLocalDemo(null);
      setReady(true);
      return;
    }
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, async (fbUser) => {
      if (busy.current) return;
      if (!fbUser) { stopWatching(); store.reset(); setProfile(null); setMode(null); setPending(null); setReady(true); return; }
      try {
        await resolveAccount(fbUser.uid);
      } catch (e: any) {
        if (e?.code === 'musa/no-profile' && fbUser.isAnonymous) {
          // a demo whose school never got created — quietly drop it
          await signOut(auth).catch(() => {});
        } else {
          setError(e?.code === 'musa/no-profile'
            ? 'Your sign-up didn’t finish, so this account has no school yet. Go to “Create an account” and enter the same email and password to finish setting it up. Staff: ask your school office to add you.'
            : friendlyAuthError(e));
          await signOut(auth).catch(() => {});
        }
        setProfile(null);
      }
      setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** School + settings + first profile in one batch (the rules require it), then starter subjects. */
  const createSchool = async (uid: string, p: Omit<UserProfile, 'id' | 'schoolId'>, schoolName: string, schoolType: Section, demo: boolean) => {
    const { db } = getFirebase();
    const schoolId = `${demo ? 'demo' : 'sch'}-${uid.slice(0, 10).toLowerCase()}`;
    const joinCode = makeJoinCode();
    const b = writeBatch(db);
    b.set(doc(db, 'schools', schoolId), { name: schoolName, schoolType, ownerUid: uid, createdAt: Date.now(), ...(demo ? { demo: true } : {}) });
    b.set(doc(db, 'schools', schoolId, 'settings', 'main'), { ...newSchoolSettings(schoolName, schoolType), joinCode });
    b.set(doc(db, 'schoolCodes', joinCode), { schoolId, name: schoolName, createdAt: Date.now() });
    b.set(doc(db, 'users', uid), { ...p, id: uid, schoolId, createdAt: Date.now() });
    await b.commit();
    try {
      const subj = writeBatch(db);
      for (const s of starterSubjects(schoolType)) subj.set(doc(db, 'schools', schoolId, 'subjects', s.id), s);
      await subj.commit();
    } catch (e) { console.warn('Starter subjects not added', e); }
  };

  const value = useMemo<AuthCtx>(() => ({
    ready, mode, profile, error, pending, configured: isFirebaseConfigured,

    requestToJoin: async ({ code, name, email, password, role, note }) => {
      setError(null);
      const school = await findSchoolByCode(code);
      if (!school) throw new Error('No school has that code. Check it with your school office — it’s six letters and numbers.');
      const { auth, db } = getFirebase();
      const mail = email.trim();
      busy.current = true;
      try {
        let user;
        try { user = (await createUserWithEmailAndPassword(auth, mail, password)).user; }
        catch (e: any) {
          if (e?.code !== 'auth/email-already-in-use') throw e;
          try { user = (await signInWithEmailAndPassword(auth, mail, password)).user; } catch { throw e; }
          const has = await getDoc(doc(db, 'users', user.uid));
          if (has.exists()) { await openProfile(user.uid); setReady(true); return; } // already a member: just go in
        }
        await updateProfile(user, { displayName: name }).catch(() => {});
        const req: JoinRequest = {
          id: user.uid, uid: user.uid, schoolId: school.schoolId, schoolName: school.name, name: name.trim(), email: mail, role,
          ...(note?.trim() ? { note: note.trim() } : {}), status: 'pending', createdAt: Date.now(),
        };
        await deleteDoc(doc(db, 'joinRequests', user.uid)).catch(() => {}); // an old declined request
        await setDoc(doc(db, 'joinRequests', user.uid), req);
        setPending(req);
        watchApproval(user.uid);
        setReady(true);
      } finally {
        busy.current = false;
      }
    },

    cancelRequest: async () => {
      const { auth, db } = getFirebase();
      const uid = auth.currentUser?.uid;
      stopWatching();
      if (uid) await deleteDoc(doc(db, 'joinRequests', uid)).catch(() => {});
      await signOut(auth).catch(() => {});
      setPending(null);
    },

    login: async (email, password) => {
      setError(null);
      const { auth } = getFirebase();
      busy.current = true;
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        try { await resolveAccount(cred.user.uid); }
        catch (e: any) {
          await signOut(auth).catch(() => {});
          if (e?.code === 'musa/no-profile') throw new Error('This account has no school yet. If you were setting up a new school, go to “Create an account” and use the same email and password to finish. Staff: ask your school office to add you.');
          throw e;
        }
        setReady(true);
      } finally {
        busy.current = false;
      }
    },

    registerSchool: async ({ name, email, password, schoolName, schoolType }) => {
      setError(null);
      const { auth, db } = getFirebase();
      const mail = email.trim();
      busy.current = true;
      try {
        // If the email already exists it may be a sign-up that stopped half-way — sign in and finish it.
        let user = auth.currentUser && !auth.currentUser.isAnonymous && auth.currentUser.email?.toLowerCase() === mail.toLowerCase() ? auth.currentUser : null;
        if (!user) {
          try {
            user = (await createUserWithEmailAndPassword(auth, mail, password)).user;
          } catch (e: any) {
            if (e?.code !== 'auth/email-already-in-use') throw e;
            try { user = (await signInWithEmailAndPassword(auth, mail, password)).user; } catch { throw e; }
            const existing = await getDoc(doc(db, 'users', user.uid));
            if (existing.exists()) { await openProfile(user.uid); setReady(true); return; }
          }
        }
        if (!user.displayName) await updateProfile(user, { displayName: name }).catch(() => {});
        await createSchool(user.uid, { name, email: mail, role: 'admin' }, schoolName, schoolType, false);
        await openProfile(user.uid);
        setReady(true);
      } finally {
        busy.current = false;
      }
    },

    resetPassword: async (email) => { await sendPasswordResetEmail(getFirebase().auth, email.trim()); },

    logout: async () => {
      stopWatching(); store.reset(); setPending(null);
      if (localDemo.current) {
        LocalBackend.clearAll(); localDemo.current = null;
        try { localStorage.removeItem(LOCAL_DEMO_KEY); localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
      } else if (isFirebaseConfigured) await signOut(getFirebase().auth);
      setProfile(null); setMode(null);
    },

    startDemo: async (type) => {
      setError(null);
      try { localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
      if (!isFirebaseConfigured) { openLocalDemo(type); return; }
      const { auth } = getFirebase();
      busy.current = true;
      try {
        if (auth.currentUser) await signOut(auth);
        const { user } = await signInAnonymously(auth);
        await createSchool(user.uid, { name: 'Demo user', email: '', role: 'admin', demo: true }, demoName(type), type, true);
        await openProfile(user.uid);
        setReady(true);
      } catch (e) {
        await signOut(auth).catch(() => {});
        throw e;
      } finally {
        busy.current = false;
      }
    },

    switchRole: async (v) => {
      if (!profile?.demo) return;
      const next: UserProfile = { ...profile, role: v.role, staffId: v.staffId, studentIds: v.studentIds, classIds: v.classIds };
      if (localDemo.current) {
        const patch = { role: v.role, staffId: v.staffId ?? null, studentIds: v.studentIds ?? null, classIds: v.classIds ?? null };
        await localDemo.current.commit([{ op: 'update', col: 'users', id: profile.id, data: patch }]);
        use(next, localDemo.current);
        return;
      }
      const { db } = getFirebase();
      await updateDoc(doc(db, 'users', profile.id), {
        role: v.role,
        staffId: v.staffId ?? deleteField(),
        studentIds: v.studentIds ?? deleteField(),
        classIds: v.classIds ?? deleteField(),
      });
      use(next, new FirestoreBackend(db, profile.schoolId));
    },

    endDemo: async () => {
      stopWatching(); store.reset();
      if (localDemo.current) {
        LocalBackend.clearAll(); localDemo.current = null;
        try { localStorage.removeItem(LOCAL_DEMO_KEY); } catch { /* ignore */ }
      } else if (isFirebaseConfigured) await signOut(getFirebase().auth);
      try { localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
      setProfile(null); setMode(null);
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready, mode, profile, error, pending]);

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
