import type { AppNotification, Bill, BillCategory, User } from '../types';

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
  clear(): Promise<void>;
  /** Où vont les données, pour l'afficher à l'utilisateur */
  kind: 'cloud' | 'browser' | 'memory';
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
    },
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
      { doc(path: string): DbDoc } | null,
      { id(): Promise<string | null> } | null,
    ];
    if (!db || !user) return null;
    const uid = await user.id();
    if (!uid) return null;
    const doc = db.doc(`data/users/${uid}/finance`);
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
      },
    };
  } catch {
    return null;
  }
}

let backendPromise: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  backendPromise ??= (async () => {
    const memory: Backend = { kind: 'memory', load: async () => null, save: async () => {}, clear: async () => {} };
    return (await cloudBackend()) ?? browserBackend() ?? memory;
  })();
  return backendPromise;
}
