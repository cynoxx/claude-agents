// Accès IndexedDB : toutes les écritures d'un lot passent par UNE transaction (tout ou rien).
import type { Batch, StoreName } from '../core/types';
import { DATA_STORES } from '../core/types';
import type { DataSnapshot } from '../core/backup';

export const DB_VERSION = 1;
const EXTRA = ['batches', 'backups', 'meta'] as const;
type AnyStore = StoreName | (typeof EXTRA)[number];

export function dbName(space: 'real' | 'demo'): string {
  return space === 'real' ? 'max-real' : 'max-demo';
}

export function openDb(name: string, idb: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of [...DATA_STORES, ...EXTRA]) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base bloquée par un autre onglet. Ferme les autres onglets de Max.'));
  });
}

function all<T>(db: IDBDatabase, store: AnyStore): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

export async function readSnapshot(db: IDBDatabase): Promise<DataSnapshot> {
  const snap: DataSnapshot = {};
  for (const s of DATA_STORES) snap[s] = await all(db, s);
  return snap;
}
export const readBatches = (db: IDBDatabase) => all<Batch>(db, 'batches');
export const readBackups = (db: IDBDatabase) => all<{ id: string; at: string; label: string; json: string }>(db, 'backups');

export interface Write { store: AnyStore; value?: any; deleteId?: string }

export function writeTx(db: IDBDatabase, writes: Write[], opts: { clear?: AnyStore[] } = {}): Promise<void> {
  const stores = [...new Set([...writes.map((w) => w.store), ...(opts.clear ?? [])])];
  if (!stores.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, 'readwrite');
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Écriture refusée'));
    tx.onabort = () => reject(tx.error ?? new Error('Écriture annulée'));
    try {
      for (const s of opts.clear ?? []) tx.objectStore(s).clear();
      for (const w of writes) {
        if (w.deleteId) tx.objectStore(w.store).delete(w.deleteId);
        else tx.objectStore(w.store).put(w.value);
      }
    } catch (e) {
      tx.abort();
      reject(e);
    }
  });
}
