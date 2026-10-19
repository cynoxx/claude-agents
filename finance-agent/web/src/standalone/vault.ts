// Coffre de l'app autonome : l'état n'est enregistré que chiffré par le code
// d'accès (PBKDF2-SHA256 → AES-GCM 256). Sans le code, les données sont illisibles.
import type { Attachment, User } from '../types';
import { importMailInbox } from './mailInbox';
import { getBackend, type Sealed, type State } from './storage';

const ITERATIONS = 310_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Compression gzip avant chiffrement : un document enregistré est limité en taille
async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const canZip = typeof CompressionStream !== 'undefined';

async function seal(key: CryptoKey, salt: string, state: State): Promise<Sealed> {
  let plain: Uint8Array = enc.encode(JSON.stringify(state));
  if (canZip) plain = await pipe(plain, new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain as BufferSource);
  return { v: 2, salt, iv: toB64(iv), data: toB64(cipher), ...(canZip ? { z: true } : {}) };
}

async function open(key: CryptoKey, sealed: Sealed): Promise<State> {
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) as BufferSource }, key, fromB64(sealed.data) as BufferSource));
  const bytes = sealed.z ? await pipe(plain, new DecompressionStream('gzip')) : plain;
  return JSON.parse(dec.decode(bytes)) as State;
}

function emptyState(): State {
  const user: User = {
    id: 'moi',
    email: '',
    name: null,
    billReminderDays: [7, 3, 0],
    budgetWarningThreshold: 80,
    notifyEmail: false,
    notifyInApp: true,
    createdAt: new Date().toISOString(),
  };
  return { version: 1, user, bills: [], budgets: [], notifications: [], incomes: [] };
}

// ---------- Session ----------

let session: { key: CryptoKey; salt: string; state: State } | null = null;

export type SaveStatus = 'saved' | 'saving' | 'error';
let saveStatus: SaveStatus = 'saved';
const listeners = new Set<(s: SaveStatus) => void>();
const setStatus = (s: SaveStatus) => {
  saveStatus = s;
  listeners.forEach((l) => l(s));
};
export const getSaveStatus = () => saveStatus;
export function onSaveStatus(fn: (s: SaveStatus) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export class LockedError extends Error {}

/** L'état déchiffré ; erreur si le coffre est verrouillé. */
export function currentState(): State {
  if (!session) throw new LockedError('Verrouillé');
  return session.state;
}

export async function vaultStatus() {
  const backend = await getBackend();
  const sealed = await backend.load().catch(() => null);
  return { exists: !!sealed, unlocked: !!session, kind: backend.kind };
}

/** Premier lancement : crée un coffre vide protégé par ce code et l'enregistre aussitôt. */
export async function createVault(code: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(code, salt);
  session = { key, salt: toB64(salt), state: emptyState() };
  await saveNow();
  await pullMailInbox();
}

/** Ouvre le coffre ; renvoie false si le code est faux. */
export async function unlockVault(code: string): Promise<boolean> {
  const sealed = await (await getBackend()).load();
  if (!sealed) throw new Error('Aucune donnée enregistrée');
  const key = await deriveKey(code, fromB64(sealed.salt));
  try {
    session = { key, salt: sealed.salt, state: await open(key, sealed) };
  } catch {
    return false;
  }
  await pullMailInbox();
  return true;
}

/** Range les factures déposées par le tri du matin, puis les retire de la boîte une fois le coffre enregistré. */
async function pullMailInbox() {
  const s = session;
  if (!s) return;
  const backend = await getBackend();
  const { added, done } = await importMailInbox(s.state, backend);
  if (!done.length) return;
  if (added) {
    dirty = true;
    await saveNow();
    if (dirty) return; // enregistrement raté : on garde les dépôts pour la prochaine ouverture
  }
  await Promise.all(done.map((id) => backend.removeInbox(id))).catch((e) => console.error('[factures des mails]', e));
}

export async function lockVault() {
  await flush();
  session = null;
}

/** Code oublié : tout est effacé, on repart de zéro. */
export async function eraseVault() {
  clearTimeout(timer);
  session = null;
  await (await getBackend()).clear();
}

// ---------- Enregistrement ----------

let timer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;
let chain: Promise<void> = Promise.resolve();

/** Une écriture à la fois, toujours avec l'état le plus récent. */
function saveNow(): Promise<void> {
  clearTimeout(timer);
  dirty = false;
  const s = session;
  if (!s) return chain;
  setStatus('saving');
  chain = chain
    .then(async () => {
      const sealed = await seal(s.key, s.salt, s.state);
      await (await getBackend()).save(sealed);
      if (!dirty) setStatus('saved');
    })
    .catch((e) => {
      console.error('[enregistrement]', e);
      dirty = true;
      setStatus('error');
    });
  return chain;
}

/** Après chaque modification : enregistrement groupé quelques instants plus tard. */
export function scheduleSave() {
  dirty = true;
  setStatus('saving');
  clearTimeout(timer);
  timer = setTimeout(saveNow, 300);
}

export function flush(): Promise<void> {
  return dirty ? saveNow() : chain;
}

if (typeof window !== 'undefined') {
  // Fermeture ou mise en arrière-plan : on n'attend pas la fin du délai
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush());
}

// ---------- Pièces jointes ----------

export const MAX_ATTACHMENT = 8 * 1024 * 1024;
const CHUNK = 180_000;

/** Chiffre le fichier avec la clé du coffre et l'enregistre par morceaux. */
export async function saveAttachment(file: File): Promise<Attachment> {
  if (!session) throw new LockedError('Verrouillé');
  if (file.size > MAX_ATTACHMENT) throw new Error(`Fichier trop lourd (${Math.round(MAX_ATTACHMENT / 1024 / 1024)} Mo au plus)`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.key, await file.arrayBuffer());
  const data = toB64(iv) + '.' + toB64(cipher);
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += CHUNK) chunks.push(data.slice(i, i + CHUNK));
  const id = crypto.randomUUID();
  await (await getBackend()).putChunks(id, chunks);
  return { id, name: file.name, type: file.type || 'application/octet-stream', size: file.size, chunks: chunks.length };
}

export async function readAttachment(a: Attachment): Promise<Blob> {
  if (!session) throw new LockedError('Verrouillé');
  const [iv, cipher] = (await (await getBackend()).getChunks(a.id, a.chunks)).join('').split('.') as [string, string];
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) as BufferSource }, session.key, fromB64(cipher) as BufferSource);
  return new Blob([plain], { type: a.type });
}

export async function deleteAttachment(a: Attachment) {
  await (await getBackend()).deleteChunks(a.id, a.chunks).catch((e) => console.error('[pièce jointe]', e));
}
