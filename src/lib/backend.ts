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
