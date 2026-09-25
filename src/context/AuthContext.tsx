import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail, updateProfile,
  signInWithPopup, signInWithRedirect, GoogleAuthProvider, updatePassword, reauthenticateWithCredential, EmailAuthProvider, User,
} from 'firebase/auth';
import { deleteDoc, deleteField, doc, getDoc, getDocFromServer, onSnapshot, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { JoinRequest, Role, SchoolRequest, Section, UserProfile, SchoolSettings, Staff } from '../types';
import { getFirebase, isFirebaseConfigured } from '../lib/firebase';
import { FirestoreBackend, LocalBackend } from '../lib/backend';
import { store, useCollection, useIndex } from '../lib/store';
import { makeJoinCode, newSchoolSettings, starterSubjects } from '../lib/defaults';
import { findSchoolByCode } from '../lib/joinRequests';
import { friendlyAuthError } from '../lib/authErrors';
import { DEMO_MS, isOwnerEmail } from '../lib/owner';

type Mode = 'firebase' | 'demo';

/** Only used when the build has no Firebase keys: the demo then lives in this browser. */
const LOCAL_DEMO_KEY = 'musa-demo';
/** A plain email check — the demo takes the email as typed (nothing is sent to it). */
const EMAIL_RE = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
/** A demo login is opened by its email alone, so its password is worked out from the email.
 *  (Keeping the demo as a real school swaps this for a password the head chooses.) */
const demoPassword = (email: string) => `musa-demo-v1::${email}`;
/** Firestore keeps retrying writes it can't send, so a dead connection would spin forever — give up after a while. */
function withTimeout<T>(p: Promise<T>, ms = 20_000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'musa/timeout' })), ms))]);
}

export interface RegisterArgs { name: string; email: string; password: string; schoolName: string; schoolType: Section; phone?: string; message?: string }
export interface JoinArgs { code: string; name: string; email: string; password: string; role: JoinRequest['role']; note?: string }
export interface ViewAs { role: Role; staffId?: string; studentIds?: string[]; classIds?: string[] }
export interface Locked { uid: string; email: string; schoolId: string; schoolName: string; schoolType: Section; endedAt: number }

interface AuthCtx {
  ready: boolean;
  /** False when the build has no Firebase keys — sign-in cannot work until they are added. */
  configured: boolean;
  mode: Mode | null;
  profile: UserProfile | null;
  error: string | null;
  /** Signed up with a school code and waiting for the head to accept. */
  pending: JoinRequest | null;
  /** Asked Musa OS for a real school and waiting for the owners to approve. */
  application: SchoolRequest | null;
  /** A demo whose day is over. */
  locked: Locked | null;
  /** Signed in as one of the Musa OS owners. */
  owner: User | null;
  requestToJoin: (a: JoinArgs) => Promise<void>;
  cancelRequest: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Ask the owners for a new school (creates the login now; the school once approved). */
  registerSchool: (args: RegisterArgs) => Promise<void>;
  /** From a demo (running or locked): ask to keep this school as a real one. The password becomes the
   *  head's sign-in, so the school can be opened from any device once approved. */
  requestFullAccess: (a: { name: string; schoolName: string; password: string; phone?: string; message?: string }) => Promise<void>;
  cancelApplication: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Open (or reopen) the one-day demo for this email. No email is sent. */
  startEmailDemo: (email: string, type: Section) => Promise<void>;
  /** Owners: sign in with Google (their Google email is already verified). */
  ownerSignIn: () => Promise<void>;
  /** Browser-only practice school (used only when the build has no Firebase keys). */
  startDemo: (type: Section) => Promise<void>;
  /** Demo only: look at the school as another role. */
  switchRole: (v: ViewAs) => Promise<void>;
  /** Leave the demo on this device. */
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
  const [application, setApplication] = useState<SchoolRequest | null>(null);
  const [locked, setLocked] = useState<Locked | null>(null);
  const [owner, setOwner] = useState<User | null>(null);
  const watchers = useRef<(() => void)[]>([]);
  const stopWatching = () => { watchers.current.forEach((u) => u()); watchers.current = []; };
  // while signing in / registering we load the profile ourselves, so the auth listener stays quiet
  const busy = useRef(false);
  const localDemo = useRef<LocalBackend | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAll = () => {
    stopWatching(); store.reset();
    if (lockTimer.current) clearTimeout(lockTimer.current);
    setProfile(null); setMode(null); setPending(null); setApplication(null); setLocked(null); setOwner(null);
  };

  const use = (p: UserProfile, backend: FirestoreBackend | LocalBackend) => {
    store.configure(backend, p);
    setProfile(p); setMode(p.demo ? 'demo' : 'firebase'); setError(null); setLocked(null);
  };

  /** A demo school's lock time, or 0 for a real school. */
  const schoolExpiry = async (schoolId: string): Promise<{ demo: boolean; expires: number; name: string; type: Section }> => {
    const { db } = getFirebase();
    const s = await getDoc(doc(db, 'schools', schoolId)).catch(() => null);
    const d = (s?.data() ?? {}) as any;
    return { demo: !!d.demo, expires: Number(d.demoExpiresAt ?? 0), name: d.name ?? 'Demo school', type: d.schoolType ?? 'secondary' };
  };

  /** Load the signed-in user's profile and connect the store to their school (or show the demo as locked). */
  const openProfile = async (uid: string): Promise<UserProfile | null> => {
    const { db, auth } = getFirebase();
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) throw Object.assign(new Error('no profile'), { code: 'musa/no-profile' });
    const p = { ...(snap.data() as UserProfile), id: uid };
    if (p.disabled) throw Object.assign(new Error('This account has been disabled. Contact your school administrator.'), { code: 'musa/disabled' });
    if (p.demo) {
      const exp = p.demoExpiresAt ?? 0;
      if (!exp || Date.now() >= exp) {
        // the school is locked by the rules too; show the "demo ended" page instead
        store.reset(); setProfile(null); setMode(null);
        setLocked({ uid, email: p.email || auth.currentUser?.email || '', schoolId: p.schoolId, schoolName: '', schoolType: 'secondary', endedAt: exp });
        schoolExpiry(p.schoolId).then((s) => setLocked((l) => (l ? { ...l, schoolName: s.name, schoolType: s.type } : l)));
        const req = await getDoc(doc(db, 'schoolRequests', uid)).catch(() => null);
        if (req?.exists()) { setApplication({ ...(req.data() as SchoolRequest), id: uid }); watchApplication(uid); }
        return null;
      }
      getDoc(doc(db, 'schoolRequests', uid)).then((r) => { if (r.exists() && (r.data() as SchoolRequest).status === 'pending') { setApplication({ ...(r.data() as SchoolRequest), id: uid }); watchApplication(uid); } }).catch(() => {});
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => { openProfile(uid).catch(() => {}); }, Math.min(exp - Date.now() + 1000, 2 ** 31 - 1));
    }
    use(p, new FirestoreBackend(db, p.schoolId));
    return p;
  };

  /** Wait for the head to accept a join request: the moment a profile appears, go in. */
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

  /** Wait for the owners to approve a school: follow the request, and go in once it's approved. */
  const watchApplication = (uid: string) => {
    stopWatching();
    const { db } = getFirebase();
    watchers.current.push(onSnapshot(doc(db, 'schoolRequests', uid), (snap) => {
      if (!snap.exists()) return;
      const r = { ...(snap.data() as SchoolRequest), id: uid };
      setApplication(r);
      if (r.status === 'approved') {
        stopWatching();
        // give the approval batch a moment to land, then open the school
        setTimeout(() => { setApplication(null); setLocked(null); openProfile(uid).catch((e) => setError(friendlyAuthError(e))); }, 600);
      }
    }, () => {}));
  };

  /** Profile if there is one; otherwise a pending join request or school application; otherwise 'musa/no-profile'. */
  const resolveAccount = async (user: User) => {
    const uid = user.uid;
    if (isOwnerEmail(user.email)) {
      // the owners use the owner console; they may also belong to a school
      clearAll(); setOwner(user); return;
    }
    try { await openProfile(uid); return; }
    catch (e: any) {
      if (e?.code !== 'musa/no-profile') throw e;
      const { db } = getFirebase();
      const req = await getDoc(doc(db, 'joinRequests', uid)).catch(() => null);
      if (req?.exists()) {
        store.reset(); setProfile(null); setMode(null);
        setPending({ ...(req.data() as JoinRequest), id: uid });
        watchApproval(uid);
        return;
      }
      const app = await getDoc(doc(db, 'schoolRequests', uid)).catch(() => null);
      if (app?.exists()) {
        store.reset(); setProfile(null); setMode(null);
        setApplication({ ...(app.data() as SchoolRequest), id: uid });
        watchApplication(uid);
        return;
      }
      throw e;
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

  /** A one-day demo school for this demo login. */
  const createDemo = async (user: User, type: Section, email: string) => {
    const { db } = getFirebase();
    const uid = user.uid;
    const schoolId = `demo-${uid.slice(0, 10).toLowerCase()}`;
    const expires = Date.now() + DEMO_MS - 60_000; // a minute of slack for clock differences (rules allow 24 h + 5 min)
    const joinCode = makeJoinCode();
    const name = demoName(type);
    const b = writeBatch(db);
    b.set(doc(db, 'schools', schoolId), { name, schoolType: type, ownerUid: uid, createdAt: Date.now(), demo: true, demoExpiresAt: expires, demoEmail: email });
    b.set(doc(db, 'schools', schoolId, 'settings', 'main'), { ...newSchoolSettings(name, type), joinCode });
    b.set(doc(db, 'schoolCodes', joinCode), { schoolId, name, createdAt: Date.now() });
    const p: UserProfile = { id: uid, name: email.split('@')[0] || 'Demo user', email, role: 'admin', schoolId, demo: true, demoExpiresAt: expires, createdAt: Date.now() };
    b.set(doc(db, 'users', uid), p);
    await withTimeout(b.commit());
    try {
      const subj = writeBatch(db);
      for (const s of starterSubjects(type)) subj.set(doc(db, 'schools', schoolId, 'subjects', s.id), s);
      await subj.commit();
    } catch (e) { console.warn('Starter subjects not added', e); }
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
      if (!fbUser) { clearAll(); setReady(true); return; }
      try {
        await resolveAccount(fbUser);
      } catch (e: any) {
        if (e?.code === 'musa/no-profile' && fbUser.isAnonymous) {
          await signOut(auth).catch(() => {}); // an old anonymous demo
        } else {
          setError(e?.code === 'musa/no-profile'
            ? 'This account has no school yet. If you applied for a school, sign in again once Musa OS has approved it. Staff: ask your school office to add you.'
            : friendlyAuthError(e));
          await signOut(auth).catch(() => {});
        }
        setProfile(null);
      }
      setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    ready, mode, profile, error, pending, application, locked, owner, configured: isFirebaseConfigured,

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
        try { await resolveAccount(cred.user); }
        catch (e: any) {
          await signOut(auth).catch(() => {});
          if (e?.code === 'musa/no-profile') throw new Error('This account has no school yet. Staff: ask your school office to add you. Heads: your school appears once Musa OS approves it.');
          throw e;
        }
        setReady(true);
      } finally {
        busy.current = false;
      }
    },

    registerSchool: async ({ name, email, password, schoolName, schoolType, phone, message }) => {
      setError(null);
      const { auth, db } = getFirebase();
      const mail = email.trim();
      busy.current = true;
      try {
        let user: User | null = null;
        try {
          user = (await createUserWithEmailAndPassword(auth, mail, password)).user;
        } catch (e: any) {
          if (e?.code !== 'auth/email-already-in-use') throw e;
          try { user = (await signInWithEmailAndPassword(auth, mail, password)).user; } catch { throw e; }
          const existing = await getDoc(doc(db, 'users', user.uid));
          if (existing.exists()) { await resolveAccount(user); setReady(true); return; }
        }
        if (!user.displayName) await updateProfile(user, { displayName: name }).catch(() => {});
        if (isOwnerEmail(user.email)) { clearAll(); setOwner(user); setReady(true); return; }
        const req: SchoolRequest = {
          id: user.uid, uid: user.uid, kind: 'new', name: name.trim(), email: mail, schoolName: schoolName.trim(), schoolType,
          ...(phone?.trim() ? { phone: phone.trim() } : {}), ...(message?.trim() ? { message: message.trim() } : {}),
          status: 'pending', createdAt: Date.now(),
        };
        await deleteDoc(doc(db, 'schoolRequests', user.uid)).catch(() => {});
        await setDoc(doc(db, 'schoolRequests', user.uid), req);
        store.reset(); setProfile(null); setMode(null);
        setApplication(req);
        watchApplication(user.uid);
        setReady(true);
      } finally {
        busy.current = false;
      }
    },

    requestFullAccess: async ({ name, schoolName, password, phone, message }) => {
      // from the "demo ended" page, or from a demo that's still running
      const settings = store.peek('settings')[0];
      const src = locked ?? (profile?.demo ? { uid: profile.id, email: profile.email, schoolId: profile.schoolId, schoolName: settings?.name ?? '', schoolType: (settings?.schoolType ?? 'secondary') as Section } : null);
      if (!src) return;
      const { auth, db } = getFirebase();
      // swap the demo's email-only login for a password the head chooses (nothing is emailed)
      const me = auth.currentUser;
      if (me && me.email) {
        if ((password ?? '').length < 6) throw new Error('Choose a password of at least 6 characters.');
        try { await updatePassword(me, password); }
        catch (e: any) {
          if (e?.code !== 'auth/requires-recent-login') throw e;
          await reauthenticateWithCredential(me, EmailAuthProvider.credential(me.email, demoPassword(me.email)));
          await updatePassword(me, password);
        }
      }
      const req: SchoolRequest = {
        id: src.uid, uid: src.uid, kind: 'upgrade', name: name.trim(), email: src.email, schoolName: schoolName.trim() || src.schoolName,
        schoolType: src.schoolType, schoolId: src.schoolId,
        ...(phone?.trim() ? { phone: phone.trim() } : {}), ...(message?.trim() ? { message: message.trim() } : {}),
        status: 'pending', createdAt: Date.now(),
      };
      await deleteDoc(doc(db, 'schoolRequests', src.uid)).catch(() => {});
      await setDoc(doc(db, 'schoolRequests', src.uid), req);
      setApplication(req);
      watchApplication(src.uid);
    },

    cancelApplication: async () => {
      const { auth, db } = getFirebase();
      const uid = auth.currentUser?.uid;
      stopWatching();
      if (uid) await deleteDoc(doc(db, 'schoolRequests', uid)).catch(() => {});
      if (!locked) await signOut(auth).catch(() => {});
      setApplication(null);
    },

    resetPassword: async (email) => { await sendPasswordResetEmail(getFirebase().auth, email.trim()); },

    logout: async () => {
      clearAll();
      if (localDemo.current) {
        LocalBackend.clearAll(); localDemo.current = null;
        try { localStorage.removeItem(LOCAL_DEMO_KEY); localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
      } else if (isFirebaseConfigured) await signOut(getFirebase().auth);
    },

    startEmailDemo: async (email, type) => {
      setError(null);
      const mail = email.trim().toLowerCase();
      if (!EMAIL_RE.test(mail)) throw new Error('Type a valid email address, like name@school.co.zw.');
      if (isOwnerEmail(mail)) throw new Error('That’s a Musa OS owner email — use Owner sign-in instead.');
      const { auth, db } = getFirebase();
      busy.current = true;
      try {
        if (auth.currentUser && auth.currentUser.email !== mail) await signOut(auth).catch(() => {});
        // same email as before → the same demo, on any device; a new email → a new demo
        let user: User | null = auth.currentUser;
        if (!user) {
          try { user = (await withTimeout(signInWithEmailAndPassword(auth, mail, demoPassword(mail)))).user; }
          catch (e: any) {
            if (!['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-login-credentials'].includes(e?.code)) throw e;
            try { user = (await withTimeout(createUserWithEmailAndPassword(auth, mail, demoPassword(mail)))).user; }
            catch (e2: any) {
              if (e2?.code === 'auth/email-already-in-use') throw new Error('This email already has a Musa OS account with its own password. Use Sign in instead.');
              throw e2;
            }
          }
        }
        const has = await withTimeout(getDocFromServer(doc(db, 'users', user.uid)));
        if (!has.exists()) {
          const app = await getDocFromServer(doc(db, 'schoolRequests', user.uid)).catch(() => null);
          if (!app?.exists()) {
            try { localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
            await createDemo(user, type, mail);
          }
        }
        await withTimeout(resolveAccount(user));
        setReady(true);
      } catch (e) {
        await signOut(auth).catch(() => {});
        clearAll();
        throw e;
      } finally {
        busy.current = false;
      }
    },

    ownerSignIn: async () => {
      setError(null);
      const { auth } = getFirebase();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      busy.current = true;
      try {
        let user: User;
        try { user = (await signInWithPopup(auth, provider)).user; }
        catch (e: any) {
          if (e?.code === 'auth/popup-blocked') { await signInWithRedirect(auth, provider); return; }
          throw e;
        }
        if (!isOwnerEmail(user.email)) {
          await signOut(auth).catch(() => {});
          throw new Error('That Google account isn’t one of the Musa OS owners.');
        }
        clearAll(); setOwner(user); setReady(true);
      } finally {
        busy.current = false;
      }
    },

    startDemo: async (type) => {
      setError(null);
      try { localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
      openLocalDemo(type);
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
      clearAll();
      if (localDemo.current) {
        LocalBackend.clearAll(); localDemo.current = null;
        try { localStorage.removeItem(LOCAL_DEMO_KEY); } catch { /* ignore */ }
      } else if (isFirebaseConfigured) await signOut(getFirebase().auth);
      try { localStorage.removeItem('musa-tour'); } catch { /* ignore */ }
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready, mode, profile, error, pending, application, locked, owner]);

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
