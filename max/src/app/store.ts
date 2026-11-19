// État de l'application : chargé depuis IndexedDB, modifié uniquement par lots atomiques et annulables.
import { useSyncExternalStore } from 'react';
import { DateTime } from 'luxon';
import type { Area, Batch, Block, Capture, Deadline, ID, LogEntry, Prefs, Project, Recurrence, Replan, StoreName, Task, Video } from '../core/types';
import { DATA_STORES } from '../core/types';
import { buildOps, planUndo, type UndoPlan } from '../core/batch';
import { defaultPrefs, newId } from '../core/factory';
import type { DataSnapshot } from '../core/backup';
import { iso } from '../core/time';
import { dbName, openDb, readBackups, readBatches, readSnapshot, writeTx, type Write } from './db';

export interface State {
  captures: Map<ID, Capture>;
  areas: Map<ID, Area>;
  projects: Map<ID, Project>;
  tasks: Map<ID, Task>;
  deadlines: Map<ID, Deadline>;
  blocks: Map<ID, Block>;
  recurrences: Map<ID, Recurrence>;
  videos: Map<ID, Video>;
  logs: Map<ID, LogEntry>;
  replans: Map<ID, Replan>;
  prefs: Prefs;
  batches: Batch[];
}

export type SaveStatus = { kind: 'loading' } | { kind: 'saved'; at: string } | { kind: 'saving' } | { kind: 'error'; message: string; at: string };

export class MaxStore {
  state!: State;
  space: 'real' | 'demo';
  save: SaveStatus = { kind: 'loading' };
  persisted: boolean | null = null;
  private db!: IDBDatabase;
  private listeners = new Set<() => void>();
  private version = 0;
  private channel: BroadcastChannel | null = null;
  clock: () => DateTime;

  constructor(space: 'real' | 'demo', clock: () => DateTime = () => DateTime.now()) {
    this.space = space;
    this.clock = clock;
  }

  nowIso(): string {
    return iso(this.clock().setZone(this.state?.prefs?.tz ?? 'Europe/Paris'));
  }

  async init(idb?: IDBFactory): Promise<void> {
    this.db = await openDb(dbName(this.space), idb);
    await this.reload();
    try {
      this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('max-' + this.space) : null;
      if (this.channel) this.channel.onmessage = () => void this.reload();
    } catch { /* pas de diffusion inter-onglets */ }
    if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
      try { this.persisted = await navigator.storage.persisted(); } catch { this.persisted = null; }
    }
  }

  async reload(): Promise<void> {
    const snap = await readSnapshot(this.db);
    const batches = (await readBatches(this.db)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
    this.state = fromSnapshot(snap, batches, iso(DateTime.now()));
    this.save = { kind: 'saved', at: this.state.prefs.updatedAt };
    this.emit();
  }

  async requestPersistence(): Promise<boolean | null> {
    if (navigator.storage?.persist) {
      try { this.persisted = await navigator.storage.persist(); } catch { /* ignore */ }
    }
    this.emit();
    return this.persisted;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get(store: StoreName, id: ID): any | undefined {
    if (store === 'prefs') return this.state.prefs;
    return (this.state[store] as Map<ID, any>).get(id);
  }

  /** Écrit un lot de modifications en une transaction. Échec → rien n'est modifié, ni en mémoire ni sur disque. */
  async commit(label: string, kind: Batch['kind'], changes: { store: StoreName; next: any }[]): Promise<Batch | null> {
    if (!changes.length) return null;
    const now = this.nowIso();
    const ops = buildOps(changes, (s, id) => this.get(s, id), now);
    const batch: Batch = { id: newId('b'), at: now, label, ops, kind };
    const writes: Write[] = ops.map((o) => ({ store: o.store, value: o.after }));
    writes.push({ store: 'batches', value: batch });
    this.save = { kind: 'saving' };
    this.emit();
    try {
      await writeTx(this.db, writes);
    } catch (e: any) {
      this.save = { kind: 'error', message: e?.message ?? String(e), at: now };
      this.emit();
      throw e;
    }
    for (const o of ops) this.applyToMemory(o.store, o.after);
    this.state.batches = [batch, ...this.state.batches].slice(0, 200);
    this.save = { kind: 'saved', at: now };
    this.channel?.postMessage('changed');
    this.emit();
    return batch;
  }

  private applyToMemory(store: StoreName, value: any) {
    if (store === 'prefs') this.state.prefs = value;
    else (this.state[store] as Map<ID, any>).set(value.id, value);
  }

  previewUndo(batchId: ID): UndoPlan | null {
    const b = this.state.batches.find((x) => x.id === batchId);
    if (!b || b.undoneAt) return null;
    return planUndo(b, (s, id) => this.get(s, id), this.nowIso());
  }

  /** Annule un lot. Les objets modifiés depuis sont signalés et laissés tels quels (sauf `force`). */
  async undo(batchId: ID, force = false): Promise<UndoPlan | null> {
    const b = this.state.batches.find((x) => x.id === batchId);
    if (!b || b.undoneAt) return null;
    const plan = planUndo(b, (s, id) => this.get(s, id), this.nowIso());
    if (plan.conflicts.length && !force) return plan;
    const now = this.nowIso();
    const marked: Batch = { ...b, undoneAt: now };
    const writes: Write[] = plan.writes.map((w) => ({ store: w.store, value: w.next }));
    const undoBatch: Batch = { id: newId('b'), at: now, label: `Annulation : ${b.label}`, kind: 'undo', ops: plan.writes.map((w) => ({ store: w.store, id: w.next.id, before: this.get(w.store, w.next.id) ?? null, after: w.next })) };
    writes.push({ store: 'batches', value: marked }, { store: 'batches', value: undoBatch });
    await writeTx(this.db, writes);
    for (const w of plan.writes) this.applyToMemory(w.store, w.next);
    this.state.batches = [undoBatch, ...this.state.batches.map((x) => (x.id === b.id ? marked : x))];
    this.save = { kind: 'saved', at: now };
    this.channel?.postMessage('changed');
    this.emit();
    return plan;
  }

  snapshot(): DataSnapshot {
    const s: DataSnapshot = {};
    for (const name of DATA_STORES) s[name] = name === 'prefs' ? [this.state.prefs] : [...(this.state[name] as Map<ID, any>).values()];
    return s;
  }

  /** Restauration complète : sauvegarde automatique de l'état courant, puis remplacement en une transaction. */
  async restore(snap: DataSnapshot, label: string): Promise<void> {
    const now = this.nowIso();
    const backup = { id: newId('bk'), at: now, label: `Avant restauration : ${label}`, json: JSON.stringify(this.snapshot()) };
    const writes: Write[] = [{ store: 'backups', value: backup }];
    for (const s of DATA_STORES) for (const it of snap[s] ?? []) writes.push({ store: s, value: it });
    await writeTx(this.db, writes, { clear: [...DATA_STORES, 'batches'] });
    await this.reload();
    this.channel?.postMessage('changed');
  }

  async autoBackup(label: string): Promise<void> {
    await writeTx(this.db, [{ store: 'backups', value: { id: newId('bk'), at: this.nowIso(), label, json: JSON.stringify(this.snapshot()) } }]);
  }
  listBackups() {
    return readBackups(this.db);
  }
  async wipe(): Promise<void> {
    await writeTx(this.db, [], { clear: [...DATA_STORES, 'batches'] });
    await this.reload();
  }
}

export function fromSnapshot(snap: DataSnapshot, batches: Batch[], nowIso: string): State {
  const m = <T extends { id: ID }>(xs: any[] | undefined) => new Map<ID, T>((xs ?? []).map((x) => [x.id, x]));
  const prefs = { ...defaultPrefs(nowIso), ...((snap.prefs ?? [])[0] ?? {}) } as Prefs;
  return {
    captures: m(snap.captures), areas: m(snap.areas), projects: m(snap.projects), tasks: m(snap.tasks), deadlines: m(snap.deadlines),
    blocks: m(snap.blocks), recurrences: m(snap.recurrences), videos: m(snap.videos), logs: m(snap.logs), replans: m(snap.replans), prefs, batches,
  };
}

let current: MaxStore | null = null;
export function setStore(s: MaxStore) { current = s; }
export function getStore(): MaxStore {
  if (!current) throw new Error('Store non initialisé');
  return current;
}
/** Abonnement React : se re-rend à chaque lot. */
export function useStore(): MaxStore {
  const s = getStore();
  useSyncExternalStore(s.subscribe, s.getVersion);
  return s;
}
export function live<T extends { deletedAt?: string }>(m: Map<ID, T>): T[] {
  return [...m.values()].filter((x) => !x.deletedAt);
}
