// Lots de modifications atomiques et annulation sélective.
import type { Batch, ID, Op, StoreName } from './types';

export interface UndoPlan {
  /** Nouvelles valeurs à écrire (restaurations). */
  writes: { store: StoreName; next: any }[];
  /** Objets modifiés depuis le lot : on ne les écrase pas sans accord. */
  conflicts: { store: StoreName; id: ID; label: string; reason: string }[];
}

export function labelOf(e: any): string {
  return e?.title ?? e?.name ?? e?.text ?? e?.id ?? '?';
}

/**
 * Prépare l'annulation d'un lot. Seuls les objets encore dans l'état laissé par le lot sont restaurés :
 * les modifications postérieures sans lien sont préservées, celles qui touchent le même objet sont signalées.
 */
export function planUndo(batch: Batch, current: (store: StoreName, id: ID) => any | undefined, nowIso: string): UndoPlan {
  const writes: UndoPlan['writes'] = [];
  const conflicts: UndoPlan['conflicts'] = [];
  for (const op of [...batch.ops].reverse()) {
    const cur = current(op.store, op.id);
    if (op.after == null) {
      if (cur && !cur.deletedAt) conflicts.push({ store: op.store, id: op.id, label: labelOf(op.before), reason: 'recréé depuis' });
      else if (op.before) writes.push({ store: op.store, next: { ...op.before, version: (cur?.version ?? op.before.version) + 1, updatedAt: nowIso } });
      continue;
    }
    if (!cur) continue;
    if (cur.version !== op.after.version) {
      conflicts.push({ store: op.store, id: op.id, label: labelOf(cur), reason: 'modifié après ce lot' });
      continue;
    }
    if (op.before == null) {
      writes.push({ store: op.store, next: { ...cur, deletedAt: nowIso, version: cur.version + 1, updatedAt: nowIso } });
    } else {
      writes.push({ store: op.store, next: { ...op.before, version: cur.version + 1, updatedAt: nowIso } });
    }
  }
  return { writes, conflicts };
}

/** Construit les opérations d'un lot à partir des valeurs suivantes (versions incrémentées). */
export function buildOps(changes: { store: StoreName; next: any }[], current: (store: StoreName, id: ID) => any | undefined, nowIso: string): Op[] {
  const seen = new Map<string, Op>();
  for (const ch of changes) {
    const key = `${ch.store}:${ch.next.id}`;
    const prev = seen.get(key);
    const before = prev ? prev.before : current(ch.store, ch.next.id) ?? null;
    const baseVersion = prev ? prev.after.version - 1 : before?.version ?? 0;
    const after = { ...ch.next, version: baseVersion + 1, updatedAt: nowIso };
    seen.set(key, { store: ch.store, id: ch.next.id, before, after });
  }
  return [...seen.values()];
}
