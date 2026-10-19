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

/** Tout l'état de l'app autonome, enregistré d'un bloc. */
export interface State {
  version: 1;
  /** true tant que l'utilisateur n'a rien modifié : données d'exemple */
  demo: boolean;
  user: User;
  bills: Bill[];
  budgets: Budget[];
  notifications: StoredNotification[];
}

interface Backend {
  load(): Promise<State | null>;
  save(state: State): Promise<void>;
  /** Où vont les données, pour l'afficher à l'utilisateur */
  kind: 'cloud' | 'browser' | 'memory';
}

interface DbDoc {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
  set(body: Record<string, unknown>): Promise<unknown>;
}
interface ClaudeRuntime {
  use(name: string): Promise<unknown>;
}

const LS_KEY = 'finance-agent-state';

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
        return raw ? (JSON.parse(raw) as State) : null;
      } catch {
        return null;
      }
    },
    async save(state) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(state));
      } catch {
        /* stockage plein ou bloqué : on garde l'état en mémoire */
      }
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
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 4000));
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
        return body?.state ? (JSON.parse(body.state as string) as State) : null;
      },
      async save(state) {
        await doc.set({ state: JSON.stringify(state), savedAt: new Date().toISOString() });
      },
    };
  } catch {
    return null;
  }
}

let backendPromise: Promise<Backend> | null = null;

export function getBackend(): Promise<Backend> {
  backendPromise ??= (async () => {
    const memory: Backend = { kind: 'memory', load: async () => null, save: async () => {} };
    return (await cloudBackend()) ?? browserBackend() ?? memory;
  })();
  return backendPromise;
}
