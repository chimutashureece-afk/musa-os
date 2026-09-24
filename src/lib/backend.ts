import {
  collection, doc, onSnapshot, query, where, documentId, writeBatch, setDoc, updateDoc, deleteDoc, Firestore,
} from 'firebase/firestore';
import { CollectionName, UserProfile } from '../types';
import { Scope, scopeFor } from './permissions';

export type AnyDoc = { id: string; [k: string]: any };
export type WriteOp =
  | { op: 'set'; col: CollectionName; id: string; data: AnyDoc }
  | { op: 'update'; col: CollectionName; id: string; data: Partial<AnyDoc> }
  | { op: 'delete'; col: CollectionName; id: string };

export interface Backend {
  kind: 'local' | 'firebase';
  subscribe(col: CollectionName, profile: UserProfile | null, cb: (docs: AnyDoc[]) => void, onError?: (e: Error) => void): () => void;
  commit(ops: WriteOp[]): Promise<void>;
}

const stripUndefined = (o: any): any => {
  if (Array.isArray(o)) return o.map(stripUndefined);
  if (o && typeof o === 'object') {
    const r: any = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = stripUndefined(v);
    return r;
  }
  return o;
};

const applyScope = (docs: AnyDoc[], scope: Scope): AnyDoc[] => {
  if (scope.kind === 'all') return docs;
  if (scope.kind === 'none') return [];
  const set = new Set(scope.values);
  return docs.filter((d) => set.has(d[scope.field]));
};

// ======================================================= PRACTICE (demo) ==
// The demo is a blank practice school kept only in this browser — no sample data.
const LS_PREFIX = 'musa-demo:v1:';

export class LocalBackend implements Backend {
  kind = 'local' as const;
  private mem = new Map<CollectionName, Map<string, AnyDoc>>();
  private listeners = new Map<CollectionName, Set<() => void>>();

  constructor() {
    window.addEventListener('storage', (e) => {
      if (!e.key?.startsWith(LS_PREFIX)) return;
      const col = e.key.slice(LS_PREFIX.length) as CollectionName;
      this.mem.delete(col);
      this.listeners.get(col)?.forEach((l) => l());
    });
  }

  static hasData(): boolean {
    try { return localStorage.getItem(LS_PREFIX + 'settings') !== null; } catch { return false; }
  }

  static clearAll() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX)).forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
  }

  private load(col: CollectionName): Map<string, AnyDoc> {
    let m = this.mem.get(col);
    if (!m) {
      m = new Map();
      try {
        const raw = localStorage.getItem(LS_PREFIX + col);
        if (raw) for (const d of JSON.parse(raw) as AnyDoc[]) m.set(d.id, d);
      } catch { /* ignore */ }
      this.mem.set(col, m);
    }
    return m;
  }

  private persist(col: CollectionName) {
    const m = this.load(col);
    try {
      localStorage.setItem(LS_PREFIX + col, JSON.stringify([...m.values()]));
    } catch (e) {
      console.error('Local storage is full or unavailable', e);
      throw new Error('Browser storage is full. Restart the demo to clear it.');
    }
  }

  subscribe(col: CollectionName, profile: UserProfile | null, cb: (docs: AnyDoc[]) => void) {
    const emit = () => cb(applyScope([...this.load(col).values()], scopeFor(col, profile)));
    let set = this.listeners.get(col);
    if (!set) { set = new Set(); this.listeners.set(col, set); }
    set.add(emit);
    queueMicrotask(emit);
    return () => { set!.delete(emit); };
  }

  async commit(ops: WriteOp[]) {
    const touched = new Set<CollectionName>();
    for (const o of ops) {
      const m = this.load(o.col);
      if (o.op === 'set') m.set(o.id, stripUndefined({ ...o.data, id: o.id }));
      else if (o.op === 'update') {
        const prev = m.get(o.id);
        if (prev) m.set(o.id, stripUndefined({ ...prev, ...o.data, id: o.id }));
      } else m.delete(o.id);
      touched.add(o.col);
    }
    touched.forEach((c) => this.persist(c));
    touched.forEach((c) => this.listeners.get(c)?.forEach((l) => l()));
  }

  /** Raw write used by seeding / backup import. */
  replaceAll(data: Partial<Record<CollectionName, AnyDoc[]>>) {
    for (const [col, docs] of Object.entries(data) as [CollectionName, AnyDoc[]][]) {
      const m = new Map<string, AnyDoc>();
      docs.forEach((d) => m.set(d.id, d));
      this.mem.set(col, m);
      this.persist(col);
      this.listeners.get(col)?.forEach((l) => l());
    }
  }
}

// ========================================================= FIRESTORE =========
export class FirestoreBackend implements Backend {
  kind = 'firebase' as const;
  constructor(private db: Firestore, private schoolId: string) {}

  private colRef(col: CollectionName) {
    // users live at the top level so login can find a profile before knowing the school
    return col === 'users' ? collection(this.db, 'users') : collection(this.db, 'schools', this.schoolId, col);
  }
  private docRef(col: CollectionName, id: string) {
    return col === 'users' ? doc(this.db, 'users', id) : doc(this.db, 'schools', this.schoolId, col, id);
  }

  subscribe(col: CollectionName, profile: UserProfile | null, cb: (docs: AnyDoc[]) => void, onError?: (e: Error) => void) {
    const scope = scopeFor(col, profile);
    if (scope.kind === 'none') { queueMicrotask(() => cb([])); return () => {}; }

    const base = this.colRef(col);
    const queries =
      scope.kind === 'all'
        ? [col === 'users' ? query(base, where('schoolId', '==', this.schoolId)) : query(base)]
        : chunk(scope.values.length ? scope.values : ['__none__'], 30).map((vals) =>
            query(base, where(scope.field === 'id' ? documentId() : scope.field, 'in', vals)));

    const parts = new Map<number, AnyDoc[]>();
    const unsubs = queries.map((q, i) =>
      onSnapshot(
        q,
        (snap) => {
          parts.set(i, snap.docs.map((d) => ({ ...(d.data() as any), id: d.id })));
          if (parts.size === queries.length) cb(([] as AnyDoc[]).concat(...parts.values()));
        },
        (err) => { console.error(`[firestore] ${col}`, err); onError?.(err); cb([]); },
      ));
    return () => unsubs.forEach((u) => u());
  }

  async commit(ops: WriteOp[]) {
    if (ops.length === 1) {
      const o = ops[0];
      if (o.op === 'set') return setDoc(this.docRef(o.col, o.id), stripUndefined({ ...o.data, id: o.id }));
      if (o.op === 'update') return updateDoc(this.docRef(o.col, o.id), stripUndefined(o.data));
      return deleteDoc(this.docRef(o.col, o.id));
    }
    for (const group of chunk(ops, 450)) {
      const b = writeBatch(this.db);
      for (const o of group) {
        const ref = this.docRef(o.col, o.id);
        if (o.op === 'set') b.set(ref, stripUndefined({ ...o.data, id: o.id }));
        else if (o.op === 'update') b.update(ref, stripUndefined(o.data));
        else b.delete(ref);
      }
      await b.commit();
    }
  }
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
