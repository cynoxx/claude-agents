import type { AppNotification, Bill, BillCategory, Income, User } from '../types';

export interface Budget {
  id: string;
  category: BillCategory;
  limitAmount: number;
  month: number;
  year: number;
}

export interface StoredNotification extends AppNotification {
  dedupKey: string;
}

/** Tout l'état de l'app autonome, enregistré d'un bloc (chiffré). */
export interface State {
  version: 1;
  user: User;
  bills: Bill[];
  budgets: Budget[];
  notifications: StoredNotification[];
  /** Absent des coffres créés avant l'ajout des rentrées */
  incomes?: Income[];
  /** Mails déjà transformés en factures (ids Gmail), pour ne jamais les ajouter deux fois */
  importedMail?: string[];
}

/** Facture repérée dans les mails par le tri du matin, en attente d'être rangée dans le coffre. */
export interface InboxItem {
  id: string;
  data: Record<string, unknown>;
}

/** Coffre enregistré : l'état chiffré par le code d'accès (AES-GCM, clé PBKDF2). */
export interface Sealed {
  v: 2;
  salt: string;
  iv: string;
  data: string;
  /** contenu compressé (gzip) avant chiffrement */
  z?: boolean;
}

export interface Backend {
  load(): Promise<Sealed | null>;
  save(sealed: Sealed): Promise<void>;
  /** Efface le coffre et toutes les pièces jointes */
  clear(): Promise<void>;
  /** Pièces jointes chiffrées, découpées en morceaux (un document est limité à 256 Kio) */
  putChunks(id: string, chunks: string[]): Promise<void>;
  getChunks(id: string, count: number): Promise<string[]>;
  deleteChunks(id: string, count: number): Promise<void>;
  /** Boîte d'arrivée : factures déposées par le tri du matin (non chiffrées, privées) */
  listInbox(): Promise<InboxItem[]>;
  removeInbox(id: string): Promise<void>;
  /** Où vont les données, pour l'afficher à l'utilisateur */
  kind: 'cloud' | 'browser' | 'memory';
}

interface DbCollection {
  limit(n: number): { get(): Promise<{ docs: Array<{ id: string; data(): Record<string, unknown> | undefined }> }> };
}
interface DbDoc {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(body: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

const LS_KEY = 'finance-agent-vault';
const LS_FILE = 'finance-agent-file-';
const isSealed = (x: unknown): x is Sealed => !!x && (x as Sealed).v === 2 && typeof (x as Sealed).data === 'string';

function browserBackend(): Backend | null {
  try {
    localStorage.setItem('__probe', '1');
    localStorage.removeItem('__probe');
  } catch {
    return null;
  }
  return {
    kind: 'browser',
    async load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return isSealed(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async save(sealed) {
      localStorage.setItem(LS_KEY, JSON.stringify(sealed));
    },
    async clear() {
      localStorage.removeItem(LS_KEY);
      for (const k of Object.keys(localStorage)) if (k.startsWith(LS_FILE)) localStorage.removeItem(k);
    },
    async putChunks(id, chunks) {
      // Quota du navigateur (quelques Mo) : l'erreur remonte à l'utilisateur
      chunks.forEach((c, n) => localStorage.setItem(`${LS_FILE}${id}_${n}`, c));
    },
    async getChunks(id, count) {
      return Array.from({ length: count }, (_, n) => {
        const c = localStorage.getItem(`${LS_FILE}${id}_${n}`);
        if (c === null) throw new Error('Pièce jointe introuvable');
        return c;
      });
    },
    async deleteChunks(id, count) {
      for (let n = 0; n < count; n++) localStorage.removeItem(`${LS_FILE}${id}_${n}`);
    },
    listInbox: async () => [],
    removeInbox: async () => {},
  };
}

/**
 * Dans un artefact claude.ai, l'état est rangé dans la base privée de chaque
 * personne (data/users/<id>/finance), visible d'elle seule. Sinon, on se replie
 * sur le stockage du navigateur.
 */
async function cloudBackend(): Promise<Backend | null> {
  const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
  if (!claude?.use) return null;
  try {
    // Le runtime répond null au bout de 10 s s'il ne sert pas la capacité
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 12000));
    const [db, user] = (await Promise.race([Promise.all([claude.use('db'), claude.use('user')]), timeout.then(() => [null, null])])) as [
      { doc(path: string): DbDoc; collection(path: string): DbCollection } | null,
      { id(): Promise<string | null> } | null,
    ];
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    const base = `data/users/${uid}/finance`;
    const doc = db.doc(base);
    const filesPath = `${base}/files`;
    const chunk = (id: string, n: number) => db.doc(`${filesPath}/${id}_${n}`);
    return {
      kind: 'cloud',
      async load() {
        const snap = await doc.get();
        const body = snap.exists ? snap.data() : undefined;
        // Les anciens enregistrements non chiffrés (version d'essai) sont ignorés : on repart de zéro
        return isSealed(body?.vault) ? body.vault : null;
      },
      async save(sealed) {
        await doc.set({ vault: sealed, savedAt: new Date().toISOString() });
      },
      async clear() {
        await doc.delete();
        // Les sous-documents survivent à la suppression du parent : on les efface un par un
        for (;;) {
          const { docs } = await db.collection(filesPath).limit(500).get();
          if (!docs.length) break;
          for (const d of docs) await db.doc(`${filesPath}/${d.id}`).delete();
        }
      },
      async putChunks(id, chunks) {
        for (let n = 0; n < chunks.length; n++) await chunk(id, n).set({ data: chunks[n] });
      },
      async getChunks(id, count) {
        const out: string[] = [];
        for (let n = 0; n < count; n++) {
          const snap = await chunk(id, n).get();
          const data = snap.exists ? snap.data()?.data : undefined;
          if (typeof data !== 'string') throw new Error('Pièce jointe introuvable');
          out.push(data);
        }
        return out;
      },
      async deleteChunks(id, count) {
        for (let n = 0; n < count; n++) await chunk(id, n).delete();
      },
      async listInbox() {
        const { docs } = await db.collection(`${base}/inbox`).limit(200).get();
        return docs.map((d) => ({ id: d.id, data: d.data() ?? {} }));
      },
      async removeInbox(id) {
        await db.doc(`${base}/inbox/${id}`).delete();
      },
    };
  } catch {
    return null;
  }
}

let backendPromise: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  backendPromise ??= (async () => {
    const files = new Map<string, string>();
    const memory: Backend = {
      kind: 'memory',
      load: async () => null,
      save: async () => {},
      clear: async () => files.clear(),
      putChunks: async (id, chunks) => chunks.forEach((c, n) => files.set(`${id}_${n}`, c)),
      getChunks: async (id, count) => Array.from({ length: count }, (_, n) => files.get(`${id}_${n}`) ?? ''),
      deleteChunks: async (id, count) => {
        for (let n = 0; n < count; n++) files.delete(`${id}_${n}`);
      },
      listInbox: async () => [],
      removeInbox: async () => {},
    };
    return (await cloudBackend()) ?? browserBackend() ?? memory;
  })();
  return backendPromise;
}
