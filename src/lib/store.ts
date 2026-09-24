import { useMemo, useSyncExternalStore } from 'react';
import { CollectionMap, CollectionName, UserProfile } from '../types';
import { AnyDoc, Backend, WriteOp } from './backend';

interface Entry {
  docs: AnyDoc[];
  loaded: boolean;
  listeners: Set<() => void>;
  unsub?: () => void;
  snapshot: { data: AnyDoc[]; loading: boolean };
}

/**
 * Tiny reactive cache over a Backend. Collections are subscribed lazily the first
 * time a component reads them, and stay live for the session.
 */
class Store {
  private backend: Backend | null = null;
  private profile: UserProfile | null = null;
  private entries = new Map<CollectionName, Entry>();
  onError?: (msg: string) => void;

  configure(backend: Backend, profile: UserProfile | null) {
    this.entries.forEach((e) => e.unsub?.());
    const old = this.entries;
    this.entries = new Map();
    this.backend = backend;
    this.profile = profile;
    // wake any mounted components so they resubscribe on the new backend
    old.forEach((e) => e.listeners.forEach((l) => l()));
  }

  get kind() { return this.backend?.kind ?? 'local'; }
  get user() { return this.profile; }

  private entry(col: CollectionName): Entry {
    let e = this.entries.get(col);
    if (!e) {
      e = { docs: [], loaded: false, listeners: new Set(), snapshot: { data: [], loading: true } };
      this.entries.set(col, e);
      if (this.backend) {
        const ent = e;
        ent.unsub = this.backend.subscribe(col, this.profile, (docs) => {
          ent.docs = docs;
          ent.loaded = true;
          ent.snapshot = { data: docs, loading: false };
          ent.listeners.forEach((l) => l());
        }, (err) => this.onError?.(`Could not load ${col}: ${err.message}`));
      }
    }
    return e;
  }

  subscribeTo(col: CollectionName, l: () => void) {
    const e = this.entry(col);
    e.listeners.add(l);
    return () => e.listeners.delete(l);
  }
  snapshot(col: CollectionName) { return this.entry(col).snapshot; }
  peek<K extends CollectionName>(col: K): CollectionMap[K][] { return this.entry(col).docs as any; }

  // ------------------------------------------------------------ writes ----
  async commit(ops: WriteOp[]) {
    if (!this.backend) throw new Error('Not connected');
    const now = Date.now();
    const stamped = ops.map((o) =>
      o.op === 'set' ? { ...o, data: { createdAt: now, ...o.data, updatedAt: now } }
      : o.op === 'update' ? { ...o, data: { ...o.data, updatedAt: now } } : o) as WriteOp[];
    await this.backend.commit(stamped);
  }
  async set<K extends CollectionName>(col: K, data: CollectionMap[K]) {
    await this.commit([{ op: 'set', col, id: data.id, data: data as any }]);
    return data.id;
  }
  async add<K extends CollectionName>(col: K, data: Omit<CollectionMap[K], 'id'> & { id?: string }) {
    const id = data.id || newId();
    await this.commit([{ op: 'set', col, id, data: { ...(data as any), id } }]);
    return id;
  }
  async update<K extends CollectionName>(col: K, id: string, patch: Partial<CollectionMap[K]>) {
    await this.commit([{ op: 'update', col, id, data: patch as any }]);
  }
  async remove(col: CollectionName, id: string) {
    await this.commit([{ op: 'delete', col, id }]);
  }
}

export const store = new Store();

export function newId(): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${t}${r}`;
}

/** Live collection data. */
export function useCollection<K extends CollectionName>(col: K): { data: CollectionMap[K][]; loading: boolean } {
  const snap = useSyncExternalStore(
    (l) => store.subscribeTo(col, l),
    () => store.snapshot(col),
  );
  return snap as any;
}

/** Live collection as an id → doc map. */
export function useIndex<K extends CollectionName>(col: K): Map<string, CollectionMap[K]> {
  const { data } = useCollection(col);
  return useMemo(() => new Map(data.map((d) => [d.id, d])), [data]);
}
