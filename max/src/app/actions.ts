// Actions de domaine : chaque geste de l'utilisateur = un lot atomique, annulable.
import { DateTime } from 'luxon';
import type { Ambiguity, Block, Capture, Deadline, ID, Intent, Prefs, Project, Recurrence, ReplanFacts, StoreName, Task } from '../core/types';
import { makeBlock, makeCapture, makeDeadline, makeLog, makeProject, makeTask, newId } from '../core/factory';
import { expandRecurrence, parseOccurrenceId } from '../core/recurrence';
import { plan, freeSlots, remainingMinutes, suggestForMinutes, type EngineInput, type PlanResult, type Change } from '../core/engine/planner';
import { parseCapture, GRAMMAR_VERSION } from '../core/nlu/parse';
import { addDays, atLocal, iso, localDate, minutesBetween } from '../core/time';
import { hash } from '../core/ics';
import { live, type MaxStore } from './store';

type W = { store: StoreName; next: any };

export function now(s: MaxStore): DateTime {
  return s.clock().setZone(s.state.prefs.tz);
}
export function today(s: MaxStore): string {
  return localDate(now(s));
}

// ---------- Lecture ----------
export function allBlocks(s: MaxStore, from: string, to: string): Block[] {
  const stored = live(s.state.blocks).filter((b) => b.end.slice(0, 10) >= addDays(from, -1) && b.start.slice(0, 10) <= addDays(to, 1));
  const occ = live(s.state.recurrences).flatMap((r) => expandRecurrence(r, from, to));
  return [...stored, ...occ];
}

export function engineInput(s: MaxStore, facts?: ReplanFacts): EngineInput {
  const n = now(s);
  const d = localDate(n);
  return {
    now: n,
    prefs: s.state.prefs,
    blocks: allBlocks(s, addDays(d, -1), addDays(d, 8)),
    tasks: live(s.state.tasks),
    deadlines: live(s.state.deadlines),
    areas: live(s.state.areas).filter((a) => a.status === 'active'),
    facts,
  };
}

export function fingerprint(s: MaxStore): string {
  const parts: string[] = [];
  for (const m of [s.state.tasks, s.state.blocks, s.state.deadlines, s.state.recurrences] as Map<ID, any>[]) for (const x of m.values()) parts.push(x.id + ':' + x.version);
  parts.sort();
  parts.push('p' + s.state.prefs.version);
  return hash(parts.join('|'));
}

export function computePlan(s: MaxStore, facts?: ReplanFacts): PlanResult & { fingerprint: string } {
  return { ...plan(engineInput(s, facts)), fingerprint: fingerprint(s) };
}
export function suggest30(s: MaxStore, minutes: number) {
  return suggestForMinutes(engineInput(s), minutes);
}
export function slotsFor(s: MaxStore, date: string, minutes: number, ignoreBlockId?: string) {
  return freeSlots(engineInput(s), date, minutes, 3, ignoreBlockId);
}

// ---------- Tâches ----------
export async function createTask(s: MaxStore, p: Partial<Task> & { title: string }, label = 'Tâche ajoutée'): Promise<Task> {
  const t = makeTask(s.nowIso(), { status: 'open', ...p });
  await s.commit(`${label} : ${t.title}`, 'action', [{ store: 'tasks', next: t }]);
  return t;
}

export async function updateTask(s: MaxStore, id: ID, patch: Partial<Task>, label = 'Tâche modifiée') {
  const t = s.state.tasks.get(id);
  if (!t) return;
  const next = { ...t, ...patch };
  if (patch.estimateMin != null && patch.estimateSource == null) next.estimateSource = 'user';
  await s.commit(`${label} : ${t.title}`, 'action', [{ store: 'tasks', next }]);
}

function futurePlannedBlocks(s: MaxStore, taskId: ID, from?: DateTime): Block[] {
  const n = from ?? now(s);
  return live(s.state.blocks).filter((b) => b.kind === 'planned' && b.taskId === taskId && b.status === 'accepted' && DateTime.fromISO(b.end) > n);
}

export async function setTaskStatus(s: MaxStore, id: ID, status: Task['status'], extra: Partial<Task> = {}) {
  const t = s.state.tasks.get(id);
  if (!t) return;
  const nowIso = s.nowIso();
  const writes: W[] = [];
  const next: Task = { ...t, ...extra, status };
  if (status === 'done') next.completedAt = nowIso;
  if (status !== 'done') next.completedAt = undefined;
  // Une tâche terminée libère ses créneaux futurs ; le créneau en cours est raccourci à maintenant.
  if (status === 'done' || status === 'cancelled' || status === 'archived') {
    for (const b of futurePlannedBlocks(s, id)) {
      if (DateTime.fromISO(b.start) < now(s)) writes.push({ store: 'blocks', next: { ...b, end: nowIso, status: 'done' } });
      else writes.push({ store: 'blocks', next: { ...b, deletedAt: nowIso } });
    }
  }
  const label = { done: 'Terminé', open: 'Rouvert', in_progress: 'Commencé', cancelled: 'Abandonné', archived: 'Archivé', inbox: 'Remis en boîte de réception' }[status];
  writes.unshift({ store: 'tasks', next });
  return s.commit(`${label} : ${t.title}`, 'action', writes);
}

/** Commencer : note l'heure (aucun chronomètre obligatoire) et réserve le créneau si aucun n'est prévu. */
export async function startTask(s: MaxStore, id: ID) {
  const t = s.state.tasks.get(id);
  if (!t) return;
  const n = now(s);
  const writes: W[] = [{ store: 'tasks', next: { ...t, status: 'in_progress', sessions: [...t.sessions, { start: iso(n) }] } }];
  const cur = futurePlannedBlocks(s, id).find((b) => DateTime.fromISO(b.start) <= n.plus({ minutes: 15 }));
  if (cur) writes.push({ store: 'blocks', next: { ...cur, start: iso(n) < cur.start ? iso(n) : cur.start } });
  else {
    const mins = Math.min(remainingMinutes(t) || 25, s.state.prefs.maxChunkMin);
    writes.push({ store: 'blocks', next: makeBlock(iso(n), { title: t.title, start: iso(n), end: iso(n.plus({ minutes: mins })), kind: 'planned', protection: 'flexible', category: 'travail', taskId: id, origin: 'user', source: 'commencé dans Max', plannedMin: mins }) });
  }
  return s.commit(`Commencé : ${t.title}`, 'action', writes);
}

/** Terminer ou interrompre la séance en cours : le temps réel sert à corriger le reste. */
export async function stopTask(s: MaxStore, id: ID, opts: { done: boolean; remainingMin?: number; note?: string }) {
  const t = s.state.tasks.get(id);
  if (!t) return;
  const n = now(s);
  const sessions = [...t.sessions];
  const last = sessions[sessions.length - 1];
  let minutes = 0;
  if (last && !last.end) {
    minutes = Math.max(0, minutesBetween(DateTime.fromISO(last.start), n));
    sessions[sessions.length - 1] = { ...last, end: iso(n), minutes, note: opts.note };
  }
  const writes: W[] = [];
  const next: Task = { ...t, sessions, spentMin: (t.spentMin ?? 0) + minutes, status: opts.done ? 'done' : 'open', nextStep: opts.note ? opts.note : t.nextStep };
  if (opts.done) next.completedAt = iso(n);
  if (opts.remainingMin != null) next.remainingMin = opts.remainingMin;
  else if (t.remainingMin != null && !opts.done) next.remainingMin = Math.max(0, t.remainingMin - minutes);
  writes.push({ store: 'tasks', next });
  for (const b of futurePlannedBlocks(s, id)) {
    if (DateTime.fromISO(b.start) <= n) writes.push({ store: 'blocks', next: { ...b, end: iso(n), status: 'done', plannedMin: minutes } });
    else if (opts.done) writes.push({ store: 'blocks', next: { ...b, deletedAt: iso(n) } });
  }
  return s.commit(`${opts.done ? 'Terminé' : 'Interrompu'} : ${t.title}${minutes ? ` (${minutes} min)` : ''}`, 'action', writes);
}

/** Fait sans l'app : une pression, durée réelle facultative. */
export async function markDone(s: MaxStore, id: ID, actualMin?: number) {
  const t = s.state.tasks.get(id);
  if (!t) return;
  return setTaskStatus(s, id, 'done', { spentMin: (t.spentMin ?? 0) + (actualMin ?? 0), sessions: actualMin ? [...t.sessions, { start: s.nowIso(), minutes: actualMin, note: 'déclaré' }] : t.sessions });
}

/** Sortir d'aujourd'hui : retour dans la liste avec date et projet intacts. */
export async function deferTask(s: MaxStore, id: ID) {
  const t = s.state.tasks.get(id);
  if (!t) return;
  const nowIso = s.nowIso();
  const end = now(s).endOf('day');
  const writes: W[] = futurePlannedBlocks(s, id).filter((b) => DateTime.fromISO(b.start) <= end).map((b) => ({ store: 'blocks' as const, next: { ...b, deletedAt: nowIso } }));
  writes.push({ store: 'tasks', next: { ...t, status: t.status === 'in_progress' ? 'open' : t.status, deferCount: (t.deferCount ?? 0) + 1 } });
  return s.commit(`Remis dans la liste : ${t.title}`, 'action', writes);
}

/** Planifier une tâche à une date (premier créneau libre) ou à une heure précise. */
export async function scheduleTask(s: MaxStore, id: ID, date: string, time?: string, minutes?: number) {
  const t = s.state.tasks.get(id);
  if (!t) return;
  const mins = minutes ?? Math.min(remainingMinutes(t) || 30, s.state.prefs.maxChunkMin);
  const nowIso = s.nowIso();
  const writes: W[] = futurePlannedBlocks(s, id).map((b) => ({ store: 'blocks' as const, next: { ...b, deletedAt: nowIso } }));
  let start: DateTime | undefined;
  if (time) start = atLocal(date, time, s.state.prefs.tz);
  else start = slotsFor(s, date, mins)[0]?.start;
  if (!start) return { ok: false as const, reason: `Aucun créneau libre de ${mins} min le ${date}.` };
  writes.push({ store: 'blocks', next: makeBlock(nowIso, { title: t.title, start: iso(start), end: iso(start.plus({ minutes: mins })), kind: 'planned', protection: time ? 'locked' : 'flexible', category: 'travail', taskId: id, plannedMin: mins, source: 'planifié à la main' }) });
  await s.commit(`Planifié : ${t.title}`, 'action', writes);
  return { ok: true as const, start };
}

// ---------- Projets ----------
export async function upsertProject(s: MaxStore, p: Partial<Project> & { name: string }, label = 'Projet enregistré') {
  const existing = p.id ? s.state.projects.get(p.id) : undefined;
  const next = existing ? { ...existing, ...p } : makeProject(s.nowIso(), p);
  await s.commit(`${label} : ${next.name}`, 'action', [{ store: 'projects', next }]);
  return next as Project;
}

// ---------- Échéances ----------
export async function createDeadline(s: MaxStore, p: Partial<Deadline> & { title: string; date: string }, opts: { prepTasks?: string[]; subjectName?: string; captureId?: ID } = {}) {
  const nowIso = s.nowIso();
  const writes: W[] = [];
  let subjectId = p.subjectId;
  if (!subjectId && opts.subjectName) {
    const existing = live(s.state.projects).find((x) => x.kind === 'subject' && x.name.toLowerCase() === opts.subjectName!.toLowerCase());
    if (existing) subjectId = existing.id;
    else {
      const subj = makeProject(nowIso, { name: opts.subjectName, kind: 'subject', areaId: live(s.state.areas).find((a) => /etudes|études/i.test(a.name))?.id });
      writes.push({ store: 'projects', next: subj });
      subjectId = subj.id;
    }
  }
  const d = makeDeadline(nowIso, { status: p.time ? 'announced' : 'announced', ...p, subjectId, tz: s.state.prefs.tz });
  writes.push({ store: 'deadlines', next: d });
  const ids: ID[] = [d.id];
  for (const title of opts.prepTasks ?? []) {
    const t = makeTask(nowIso, { title, deadlineId: d.id, projectId: subjectId, kind: 'prep', estimateMin: 45, estimateSource: 'default', captureId: opts.captureId });
    writes.push({ store: 'tasks', next: t });
    ids.push(t.id);
  }
  if (!d.time && d.date >= today(s) && d.date <= addDays(today(s), 3)) {
    const v = makeTask(nowIso, { title: `Vérifier l'heure : ${d.title}`, deadlineId: d.id, projectId: subjectId, kind: 'admin', estimateMin: 5, estimateSource: 'default', unblocks: true, captureId: opts.captureId });
    writes.push({ store: 'tasks', next: v });
    ids.push(v.id);
  }
  await s.commit(`Échéance ajoutée : ${d.title}`, 'action', writes);
  return { deadline: d, ids };
}

export async function updateDeadline(s: MaxStore, id: ID, patch: Partial<Deadline>, label = 'Échéance modifiée') {
  const d = s.state.deadlines.get(id);
  if (!d) return;
  const writes: W[] = [{ store: 'deadlines', next: { ...d, ...patch } }];
  // Heure connue → la tâche « vérifier l'heure » est faite.
  if (patch.time && !d.time) {
    for (const t of live(s.state.tasks)) if (t.deadlineId === id && t.unblocks && t.status !== 'done') writes.push({ store: 'tasks', next: { ...t, status: 'done', completedAt: s.nowIso() } });
  }
  return s.commit(`${label} : ${d.title}`, 'action', writes);
}

// ---------- Agenda ----------
export async function createEvent(s: MaxStore, p: { title: string; date: string; time: string; durationMin: number; category: Block['category']; kind?: Block['kind']; protection?: Block['protection']; private?: boolean; travel?: { label: string; minutes?: number }; location?: string }, captureId?: ID) {
  const nowIso = s.nowIso();
  const tz = s.state.prefs.tz;
  const start = atLocal(p.date, p.time, tz);
  const b = makeBlock(nowIso, { title: p.title, start: iso(start), end: iso(start.plus({ minutes: p.durationMin })), kind: p.kind ?? 'fixed', category: p.category, protection: p.protection ?? 'locked', private: p.private, location: p.location, source: captureId ? 'capture' : 'saisi dans Max' });
  const writes: W[] = [{ store: 'blocks', next: b }];
  if (p.travel) {
    const mins = p.travel.minutes ?? 120;
    writes.push({ store: 'blocks', next: makeBlock(nowIso, { title: p.travel.label + (p.travel.minutes ? '' : ' (durée à confirmer)'), start: iso(start.minus({ minutes: mins })), end: iso(start), kind: 'fixed', category: 'trajet', protection: 'locked', needsBuffer: true, source: 'capture' }) });
  }
  await s.commit(`Ajouté à l'agenda : ${b.title}`, 'action', writes);
  return writes.map((w) => w.next.id as ID);
}

/** Modifier un bloc ; pour une occurrence de récurrence, on crée une exception (le reste de la série ne bouge pas). */
export async function updateBlock(s: MaxStore, id: ID, patch: Partial<Block>, label = 'Agenda modifié') {
  const occ = parseOccurrenceId(id);
  if (occ) {
    const rec = s.state.recurrences.get(occ.recId);
    if (!rec) return;
    const tz = rec.tz;
    const exceptions = rec.exceptions.filter((e) => e.date !== occ.date);
    if (patch.status === 'cancelled' || patch.deletedAt) exceptions.push({ date: occ.date, action: 'skip' });
    else {
      const cur = expandRecurrence(rec, occ.date, occ.date)[0];
      const st = DateTime.fromISO(patch.start ?? cur?.start ?? '').setZone(tz);
      const en = DateTime.fromISO(patch.actualEnd ?? patch.end ?? cur?.end ?? '').setZone(tz);
      exceptions.push({ date: occ.date, action: 'move', dateTo: st.toISODate()!, start: st.toFormat('HH:mm'), end: en.toFormat('HH:mm') });
    }
    return s.commit(`${label} : ${rec.title} (${occ.date})`, 'action', [{ store: 'recurrences', next: { ...rec, exceptions } }]);
  }
  const b = s.state.blocks.get(id);
  if (!b) return;
  return s.commit(`${label} : ${b.title}`, 'action', [{ store: 'blocks', next: { ...b, ...patch } }]);
}

export async function createRecurrence(s: MaxStore, r: Recurrence) {
  return s.commit(`Récurrence ajoutée : ${r.title}`, 'action', [{ store: 'recurrences', next: r }]);
}

// ---------- Recalage ----------
export class StalePreviewError extends Error {
  constructor() { super('Les données ont changé depuis l’aperçu : aperçu recalculé.'); }
}

export function changeWrites(s: MaxStore, ch: Change, nowIso: string): W[] {
  const tz = s.state.prefs.tz;
  const stored = ch.blockId ? s.state.blocks.get(ch.blockId) : undefined;
  switch (ch.kind) {
    case 'block_extend': {
      if (!ch.blockId) return [];
      if (parseOccurrenceId(ch.blockId)) {
        const occ = parseOccurrenceId(ch.blockId)!;
        const rec = s.state.recurrences.get(occ.recId);
        if (!rec) return [];
        const exceptions = rec.exceptions.filter((e) => e.date !== occ.date);
        exceptions.push({ date: occ.date, action: 'move', dateTo: ch.from!.start.toISODate()!, start: ch.from!.start.setZone(tz).toFormat('HH:mm'), end: ch.to!.end.setZone(tz).toFormat('HH:mm') });
        return [{ store: 'recurrences', next: { ...rec, exceptions } }];
      }
      return stored ? [{ store: 'blocks', next: { ...stored, actualEnd: iso(ch.to!.end) } }] : [];
    }
    case 'block_cancel': {
      if (!ch.blockId) return [];
      const occ = parseOccurrenceId(ch.blockId);
      if (occ) {
        const rec = s.state.recurrences.get(occ.recId);
        return rec ? [{ store: 'recurrences', next: { ...rec, exceptions: [...rec.exceptions.filter((e) => e.date !== occ.date), { date: occ.date, action: 'skip' }] } }] : [];
      }
      return stored ? [{ store: 'blocks', next: { ...stored, status: 'cancelled' } }] : [];
    }
    case 'missed':
      return stored ? [{ store: 'blocks', next: { ...stored, status: 'missed' } }] : [];
    case 'move':
      return stored ? [{ store: 'blocks', next: { ...stored, start: iso(ch.to!.start), end: iso(ch.to!.end), plannedMin: ch.minutes, stepTitle: ch.stepTitle, protection: ch.pinned ? 'locked' : stored.protection, status: 'accepted' } }] : [];
    case 'create':
    case 'later': {
      const t = ch.taskId ? s.state.tasks.get(ch.taskId) : undefined;
      return [{ store: 'blocks', next: makeBlock(nowIso, { id: newId('pl'), title: t?.title ?? ch.title, start: iso(ch.to!.start), end: iso(ch.to!.end), kind: 'planned', category: 'travail', protection: ch.pinned ? 'locked' : 'flexible', status: 'accepted', taskId: ch.taskId, plannedMin: ch.minutes, stepTitle: ch.stepTitle, origin: 'engine', source: 'proposé par Max, validé' }) }];
    }
    case 'to_list': {
      const w: W[] = stored ? [{ store: 'blocks', next: { ...stored, deletedAt: nowIso } }] : [];
      const t = ch.taskId ? s.state.tasks.get(ch.taskId) : undefined;
      if (t) w.push({ store: 'tasks', next: { ...t, deferCount: (t.deferCount ?? 0) + 1 } });
      return w;
    }
    default:
      return [];
  }
}

/** Applique un aperçu de recalage (tout ou une sélection) en un seul lot annulable. */
export async function applyPlan(s: MaxStore, preview: PlanResult & { fingerprint: string }, selected: Set<string>, facts: ReplanFacts, captureId?: ID) {
  if (fingerprint(s) !== preview.fingerprint) throw new StalePreviewError();
  const nowIso = s.nowIso();
  const d = today(s);
  const writes: W[] = [];
  for (const ch of preview.changes) if (ch.kind !== 'keep' && selected.has(ch.key)) writes.push(...changeWrites(s, ch, nowIso));
  const prefs: Prefs = { ...s.state.prefs };
  let prefsChanged = false;
  if (facts.energy) { prefs.energy = { date: d, level: facts.energy }; prefsChanged = true; }
  if (facts.availableUntil) { prefs.availableUntil = { date: d, time: facts.availableUntil }; prefsChanged = true; }
  if (facts.minutesLeft != null) { prefs.availableUntil = { date: d, time: now(s).plus({ minutes: facts.minutesLeft }).toFormat('HH:mm') }; prefsChanged = true; }
  if (prefsChanged) writes.push({ store: 'prefs', next: prefs });
  if (captureId) {
    const c = s.state.captures.get(captureId);
    if (c) writes.push({ store: 'captures', next: { ...c, status: 'done' } });
  }
  return s.commit(`Recalage ${now(s).toFormat("HH'h'mm")}`, 'replan', writes);
}

export async function resetDay(s: MaxStore) {
  const p = { ...s.state.prefs, energy: undefined, availableUntil: undefined };
  return s.commit('Plan normal rétabli', 'action', [{ store: 'prefs', next: p }]);
}

export async function updatePrefs(s: MaxStore, patch: Partial<Prefs>, label = 'Préférences modifiées') {
  return s.commit(label, 'action', [{ store: 'prefs', next: { ...s.state.prefs, ...patch } }]);
}

// ---------- Journal ----------
export async function logSleep(s: MaxStore, f: { date?: string; wake?: string; bed?: string; quality?: 'bien' | 'moyen' | 'mal'; sleepMin?: number; note?: string }, captureId?: ID) {
  const tz = s.state.prefs.tz;
  const date = f.date ?? today(s);
  const wakeAt = f.wake ? iso(atLocal(date, f.wake, tz)) : undefined;
  let bedAt: string | undefined;
  if (f.bed) {
    const b = atLocal(date, f.bed, tz);
    bedAt = iso(b.hour >= 12 ? b.minus({ days: 1 }) : b); // une nuit peut commencer la veille
  }
  const e = makeLog(s.nowIso(), { kind: 'sleep', date, wakeAt, bedAt, quality: f.quality, sleepMin: f.sleepMin, note: f.note, source: captureId ? 'capture' : 'saisi' });
  await s.commit('Journal : sommeil', 'action', [{ store: 'logs', next: e }]);
  return e.id;
}
export async function logCaffeine(s: MaxStore, f: { date?: string; time: string; product: string; quantity?: string; caffeineMg?: number }) {
  const e = makeLog(s.nowIso(), { kind: 'caffeine', date: f.date ?? today(s), at: iso(atLocal(f.date ?? today(s), f.time, s.state.prefs.tz)), product: f.product, quantity: f.quantity ?? 'inconnue', caffeineMg: f.caffeineMg });
  await s.commit(`Journal : ${f.product}`, 'action', [{ store: 'logs', next: e }]);
  return e.id;
}

// ---------- Capture ----------
const inflight = new Map<string, Promise<Capture>>();
export function submitCapture(s: MaxStore, text: string): Promise<Capture> {
  const t = text.trim();
  const pending = inflight.get(t);
  if (pending) return pending;
  const p = doSubmit(s, t).finally(() => inflight.delete(t));
  inflight.set(t, p);
  return p;
}
async function doSubmit(s: MaxStore, t: string): Promise<Capture> {
  const nowIso = s.nowIso();
  // Double validation : même texte il y a moins de 5 s → on renvoie la capture existante.
  const recent = live(s.state.captures).find((c) => c.text === t && Math.abs(DateTime.fromISO(nowIso).diff(DateTime.fromISO(c.createdAt), 'seconds').seconds) < 5);
  if (recent) return recent;
  const cap = makeCapture(nowIso, t);
  await s.commit('Capture enregistrée', 'capture', [{ store: 'captures', next: cap }]); // sauvegardée AVANT toute interprétation
  return interpretCapture(s, cap.id);
}

export async function interpretCapture(s: MaxStore, id: ID): Promise<Capture> {
  const c = s.state.captures.get(id)!;
  let parsed;
  try {
    parsed = parseCapture(c.text, { now: now(s), tasks: live(s.state.tasks), deadlines: live(s.state.deadlines), blocks: allBlocks(s, addDays(today(s), -8), addDays(today(s), 8)), projects: live(s.state.projects) });
  } catch (e: any) {
    await s.commit('Interprétation échouée', 'capture', [{ store: 'captures', next: { ...c, status: 'failed', error: String(e?.message ?? e) } }]);
    return s.state.captures.get(id)!;
  }
  await s.commit('Capture interprétée', 'capture', [{ store: 'captures', next: { ...c, parse: parsed, status: parsed.intents.some((i) => i.ambiguities.length || !i.autoApply) ? 'needs_input' : 'parsed', error: undefined } }]);
  for (let i = 0; i < parsed.intents.length; i++) {
    const it = parsed.intents[i];
    if (it.autoApply && !it.ambiguities.length) await applyIntent(s, id, i);
  }
  return s.state.captures.get(id)!;
}

function setPath(obj: Record<string, any>, path: string, value: any) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = { ...(o[parts[i]] ?? {}) };
  o[parts[parts.length - 1]] = value;
}

export function resolveFields(intent: Intent, answers: Record<string, any>): Record<string, any> {
  const f = structuredClone(intent.fields);
  for (const [k, v] of Object.entries(answers)) {
    if (k === 'travel.minutes') f.travel = { ...(f.travel ?? {}), minutes: v };
    else if (k === 'taskId' && f.prefer) f.prefer = [{ ...f.prefer[0], taskId: v }];
    else if (k === 'insteadOfTaskId' && f.prefer) f.prefer = [{ ...f.prefer[0], insteadOfTaskId: v }];
    else if (k === 'blockId' && f.overrun) f.overrun = { ...f.overrun, blockId: v };
    else if (k === 'blockId' && f.cancelledBlockIds) f.cancelledBlockIds = [v];
    else setPath(f, k, v);
  }
  return f;
}

export function unresolved(intent: Intent, answers: Record<string, any>): Ambiguity[] {
  return intent.ambiguities.filter((a) => answers[a.field] === undefined);
}

/** Applique une intention (idempotent : jamais deux fois la même). Renvoie les ids créés ou une demande d'ouverture. */
export async function applyIntent(s: MaxStore, captureId: ID, index: number, answers: Record<string, any> = {}): Promise<{ created: ID[]; open?: { kind: 'replan'; facts: ReplanFacts } | { kind: 'answer'; text: string } }> {
  const c = s.state.captures.get(captureId);
  if (!c?.parse) return { created: [] };
  if (c.applied[index]) return { created: c.applied[index] };
  const intent = c.parse.intents[index];
  const f = resolveFields(intent, answers);
  let created: ID[] = [];
  let open: { kind: 'replan'; facts: ReplanFacts } | { kind: 'answer'; text: string } | undefined;
  switch (intent.type) {
    case 'create_task': {
      const t = await createTask(s, { title: f.title, dueDate: f.dueDate, estimateMin: f.estimateMin, estimateSource: f.estimateMin ? 'user' : undefined, projectId: f.projectId, status: f.dueDate || f.projectId ? 'open' : 'inbox', captureId }, 'Capturé');
      created = [t.id];
      break;
    }
    case 'create_deadline': {
      const r = await createDeadline(s, { title: f.title, date: f.date, time: f.timeUnknown ? undefined : f.time, kind: f.kind, subjectId: f.subjectId, status: 'announced', source: 'capture' }, { prepTasks: f.prepTasks, subjectName: f.subjectName, captureId });
      created = r.ids;
      break;
    }
    case 'create_event':
      created = await createEvent(s, { title: f.title, date: f.date, time: f.time, durationMin: f.durationMin, category: f.category, travel: f.travel }, captureId);
      break;
    case 'log_sleep':
      created = [await logSleep(s, f, captureId)];
      break;
    case 'log_caffeine':
      created = [await logCaffeine(s, f as { time: string; product: string })];
      break;
    case 'progress': {
      const t = s.state.tasks.get(f.taskId);
      if (!t) break;
      const steps = f.stepDone ? [...t.steps, { id: newId('st'), title: f.stepDone, done: true }] : t.steps;
      const patch: Partial<Task> = { steps, nextStep: f.remainingCount ? `Encore ${f.remainingCount} à faire` : t.nextStep };
      if (f.remainingMin != null) { patch.remainingMin = f.remainingMin; patch.estimateSource = 'user'; }
      if (f.finished && !f.stepDone) patch.status = 'done';
      await updateTask(s, t.id, patch, 'Avancement');
      created = [t.id];
      break;
    }
    case 'move': {
      if (f.lock && f.ref?.startsWith('block:')) {
        await updateBlock(s, f.ref.slice(6), { protection: 'locked' }, 'Protégé');
        created = [f.ref.slice(6)];
      } else if (f.target === 'deadline') {
        if (f.choice === 'move_prep' || (!f.date && f.choice !== 'fix_date')) open = { kind: 'replan', facts: {} };
        else if (f.deadlineId && f.date) { await updateDeadline(s, f.deadlineId, { date: f.date, time: f.time ?? s.state.deadlines.get(f.deadlineId)?.time }, 'Date corrigée'); created = [f.deadlineId]; }
      } else if (f.ref?.startsWith('task:')) {
        const id = f.ref.slice(5);
        if (f.date === 'list' || !f.date) { await deferTask(s, id); created = [id]; }
        else { const r = await scheduleTask(s, id, f.date, f.time); if (r?.ok) created = [id]; else open = { kind: 'answer', text: r?.reason ?? 'Impossible de planifier.' }; }
      } else if (f.ref?.startsWith('block:')) {
        const id = f.ref.slice(6);
        const b = allBlocks(s, addDays(today(s), -8), addDays(today(s), 30)).find((x) => x.id === id);
        if (b) {
          const st = DateTime.fromISO(b.start).setZone(s.state.prefs.tz);
          const dur = minutesBetween(st, DateTime.fromISO(b.end));
          const ns = atLocal(f.date && f.date !== 'list' ? f.date : st.toISODate()!, f.time ?? st.toFormat('HH:mm'), s.state.prefs.tz);
          await updateBlock(s, id, { start: iso(ns), end: iso(ns.plus({ minutes: dur })) }, 'Déplacé');
          created = [id];
        }
      }
      break;
    }
    case 'energy':
      open = { kind: 'replan', facts: { energy: 'basse' } };
      break;
    case 'replan': {
      const facts: ReplanFacts = {};
      if (f.overrun?.blockId) facts.overrun = f.overrun;
      if (f.minutesLeft) facts.minutesLeft = f.minutesLeft;
      if (f.availableUntil) facts.availableUntil = f.availableUntil;
      if (f.cancelledBlockIds?.length) facts.cancelledBlockIds = f.cancelledBlockIds;
      if (f.prefer?.[0]?.taskId) facts.prefer = f.prefer;
      open = { kind: 'replan', facts };
      break;
    }
    case 'query_before_departure': {
      open = { kind: 'answer', text: answerBeforeDeparture(s) };
      break;
    }
    case 'repeat_block': {
      const src = allBlocks(s, f.sourceDate, f.sourceDate).find((b) => b.id === f.blockId);
      if (src) {
        const tz = s.state.prefs.tz;
        const st = DateTime.fromISO(src.start).setZone(tz);
        const en = DateTime.fromISO(src.end).setZone(tz);
        const ns = atLocal(f.targetDate, st.toFormat('HH:mm'), tz);
        const b = makeBlock(s.nowIso(), { ...src, id: newId(), recurrenceId: undefined, start: iso(ns), end: iso(ns.plus({ minutes: minutesBetween(st, en) })), status: 'accepted', source: `copié du ${f.sourceDate}`, origin: 'user', version: 1 });
        await s.commit(`Bloc copié : ${b.title}`, 'action', [{ store: 'blocks', next: b }]);
        created = [b.id];
      }
      break;
    }
  }
  // Mémoriser l'application (idempotence) — sauf pour les intentions qui ouvrent un aperçu non encore validé.
  if (!open || open.kind === 'answer') {
    const cur = s.state.captures.get(captureId)!;
    const applied = { ...cur.applied, [index]: created.length ? created : ['—'] };
    const done = cur.parse!.intents.every((_, i) => applied[i]);
    await s.commit('Capture traitée', 'capture', [{ store: 'captures', next: { ...cur, applied, status: done ? 'done' : 'partial' } }]);
  }
  return { created, open };
}

export async function dismissCapture(s: MaxStore, id: ID) {
  const c = s.state.captures.get(id);
  if (c) await s.commit('Capture classée', 'capture', [{ store: 'captures', next: { ...c, status: 'dismissed' } }]);
}

export function answerBeforeDeparture(s: MaxStore): string {
  const n = now(s);
  const d = localDate(n);
  const dep = s.state.prefs.departure?.date === d ? atLocal(d, s.state.prefs.departure.time, s.state.prefs.tz) : undefined;
  const trip = allBlocks(s, d, d).filter((b) => b.category === 'trajet' && DateTime.fromISO(b.start) > n).sort((a, b) => a.start.localeCompare(b.start))[0];
  const at = dep ?? (trip ? DateTime.fromISO(trip.start).setZone(s.state.prefs.tz) : undefined);
  if (!at) return 'Je ne connais pas ton heure de départ aujourd’hui. Ajoute un trajet dans l’agenda ou dis « je pars à 17 h 30 ».';
  const mins = Math.max(0, minutesBetween(n, at) - s.state.prefs.bufferMin);
  if (mins < 10) return `Départ à ${at.toFormat("HH'h'mm")} : moins de 10 min utiles. Prépare tes affaires.`;
  const sug = suggest30(s, mins);
  return `Départ à ${at.toFormat("HH'h'mm")} (${trip ? 'trajet enregistré' : 'départ déclaré'}) : ${sug.title}, ${sug.minutes ?? mins} min. ${sug.reason}`;
}

export { GRAMMAR_VERSION };
export type { Change };

/** Annuler ce qu'une intention a créé (suppression douce) ; la capture reste et peut être réappliquée. */
export async function undoIntent(s: MaxStore, captureId: ID, index: number) {
  const c = s.state.captures.get(captureId);
  if (!c?.applied[index]) return;
  const nowIso = s.nowIso();
  const writes: W[] = [];
  const intent = c.parse?.intents[index];
  for (const id of c.applied[index]) {
    for (const store of ['tasks', 'deadlines', 'blocks', 'logs', 'projects'] as const) {
      const e = (s.state[store] as Map<ID, any>).get(id);
      if (!e) continue;
      // Une intention qui a modifié un objet existant (avancement, déplacement) se défait via l'historique.
      if (intent && ['progress', 'move'].includes(intent.type)) continue;
      writes.push({ store, next: { ...e, deletedAt: nowIso } });
    }
  }
  const applied = { ...c.applied };
  delete applied[index];
  writes.push({ store: 'captures', next: { ...c, applied, status: 'needs_input' } });
  if (intent && ['progress', 'move'].includes(intent.type)) {
    // Retrouver le lot correspondant et l'annuler.
    const b = s.state.batches.find((x) => !x.undoneAt && x.kind === 'action' && x.ops.some((o) => c.applied[index].includes(o.id)));
    if (b) await s.undo(b.id);
  }
  return s.commit('Capture annulée', 'capture', writes);
}
