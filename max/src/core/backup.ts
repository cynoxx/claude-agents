// Export versionné, validation de schéma, aperçu de fusion et restauration.
import { z } from 'zod';
import type { ID, StoreName } from './types';
import { DATA_STORES } from './types';
import { labelOf } from './batch';

export const SCHEMA_VERSION = 1;

export type DataSnapshot = Partial<Record<StoreName, any[]>>;
export interface BackupFile {
  app: 'max';
  schemaVersion: number;
  exportedAt: string;
  includesPrivate: boolean;
  space: 'real' | 'demo';
  data: DataSnapshot;
}

const metaShape = { id: z.string().min(1), version: z.number().int().nonnegative(), updatedAt: z.string().min(10) };
const withMeta = (extra: z.ZodRawShape = {}) => z.object({ ...metaShape, ...extra }).passthrough();
const schemas: Record<StoreName, z.ZodTypeAny> = {
  captures: withMeta({ text: z.string(), status: z.string() }),
  areas: withMeta({ name: z.string(), status: z.string() }),
  projects: withMeta({ name: z.string(), kind: z.string(), status: z.string() }),
  tasks: withMeta({ title: z.string(), status: z.string() }),
  deadlines: withMeta({ title: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.string() }),
  blocks: withMeta({ title: z.string(), start: z.string(), end: z.string(), kind: z.string() }),
  recurrences: withMeta({ title: z.string(), weekdays: z.array(z.number().int().min(1).max(7)), startTime: z.string(), endTime: z.string() }),
  videos: withMeta({ title: z.string(), workState: z.string() }),
  logs: withMeta({ kind: z.string(), date: z.string() }),
  prefs: z.object({ id: z.literal('prefs'), version: z.number(), tz: z.string() }).passthrough(),
  replans: withMeta({ status: z.string() }),
};

const fileSchema = z.object({
  app: z.literal('max'),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  includesPrivate: z.boolean(),
  space: z.enum(['real', 'demo']).default('real'),
  data: z.record(z.array(z.unknown())),
});

export type ValidationResult = { ok: true; file: BackupFile } | { ok: false; errors: string[] };

/** Vérifie le fichier entier avant toute écriture. Un seul objet invalide → rien n'est écrit. */
export function validateBackup(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Le fichier n’est pas un JSON lisible (fichier endommagé ou incomplet).'] };
  }
  const f = fileSchema.safeParse(raw);
  if (!f.success) return { ok: false, errors: ['Ce fichier n’est pas une sauvegarde Max : ' + f.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join(' ; ')] };
  if (f.data.schemaVersion > SCHEMA_VERSION) return { ok: false, errors: [`Sauvegarde créée par une version plus récente de Max (schéma ${f.data.schemaVersion}). Mets Max à jour avant d’importer.`] };
  const errors: string[] = [];
  const data: DataSnapshot = {};
  for (const [store, items] of Object.entries(f.data.data)) {
    if (!DATA_STORES.includes(store as StoreName)) { errors.push(`Collection inconnue « ${store} »`); continue; }
    const ids = new Set<string>();
    data[store as StoreName] = items.map((it, i) => {
      const r = schemas[store as StoreName].safeParse(it);
      if (!r.success) errors.push(`${store}[${i}] : ${r.error.issues.map((x) => x.path.join('.') + ' ' + x.message).join(', ')}`);
      const id = (it as any)?.id;
      if (id && ids.has(id)) errors.push(`${store} : identifiant en double ${id}`);
      ids.add(id);
      return it;
    });
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, file: { ...f.data, data } as BackupFile };
}

export function makeBackup(snapshot: DataSnapshot, opts: { includePrivate: boolean; space: 'real' | 'demo'; nowIso: string }): BackupFile {
  const data: DataSnapshot = {};
  for (const s of DATA_STORES) {
    let items = [...(snapshot[s] ?? [])];
    if (!opts.includePrivate) {
      if (s === 'logs') continue;
      if (s === 'blocks' || s === 'recurrences') items = items.map((b) => (b.private ? { ...b, title: 'Temps privé', location: undefined } : b));
      if (s === 'prefs') items = items.map((p) => ({ ...p, energy: undefined }));
    }
    data[s] = items;
  }
  return { app: 'max', schemaVersion: SCHEMA_VERSION, exportedAt: opts.nowIso, includesPrivate: opts.includePrivate, space: opts.space, data };
}

export interface Collision { store: StoreName; id: ID; label: string; local: any; incoming: any; newer: 'local' | 'incoming'; reason: string }
export interface MergePreview {
  added: { store: StoreName; id: ID; label: string; item: any }[];
  duplicates: number;
  collisions: Collision[];
  /** Présents ici, absents du fichier : conservés. */
  localOnly: number;
  /** Supprimés ici, encore présents dans le fichier : non ressuscités. */
  keptDeleted: number;
}

function same(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function previewMerge(local: DataSnapshot, file: BackupFile): MergePreview {
  const p: MergePreview = { added: [], duplicates: 0, collisions: [], localOnly: 0, keptDeleted: 0 };
  for (const store of DATA_STORES) {
    const incoming = file.data[store] ?? [];
    const loc = new Map((local[store] ?? []).map((x) => [x.id, x]));
    const seen = new Set<string>();
    for (const it of incoming) {
      seen.add(it.id);
      const l = loc.get(it.id);
      if (!l) { p.added.push({ store, id: it.id, label: labelOf(it), item: it }); continue; }
      if (same(l, it) || (l.version === it.version && l.updatedAt === it.updatedAt)) { p.duplicates++; continue; }
      if (l.deletedAt && !it.deletedAt && it.version <= l.version) { p.keptDeleted++; continue; }
      if (store === 'prefs' && !file.includesPrivate) { p.duplicates++; continue; }
      const newer = it.updatedAt > l.updatedAt ? 'incoming' : 'local';
      const reason = it.deletedAt && !l.deletedAt ? 'supprimé dans le fichier' : !it.deletedAt && l.deletedAt ? 'supprimé ici' : 'modifié des deux côtés';
      p.collisions.push({ store, id: it.id, label: labelOf(l), local: l, incoming: it, newer, reason });
    }
    for (const id of loc.keys()) if (!seen.has(id)) p.localOnly++;
  }
  return p;
}

/**
 * Calcule les écritures d'une fusion. Par défaut, une donnée locale reste maîtresse : une collision n'écrase
 * la version locale que si l'utilisateur choisit explicitement la version du fichier.
 */
export function mergeWrites(preview: MergePreview, takeIncoming: Set<string>): { store: StoreName; next: any }[] {
  const writes: { store: StoreName; next: any }[] = preview.added.map((a) => ({ store: a.store, next: a.item }));
  for (const c of preview.collisions) {
    if (takeIncoming.has(`${c.store}:${c.id}`)) writes.push({ store: c.store, next: { ...c.incoming, version: Math.max(c.local.version, c.incoming.version) } });
  }
  return writes;
}
