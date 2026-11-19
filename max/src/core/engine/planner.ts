// Moteur de replanification de Max.
// Pur et déterministe : mêmes faits → même plan. Aucun modèle de langage requis.
import { DateTime } from 'luxon';
import type { Area, Block, Deadline, ID, Prefs, ReplanFacts, Task } from '../types';
import { atLocal, fmtDuration, fmtRange, fmtTime, iso, localDate, minutesBetween } from '../time';

export interface EngineInput {
  now: DateTime;
  prefs: Prefs;
  /** Blocs stockés (non supprimés) + occurrences de récurrences déjà développées. */
  blocks: Block[];
  tasks: Task[];
  deadlines: Deadline[];
  areas?: Area[];
  facts?: ReplanFacts;
  horizonDays?: number;
}

export interface Chunk {
  taskId: ID;
  start: DateTime;
  end: DateTime;
  minutes: number;
  stepTitle?: string;
  /** Bloc précédent conservé (même créneau). */
  keptBlockId?: ID;
  pinned?: boolean;
}

export type ChangeKind = 'keep' | 'move' | 'create' | 'to_list' | 'later' | 'block_extend' | 'block_cancel' | 'missed';
export interface Change {
  key: string;
  kind: ChangeKind;
  taskId?: ID;
  blockId?: ID;
  title: string;
  from?: { start: DateTime; end: DateTime };
  to?: { start: DateTime; end: DateTime };
  minutes?: number;
  stepTitle?: string;
  reason: string;
  pinned?: boolean;
}

export type Outcome = 'today' | 'split' | 'later' | 'unplanned' | 'arbitrage' | 'current';
export interface TaskOutcome {
  taskId: ID;
  title: string;
  outcome: Outcome;
  neededMin: number;
  placedMin: number;
  placedBeforeLimitMin: number;
  limit?: DateTime;
  limitLabel?: string;
  afterLimit?: boolean;
  reason: string;
}

export interface Warning { kind: 'uncertain_time' | 'conflict' | 'pin_conflict' | 'travel_unknown' | 'energy' | 'cycle' | 'past_deadline'; message: string; refIds: ID[] }
export interface Tradeoff { message: string; taskIds: ID[]; options: { label: string; facts: ReplanFacts }[] }

export interface NextAction {
  kind: 'current' | 'task' | 'free' | 'rest';
  taskId?: ID;
  blockId?: ID;
  title: string;
  minutes?: number;
  start?: DateTime;
  end?: DateTime;
  /** Prochain engagement fixe (limite du temps réellement disponible). */
  until?: DateTime;
  untilLabel?: string;
}

export interface PlanResult {
  now: DateTime;
  chunks: Chunk[];
  changes: Change[];
  outcomes: TaskOutcome[];
  warnings: Warning[];
  tradeoffs: Tradeoff[];
  capacity: { freeTodayMin: number; activeTodayMin: number; neededTodayMin: number; shortfallMin: number };
  summary: string[];
  nextAction: NextAction;
  busy: Busy[];
  /** Engagement fixe en cours (cours, TP…), affiché au-dessus de la prochaine action. */
  currentBlock?: { id: ID; title: string; start: DateTime; end: DateTime };
}

export interface Busy { start: DateTime; end: DateTime; label: string; blockId?: ID; kind: 'fixed' | 'sleep' | 'protected' | 'planned' | 'cap' | 'deadline'; bufferable: boolean }

const PLANNABLE: Task['status'][] = ['open', 'in_progress', 'inbox'];
const BUFFERED = new Set(['cours', 'tp', 'controle', 'trajet', 'sport', 'rdv', 'famille']);

export function remainingMinutes(t: Task): number {
  if (t.remainingMin != null) return Math.max(0, t.remainingMin);
  const openSteps = t.steps.filter((s) => !s.done && s.estimateMin != null);
  if (openSteps.length && t.steps.every((s) => s.done || s.estimateMin != null)) {
    return openSteps.reduce((a, s) => a + (s.estimateMin ?? 0), 0);
  }
  const est = t.estimateMin ?? 30;
  return Math.max(0, est - (t.spentMin ?? 0));
}

/** Détecte les dépendances circulaires ; renvoie les ids pris dans un cycle. */
export function findCycles(tasks: Task[]): Set<ID> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<ID, 0 | 1 | 2>();
  const inCycle = new Set<ID>();
  const stack: ID[] = [];
  const visit = (id: ID) => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      const i = stack.indexOf(id);
      stack.slice(i).forEach((x) => inCycle.add(x));
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const d of byId.get(id)?.dependsOn ?? []) if (byId.has(d)) visit(d);
    stack.pop();
    state.set(id, 2);
  };
  tasks.forEach((t) => visit(t.id));
  return inCycle;
}

/** Ajouter cette dépendance créerait-il un cycle ? */
export function wouldCreateCycle(tasks: Task[], taskId: ID, dependsOnId: ID): boolean {
  if (taskId === dependsOnId) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<ID>();
  const walk = (id: ID): boolean => {
    if (id === taskId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (byId.get(id)?.dependsOn ?? []).some(walk);
  };
  return walk(dependsOnId);
}

function roundUp5(dt: DateTime): DateTime {
  const m = dt.minute % 5;
  const base = dt.set({ second: 0, millisecond: 0 });
  return m === 0 && dt.second === 0 && dt.millisecond === 0 ? base : base.plus({ minutes: 5 - m });
}

interface Limit { at: DateTime; label: string; hard: boolean; uncertain: boolean; deadline?: Deadline }

function taskLimit(t: Task, deadlines: Map<ID, Deadline>, now: DateTime, tz: string): Limit | undefined {
  const today = localDate(now);
  const d = t.deadlineId ? deadlines.get(t.deadlineId) : undefined;
  if (d && !d.deletedAt && d.status !== 'cancelled' && d.status !== 'done' && d.status !== 'history') {
    if (d.time) {
      return { at: atLocal(d.date, d.time, d.tz || tz), label: `${d.title} (${fmtTime(atLocal(d.date, d.time, d.tz || tz))})`, hard: true, uncertain: false, deadline: d };
    }
    // Heure inconnue : préparer avant le jour J. Si c'est aujourd'hui, on prépare tout de suite avec une alerte.
    if (d.date === today) {
      return { at: atLocal(d.date, '23:59', d.tz || tz), label: `${d.title} (aujourd'hui, heure inconnue)`, hard: true, uncertain: true, deadline: d };
    }
    return { at: atLocal(d.date, '00:00', d.tz || tz), label: `${d.title} (${d.date}, heure à confirmer)`, hard: true, uncertain: true, deadline: d };
  }
  if (t.dueDate) {
    const at = t.dueTime ? atLocal(t.dueDate, t.dueTime, tz) : atLocal(t.dueDate, '23:59', tz);
    return { at, label: `date limite ${t.dueTime ? fmtTime(at) + ' ' : ''}${t.dueDate}`, hard: false, uncertain: false };
  }
  return undefined;
}

function urgencyClass(limit: Limit | undefined, now: DateTime): number {
  if (!limit) return 4;
  const days = limit.at.startOf('day').diff(now.startOf('day'), 'days').days;
  if (days <= 1) return 0;
  if (days <= 3) return 1;
  if (days <= 7) return 2;
  return 3;
}

function subtract(segments: [DateTime, DateTime][], s: DateTime, e: DateTime): [DateTime, DateTime][] {
  const out: [DateTime, DateTime][] = [];
  for (const [a, b] of segments) {
    if (e <= a || s >= b) { out.push([a, b]); continue; }
    if (s > a) out.push([a, s]);
    if (e < b) out.push([e, b]);
  }
  return out;
}

export function plan(input: EngineInput): PlanResult {
  const { prefs } = input;
  const tz = prefs.tz;
  const now = input.now.setZone(tz);
  const facts = input.facts ?? {};
  const horizonDays = input.horizonDays ?? 7;
  const today = localDate(now);
  const start = roundUp5(now);
  const horizonEnd = now.startOf('day').plus({ days: horizonDays + 1 });
  const deadlines = new Map(input.deadlines.filter((d) => !d.deletedAt).map((d) => [d.id, d]));
  const areas = new Map((input.areas ?? []).map((a) => [a.id, a]));
  const warnings: Warning[] = [];
  const changes: Change[] = [];
  const energyLow = facts.energy ? facts.energy === 'basse' : prefs.energy?.date === today && prefs.energy.level === 'basse';
  const maxChunk = energyLow ? Math.min(30, prefs.maxChunkMin) : prefs.maxChunkMin;
  const buffer = prefs.bufferMin;

  // ---------- 1. Faits : débordement, annulations ----------
  const cancelled = new Set(facts.cancelledBlockIds ?? []);
  const liveBlocks = input.blocks.filter((b) => !b.deletedAt && b.status !== 'cancelled' && !cancelled.has(b.id));
  for (const id of cancelled) {
    const b = input.blocks.find((x) => x.id === id);
    if (b) changes.push({ key: `cancel:${id}`, kind: 'block_cancel', blockId: id, title: b.title, from: { start: DateTime.fromISO(b.start).setZone(tz), end: DateTime.fromISO(b.end).setZone(tz) }, reason: 'Annulé' });
  }
  const endOf = (b: Block) => {
    if (facts.overrun?.blockId === b.id) {
      const s = DateTime.fromISO(b.start).setZone(tz);
      let e = atLocal(localDate(s), facts.overrun.until, tz);
      if (e <= s) e = e.plus({ days: 1 });
      return e;
    }
    return DateTime.fromISO(b.actualEnd ?? b.end).setZone(tz);
  };
  if (facts.overrun) {
    const b = input.blocks.find((x) => x.id === facts.overrun!.blockId);
    if (b) {
      const s = DateTime.fromISO(b.start).setZone(tz);
      changes.push({ key: `extend:${b.id}`, kind: 'block_extend', blockId: b.id, title: b.title, from: { start: s, end: DateTime.fromISO(b.end).setZone(tz) }, to: { start: s, end: endOf(b) }, reason: `Déborde jusqu'à ${fmtTime(endOf(b))}` });
    }
  }

  // ---------- 2. Temps occupé ----------
  const busy: Busy[] = [];
  const plannedPrev: Block[] = [];
  const graceKept: Block[] = [];
  let current: Block | undefined;
  for (const b of liveBlocks) {
    const s = DateTime.fromISO(b.start).setZone(tz);
    const e = endOf(b);
    if (e <= now.minus({ days: 1 }) || s >= horizonEnd) continue;
    if (b.kind === 'planned') {
      if (b.status === 'done') { busy.push({ start: s, end: e, label: b.title, blockId: b.id, kind: 'planned', bufferable: false }); continue; }
      if (b.status === 'missed') continue;
      const task = b.taskId ? input.tasks.find((t) => t.id === b.taskId) : undefined;
      if (s <= now && e > now && task?.status === 'in_progress') {
        current = b;
        busy.push({ start: s, end: e, label: b.title, blockId: b.id, kind: 'planned', bufferable: false });
        continue;
      }
      // Créneau accepté qui vient de commencer (≤ 15 min) : on le garde tel quel.
      if (s <= now && e > now && minutesBetween(s, now) <= 15 && task && task.status !== 'done') {
        graceKept.push(b); // validé plus bas s'il ne chevauche aucun engagement
        continue;
      }
      if (e <= now) continue; // créneau passé non fait : la tâche revient dans le calcul
      if (b.protection === 'locked' && s >= now) {
        busy.push({ start: s, end: e, label: b.title, blockId: b.id, kind: 'planned', bufferable: false });
      }
      plannedPrev.push(b);
      continue;
    }
    busy.push({ start: s, end: e, label: b.private ? 'Temps privé' : b.title, blockId: b.id, kind: b.kind === 'protected' ? 'protected' : 'fixed', bufferable: BUFFERED.has(b.category) });
    if (s <= now && e > now && !current) current = b;
  }
  // Échéances avec heure : le contrôle lui-même occupe son créneau (sauf s'il a déjà un bloc).
  for (const d of deadlines.values()) {
    if (!d.time || d.status === 'cancelled' || d.status === 'history') continue;
    if (liveBlocks.some((b) => b.deadlineId === d.id)) continue;
    const s = atLocal(d.date, d.time, d.tz || tz);
    const e = s.plus({ minutes: d.durationMin ?? 60 });
    if (e < now || s > horizonEnd) continue;
    busy.push({ start: s, end: e, label: d.title, kind: 'deadline', bufferable: true });
  }
  // Sommeil protégé.
  if (prefs.sleep.protect) {
    for (let i = -1; i <= horizonDays + 1; i++) {
      const day = now.startOf('day').plus({ days: i });
      const date = localDate(day);
      let bed = atLocal(date, prefs.sleep.bed, tz);
      if (bed.hour < 12) bed = bed.plus({ days: 1 }); // coucher après minuit
      const wake = atLocal(localDate(bed.hour < 12 ? bed : bed.plus({ days: 1 })), prefs.sleep.wake, tz);
      busy.push({ start: bed, end: wake > bed ? wake : wake.plus({ days: 1 }), label: 'Sommeil protégé', kind: 'sleep', bufferable: false });
    }
  }
  // Limite déclarée pour aujourd'hui.
  let capUntil: DateTime | undefined;
  if (facts.minutesLeft != null) capUntil = start.plus({ minutes: facts.minutesLeft });
  else if (facts.availableUntil) capUntil = atLocal(today, facts.availableUntil, tz);
  else if (prefs.availableUntil?.date === today) capUntil = atLocal(today, prefs.availableUntil.time, tz);
  if (capUntil) busy.push({ start: capUntil, end: now.endOf('day'), label: 'Indisponible (déclaré)', kind: 'cap', bufferable: false });

  // Créneaux tout juste commencés : gardés seulement s'ils ne chevauchent plus aucun engagement (ex. TP qui déborde).
  for (const b of [...graceKept]) {
    const s = DateTime.fromISO(b.start).setZone(tz), e = DateTime.fromISO(b.end).setZone(tz);
    if (busy.some((x) => x.kind !== 'planned' && x.kind !== 'sleep' && x.start < e && s < x.end)) {
      graceKept.splice(graceKept.indexOf(b), 1);
      plannedPrev.push(b);
    } else busy.push({ start: s, end: e, label: b.title, blockId: b.id, kind: 'planned', bufferable: false });
  }

  // Conflits entre engagements fixes : signalés, jamais déplacés.
  const fixed = busy.filter((b) => b.kind === 'fixed' || b.kind === 'deadline' || b.kind === 'protected').sort((a, b) => +a.start - +b.start);
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      if (fixed[j].start >= fixed[i].end) break;
      if (fixed[j].end <= now) continue;
      warnings.push({ kind: 'conflict', message: `Conflit : « ${fixed[i].label} » (${fmtRange(fixed[i].start, fixed[i].end)}) chevauche « ${fixed[j].label} » (${fmtRange(fixed[j].start, fixed[j].end)}). À toi de choisir.`, refIds: [fixed[i].blockId, fixed[j].blockId].filter(Boolean) as ID[] });
    }
  }

  // ---------- 3. Temps libre ----------
  let free: [DateTime, DateTime][] = [[start, horizonEnd]];
  for (const b of busy) {
    const pad = b.bufferable ? buffer : 0;
    free = subtract(free, b.start.minus({ minutes: pad }), b.end.plus({ minutes: pad }));
  }
  const minUseful = prefs.minUsefulMin;
  free = free.filter(([a, b]) => minutesBetween(a, b) >= minUseful);

  // ---------- 4. Tâches à placer ----------
  const cycles = findCycles(input.tasks);
  if (cycles.size) warnings.push({ kind: 'cycle', message: 'Dépendance circulaire détectée : ces tâches sont traitées sans dépendance.', refIds: [...cycles] });
  const doneIds = new Set(input.tasks.filter((t) => t.status === 'done').map((t) => t.id));
  const taskById = new Map(input.tasks.map((t) => [t.id, t]));
  const dependents = new Map<ID, number>();
  for (const t of input.tasks) for (const d of t.dependsOn) dependents.set(d, (dependents.get(d) ?? 0) + 1);
  const prevByTask = new Map<ID, Block[]>();
  for (const b of plannedPrev) if (b.taskId) prevByTask.set(b.taskId, [...(prevByTask.get(b.taskId) ?? []), b].sort((x, y) => x.start.localeCompare(y.start)));
  const removeToday = new Set(facts.removeTaskIds ?? []);
  const insteadOf = new Map<ID, { taskId: ID; minutes: number }>();
  for (const p of facts.prefer ?? []) if (p.insteadOfTaskId) { insteadOf.set(p.insteadOfTaskId, p); removeToday.add(p.insteadOfTaskId); }

  const plannable = input.tasks.filter((t) => {
    if (t.deletedAt || !PLANNABLE.includes(t.status)) return false;
    if (current?.taskId === t.id) return remainingMinutes(t) > minutesBetween(now, DateTime.fromISO(current.end).setZone(tz));
    const hasLimit = !!(t.dueDate || t.deadlineId);
    return remainingMinutes(t) > 0 && (hasLimit || t.priority > 0 || prevByTask.has(t.id) || facts.pins?.some((p) => p.taskId === t.id) || facts.prefer?.some((p) => p.taskId === t.id) || t.status === 'in_progress');
  });

  const meta = new Map(plannable.map((t) => {
    const limit = taskLimit(t, deadlines, now, tz);
    return [t.id, {
      limit,
      cls: urgencyClass(limit, now),
      high: limit?.deadline?.importance === 'haute' ? 0 : 1,
      unblock: t.unblocks || (dependents.get(t.id) ?? 0) > 0 ? 0 : 1,
      prevStart: prevByTask.get(t.id)?.[0]?.start ?? '9999',
    }];
  }));
  const order = [...plannable].sort((a, b) => {
    const ma = meta.get(a.id)!, mb = meta.get(b.id)!;
    return ma.cls - mb.cls || ma.high - mb.high || ma.unblock - mb.unblock || b.priority - a.priority ||
      (ma.limit?.at.toMillis() ?? Infinity) - (mb.limit?.at.toMillis() ?? Infinity) ||
      ma.prevStart.localeCompare(mb.prevStart) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
  // Les dépendances non faites passent avant (si elles sont dans la liste).
  const sorted: Task[] = [];
  const placedOrder = new Set<ID>();
  const pushWithDeps = (t: Task, depth = 0) => {
    if (placedOrder.has(t.id) || depth > 20) return;
    if (!cycles.has(t.id)) for (const d of t.dependsOn) { const dt = taskById.get(d); if (dt && order.includes(dt)) pushWithDeps(dt, depth + 1); }
    placedOrder.add(t.id);
    sorted.push(t);
  };
  order.forEach((t) => pushWithDeps(t));

  // ---------- 5. Placement ----------
  const chunks: Chunk[] = [];
  const areaUse = new Map<string, number>(); // `${areaId}|${date}` → minutes
  const take = (s: DateTime, e: DateTime) => { free = subtract(free, s, e.plus({ minutes: buffer })); free = free.filter(([a, b]) => minutesBetween(a, b) >= minUseful); };
  const isFree = (s: DateTime, e: DateTime) => free.some(([a, b]) => a <= s && b >= e);
  const energyCapToday = energyLow ? 90 : Infinity;
  let activeToday = 0;
  const outcomes: TaskOutcome[] = [];
  const tradeoffs: Tradeoff[] = [];

  for (const b of graceKept) {
    const s = DateTime.fromISO(b.start).setZone(tz), e = DateTime.fromISO(b.end).setZone(tz);
    const minutes = minutesBetween(s, e);
    chunks.push({ taskId: b.taskId!, start: s, end: e, minutes, keptBlockId: b.id, stepTitle: b.stepTitle });
    if (localDate(s) === today) activeToday += minutes;
  }
  // 5a. Épingles (heure imposée par moi)
  const pinnedTasks = new Set<ID>();
  const pinList = [...(facts.pins ?? [])];
  for (const p of facts.prefer ?? []) {
    const victim = p.insteadOfTaskId ? prevByTask.get(p.insteadOfTaskId)?.[0] : undefined;
    if (victim) pinList.push({ taskId: p.taskId, start: DateTime.fromISO(victim.start).setZone(tz).toFormat('HH:mm'), minutes: p.minutes });
  }
  for (const p of pinList) {
    const t = taskById.get(p.taskId);
    if (!t) continue;
    let s = atLocal(today, p.start, tz);
    if (s < start) s = start;
    const minutes = p.minutes ?? Math.min(remainingMinutes(t), maxChunk);
    const e = s.plus({ minutes });
    const clash = busy.find((b) => b.kind !== 'cap' && b.start < e && s < b.end);
    if (clash) warnings.push({ kind: 'pin_conflict', message: `« ${t.title} » épinglé ${fmtRange(s, e)} chevauche « ${clash.label} ».`, refIds: [t.id] });
    chunks.push({ taskId: t.id, start: s, end: e, minutes, pinned: true });
    pinnedTasks.add(t.id);
    take(s, e);
    if (localDate(s) === today) activeToday += minutes;
  }

  for (const t of sorted) {
    const m = meta.get(t.id)!;
    let need = remainingMinutes(t);
    if (current?.taskId === t.id) need -= minutesBetween(now, DateTime.fromISO(current.end).setZone(tz));
    need -= chunks.filter((c) => c.taskId === t.id).reduce((a, c) => a + c.minutes, 0);
    const neededMin = remainingMinutes(t);
    if (need <= 0) {
      outcomes.push({ taskId: t.id, title: t.title, outcome: pinnedTasks.has(t.id) ? 'today' : 'current', neededMin, placedMin: neededMin, placedBeforeLimitMin: neededMin, reason: pinnedTasks.has(t.id) ? 'Épinglé à ton horaire' : 'Bloc en cours' });
      continue;
    }
    const continuous = !!t.continuous;
    const minChunk = Math.min(need, Math.max(t.minChunkMin ?? prefs.defaultChunkMin, minUseful));
    const notToday = removeToday.has(t.id);
    const depsOpen = !cycles.has(t.id) && t.dependsOn.some((d) => taskById.has(d) && !doneIds.has(d));
    const depEnd = depsOpen ? chunks.filter((c) => t.dependsOn.includes(c.taskId)).reduce<DateTime | undefined>((a, c) => (!a || c.end > a ? c.end : a), undefined) : undefined;
    const limit = m.limit;
    const placed: Chunk[] = [];
    const areaKey = (d: DateTime) => `${t.areaId ?? ''}|${localDate(d)}`;
    const areaBudget = t.areaId ? areas.get(t.areaId)?.dailyBudgetMin : undefined;
    const allow = (s: DateTime, minutes: number) => {
      let ok = minutes;
      if (localDate(s) === today && energyLow) ok = Math.min(ok, Math.max(0, energyCapToday - activeToday));
      if (areaBudget != null) ok = Math.min(ok, Math.max(0, areaBudget - (areaUse.get(areaKey(s)) ?? 0)));
      return ok;
    };
    const commit = (c: Chunk) => {
      placed.push(c); chunks.push(c); take(c.start, c.end); need -= c.minutes;
      if (localDate(c.start) === today) activeToday += c.minutes;
      if (t.areaId) areaUse.set(areaKey(c.start), (areaUse.get(areaKey(c.start)) ?? 0) + c.minutes);
    };
    // Stabilité : réessayer d'abord les créneaux déjà acceptés.
    for (const pb of prevByTask.get(t.id) ?? []) {
      if (need <= 0) break;
      const s = DateTime.fromISO(pb.start).setZone(tz), e = DateTime.fromISO(pb.end).setZone(tz);
      const mins = minutesBetween(s, e);
      if (s < start || (notToday && localDate(s) === today) || (depEnd && s < depEnd)) continue;
      if (mins > need + 5 || !isFree(s, e) || allow(s, mins) < mins) continue;
      commit({ taskId: t.id, start: s, end: e, minutes: mins, keptBlockId: pb.id, stepTitle: pb.stepTitle });
    }
    // Remplissage au plus tôt.
    const tryFill = (before?: DateTime) => {
      for (const [a0, b0] of [...free]) {
        if (need <= 0) break;
        let a = a0;
        if (notToday && localDate(a) === today) continue;
        if (depEnd && a < depEnd) a = depEnd;
        let b = b0;
        if (before && b > before) b = before;
        let segLen = minutesBetween(a, b);
        while (need > 0 && segLen >= Math.min(minChunk, need)) {
          let want = continuous ? need : Math.min(need, maxChunk);
          if (continuous && segLen < need) break;
          want = Math.min(want, segLen);
          want = allow(a, want);
          if (want < Math.min(minChunk, need) || want <= 0) break;
          // Éviter de laisser un reliquat inutilisable : si le reste < minChunk, tout prendre si possible.
          if (!continuous && need - want > 0 && need - want < minChunk) {
            if (segLen >= need && allow(a, need) >= need && need <= maxChunk + minChunk) want = need;
            else if (want - (minChunk - (need - want)) >= minChunk) want -= minChunk - (need - want);
          }
          const s = a, e = a.plus({ minutes: want });
          if (!isFree(s, e)) break;
          commit({ taskId: t.id, start: s, end: e, minutes: want });
          a = e.plus({ minutes: buffer });
          segLen = minutesBetween(a, b);
        }
      }
    };
    tryFill(limit?.hard ? limit.at : undefined);
    const placedBefore = placed.filter((c) => !limit || c.end <= limit.at).reduce((s, c) => s + c.minutes, 0);
    let stepPlaced = false;
    // Rien de complet ne tient avant la limite : proposer une première étape utile.
    if (limit?.hard && need > 0 && placed.length === 0) {
      const seg = free.find(([a, b]) => (!notToday || localDate(a) !== today) && minutesBetween(a, b < limit.at ? b : limit.at) >= 15 && a < limit.at);
      if (seg) {
        const mins = Math.min(15, minutesBetween(seg[0], seg[1]));
        const step = t.nextStep || t.steps.find((s) => !s.done)?.title || `Retrouver le support et faire une première question`;
        commit({ taskId: t.id, start: seg[0], end: seg[0].plus({ minutes: mins }), minutes: mins, stepTitle: step });
        stepPlaced = true;
      }
    }
    if (!limit?.hard && need > 0) tryFill();
    const placedMin = placed.reduce((s, c) => s + c.minutes, 0);
    const placedToday = placed.filter((c) => localDate(c.start) === today).reduce((s, c) => s + c.minutes, 0);
    const firstFree = free[0];
    const freeHint = firstFree ? `${minutesBetween(firstFree[0], firstFree[1])} min libres à partir de ${fmtTime(firstFree[0])}` : 'plus de créneau libre dans la fenêtre';
    let outcome: Outcome;
    let reason: string;
    const afterLimit = !!limit && !limit.hard && placed.some((c) => c.end > limit.at);
    if (limit?.hard && placedBefore < neededMin - (current?.taskId === t.id ? minutesBetween(now, DateTime.fromISO(current.end).setZone(tz)) : 0)) {
      outcome = 'arbitrage';
      const missing = neededMin - placedBefore;
      reason = stepPlaced
        ? `Seule une étape de 15 min tient avant ${limit.label} ; il manque ${fmtDuration(missing - 15 > 0 ? missing - 15 : missing)}.`
        : `${fmtDuration(placedBefore)} placées avant ${limit.label}, ${fmtDuration(neededMin)} nécessaires.`;
    } else if (placedMin === 0) {
      outcome = 'unplanned';
      reason = notToday ? 'Retirée d’aujourd’hui : reste dans la liste.' : `Pas de créneau assez long (${fmtDuration(Math.min(need, continuous ? need : minChunk))} requis) : ${freeHint}.`;
    } else if (placedToday === placedMin && need <= 0) {
      outcome = 'today';
      reason = limit ? `Avant ${limit.label}.` : 'Créneau libre aujourd’hui.';
    } else if (placedToday > 0) {
      outcome = 'split';
      reason = `${fmtDuration(placedToday)} aujourd'hui, le reste plus tard.`;
    } else {
      outcome = 'later';
      reason = notToday ? 'Retirée d’aujourd’hui à ta demande.' : energyLow ? 'Énergie basse : reporté pour alléger aujourd’hui.' : `Pas de place aujourd'hui (${fmtDuration(neededMin)} nécessaires).`;
    }
    if (afterLimit) reason += ' ⚠ La prochaine place proposée est après la date limite.';
    if (limit?.uncertain && placed.length) {
      warnings.push({ kind: 'uncertain_time', message: `Heure de « ${limit.deadline?.title} » inconnue : la préparation est placée sans certitude. Confirme l'heure.`, refIds: [limit.deadline!.id] });
    }
    outcomes.push({ taskId: t.id, title: t.title, outcome, neededMin, placedMin, placedBeforeLimitMin: placedBefore, limit: limit?.at, limitLabel: limit?.label, afterLimit, reason });
  }

  // Compromis : une épingle prive une échéance de sa préparation.
  const arb = outcomes.filter((o) => o.outcome === 'arbitrage');
  if (arb.length && pinnedTasks.size) {
    const pinnedTitles = [...pinnedTasks].map((id) => taskById.get(id)?.title).filter(Boolean).join(', ');
    tradeoffs.push({
      message: `En gardant « ${pinnedTitles} » à ton horaire, « ${arb[0].title} » n'a que ${fmtDuration(arb[0].placedBeforeLimitMin)} sur ${fmtDuration(arb[0].neededMin)} avant ${arb[0].limitLabel}.`,
      taskIds: [...pinnedTasks, arb[0].taskId],
      options: [
        { label: `Garder l'épingle`, facts: { ...facts } },
        { label: `Donner la priorité à « ${arb[0].title} »`, facts: { ...facts, pins: [], prefer: [] } },
      ],
    });
  } else if (arb.length) {
    tradeoffs.push({ message: `${arb[0].title} : ${arb[0].reason}`, taskIds: arb.map((a) => a.taskId), options: [] });
  }

  // ---------- 6. Différences avec le plan accepté ----------
  const newByTask = new Map<ID, Chunk[]>();
  for (const c of chunks) newByTask.set(c.taskId, [...(newByTask.get(c.taskId) ?? []), c].sort((a, b) => +a.start - +b.start));
  const allTaskIds = new Set([...newByTask.keys(), ...prevByTask.keys()]);
  for (const tid of allTaskIds) {
    const t = taskById.get(tid);
    const title = t?.title ?? 'Tâche';
    const olds = [...(prevByTask.get(tid) ?? [])];
    const news = [...(newByTask.get(tid) ?? [])];
    const outcome = outcomes.find((o) => o.taskId === tid);
    for (const c of news.filter((c) => c.keptBlockId)) {
      const i = olds.findIndex((o) => o.id === c.keptBlockId);
      if (i >= 0) olds.splice(i, 1);
      changes.push({ key: `keep:${c.keptBlockId}`, kind: 'keep', taskId: tid, blockId: c.keptBlockId, title, to: { start: c.start, end: c.end }, minutes: c.minutes, stepTitle: c.stepTitle, reason: 'Inchangé' });
    }
    for (const c of news.filter((c) => !c.keptBlockId)) {
      const o = olds.shift();
      const reason = c.pinned ? 'Épinglé à ton horaire' : c.stepTitle ? `Première étape : seul un créneau court tient avant l'échéance` : outcome?.reason ?? '';
      if (o) changes.push({ key: `move:${o.id}`, kind: 'move', taskId: tid, blockId: o.id, title, from: { start: DateTime.fromISO(o.start).setZone(tz), end: DateTime.fromISO(o.end).setZone(tz) }, to: { start: c.start, end: c.end }, minutes: c.minutes, stepTitle: c.stepTitle, reason, pinned: c.pinned });
      else changes.push({ key: `create:${tid}:${iso(c.start)}`, kind: localDate(c.start) === today ? 'create' : 'later', taskId: tid, title, to: { start: c.start, end: c.end }, minutes: c.minutes, stepTitle: c.stepTitle, reason, pinned: c.pinned });
    }
    for (const o of olds) {
      changes.push({ key: `tolist:${o.id}`, kind: 'to_list', taskId: tid, blockId: o.id, title, from: { start: DateTime.fromISO(o.start).setZone(tz), end: DateTime.fromISO(o.end).setZone(tz) }, reason: outcome?.reason || 'Retiré du plan : reste dans la liste avec sa date et son projet.' });
    }
  }
  // Créneaux passés non faits → manqués (la tâche reste ouverte).
  for (const b of liveBlocks) {
    if (b.kind !== 'planned' || b.status !== 'accepted') continue;
    const e = DateTime.fromISO(b.end).setZone(tz);
    const t = b.taskId ? taskById.get(b.taskId) : undefined;
    if (e <= now && t && t.status !== 'done' && b.id !== current?.id) {
      changes.push({ key: `missed:${b.id}`, kind: 'missed', taskId: t.id, blockId: b.id, title: t.title, from: { start: DateTime.fromISO(b.start).setZone(tz), end: e }, reason: 'Créneau passé sans être fait : la tâche reste ouverte.' });
    }
  }
  const kindOrder: Record<ChangeKind, number> = { block_extend: 0, block_cancel: 1, missed: 2, move: 3, create: 4, keep: 5, to_list: 6, later: 7 };
  changes.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || (+(a.to?.start ?? a.from?.start ?? 0) - +(b.to?.start ?? b.from?.start ?? 0)) || a.key.localeCompare(b.key));

  // ---------- 7. Capacité ----------
  const endToday = now.endOf('day');
  let freeToday = 0;
  {
    let f: [DateTime, DateTime][] = [[start, endToday]];
    for (const b of busy) f = subtract(f, b.start.minus({ minutes: b.bufferable ? buffer : 0 }), b.end.plus({ minutes: b.bufferable ? buffer : 0 }));
    freeToday = f.reduce((s, [a, b]) => s + Math.max(0, minutesBetween(a, b)), 0);
  }
  const neededToday = outcomes.filter((o) => o.limit && o.limit <= now.plus({ days: 1 }).endOf('day')).reduce((s, o) => s + o.neededMin, 0);
  const activeTodayMin = chunks.filter((c) => localDate(c.start) === today).reduce((s, c) => s + c.minutes, 0);
  const shortfall = outcomes.filter((o) => o.outcome === 'arbitrage').reduce((s, o) => s + (o.neededMin - o.placedBeforeLimitMin), 0);
  if (energyLow) warnings.push({ kind: 'energy', message: `Énergie basse déclarée : séances de ${maxChunk} min max, ${fmtDuration(energyCapToday)} de travail actif au plus aujourd'hui.`, refIds: [] });

  // ---------- 8. Prochaine action ----------
  const nextFixed = busy.filter((b) => (b.kind === 'fixed' || b.kind === 'deadline' || b.kind === 'protected' || b.kind === 'cap') && b.start > now).sort((a, b) => +a.start - +b.start)[0];
  let nextAction: NextAction;
  const todayChunks = chunks.filter((c) => localDate(c.start) === today).sort((a, b) => +a.start - +b.start);
  if (current && current.kind === 'planned') {
    const t = current.taskId ? taskById.get(current.taskId) : undefined;
    nextAction = { kind: 'current', blockId: current.id, taskId: t?.id, title: t?.title ?? current.title, start: DateTime.fromISO(current.start).setZone(tz), end: endOf(current), until: nextFixed?.start, untilLabel: nextFixed?.label };
  } else if (todayChunks.length) {
    const c = todayChunks[0];
    const t = taskById.get(c.taskId)!;
    const nf = busy.filter((b) => b.kind !== 'planned' && b.start >= c.end).sort((a, b) => +a.start - +b.start)[0];
    nextAction = { kind: 'task', taskId: c.taskId, title: c.stepTitle ?? t.nextStep ?? t.title, minutes: c.minutes, start: c.start, end: c.end, until: nf?.start, untilLabel: nf?.label };
  } else {
    nextAction = { kind: energyLow ? 'rest' : 'free', title: energyLow ? 'Repos' : 'Libre', until: nextFixed?.start, untilLabel: nextFixed?.label };
  }

  // ---------- 9. Résumé (3 phrases max, décision d'abord) ----------
  const summary: string[] = [];
  if (tradeoffs.length) summary.push(tradeoffs[0].message);
  const firstUrgent = todayChunks.find((c) => (meta.get(c.taskId)?.cls ?? 4) <= 1) ?? todayChunks[0];
  if (firstUrgent) {
    const t = taskById.get(firstUrgent.taskId)!;
    const kept = changes.some((ch) => ch.kind === 'keep' && ch.taskId === t.id);
    summary.push(`${short(t.title)} ${kept ? 'gardé' : 'placé'} ${fmtRange(firstUrgent.start, firstUrgent.end)}.`);
  }
  const toList = changes.filter((c) => c.kind === 'to_list');
  const later = outcomes.filter((o) => o.outcome === 'later');
  if (toList.length) summary.push(`${toList.slice(0, 2).map((c) => short(c.title)).join(' et ')} remis dans la liste.`);
  else if (later.length) summary.push(`${later.slice(0, 2).map((o) => short(o.title)).join(' et ')} ${later.length > 1 ? 'passent' : 'passe'} à plus tard.`);
  if (summary.length < 3) {
    const lastEnd = todayChunks.length ? todayChunks[todayChunks.length - 1].end : start;
    const bed = atLocal(today, prefs.sleep.bed, tz);
    if (lastEnd < bed && lastEnd.hour >= 12) summary.push(`${lastEnd.hour >= 18 ? 'Soirée' : 'Temps'} disponible à partir de ${fmtTime(lastEnd)}.`);
    else if (!todayChunks.length) summary.push(energyLow ? 'Rien d’urgent ne tient : repos protégé.' : 'Rien d’urgent à placer : temps libre.');
  }

  return {
    now, chunks, changes, outcomes, warnings: dedupeWarnings(warnings), tradeoffs,
    capacity: { freeTodayMin: freeToday, activeTodayMin, neededTodayMin: neededToday, shortfallMin: shortfall },
    summary: summary.slice(0, 3), nextAction, busy,
    currentBlock: current && current.kind !== 'planned' ? { id: current.id, title: current.private ? 'Temps privé' : current.title, start: DateTime.fromISO(current.start).setZone(tz), end: endOf(current) } : undefined,
  };
}

function short(title: string): string {
  return title.length > 40 ? title.slice(0, 38) + '…' : title;
}
function dedupeWarnings(ws: Warning[]): Warning[] {
  const seen = new Set<string>();
  return ws.filter((w) => (seen.has(w.message) ? false : (seen.add(w.message), true)));
}

/** « J'ai N minutes » : une tâche prête qui tient, sinon une étape, sinon repos. */
export function suggestForMinutes(input: EngineInput, minutes: number): NextAction & { reason: string } {
  const r = plan({ ...input, facts: { ...(input.facts ?? {}), minutesLeft: minutes } });
  const first = r.chunks.filter((c) => +c.start < +r.now.plus({ minutes: minutes + 5 })).sort((a, b) => +a.start - +b.start)[0];
  if (first) {
    const t = input.tasks.find((x) => x.id === first.taskId)!;
    const full = remainingMinutes(t) <= first.minutes;
    return { kind: 'task', taskId: t.id, title: first.stepTitle ?? (full ? t.title : t.nextStep ?? t.title), minutes: first.minutes, start: first.start, end: first.end, reason: full ? `Tient entièrement en ${fmtDuration(first.minutes)}.` : `Étape de ${fmtDuration(first.minutes)} sur ${fmtDuration(remainingMinutes(t))} restantes.` };
  }
  // Rien de planifiable : chercher une petite tâche sans date.
  const small = input.tasks.filter((t) => !t.deletedAt && (t.status === 'open' || t.status === 'inbox') && remainingMinutes(t) <= minutes).sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0];
  if (small) return { kind: 'task', taskId: small.id, title: small.nextStep ?? small.title, minutes: remainingMinutes(small), reason: `Petite tâche de la liste qui tient en ${fmtDuration(remainingMinutes(small))}.` };
  return { kind: 'rest', title: 'Repos', minutes, reason: 'Rien d’important ne tient dans ce temps : profite-en.' };
}

/** Créneaux libres d'une journée (alternatives au glisser-déposer) : au plus `max` débuts possibles. */
export function freeSlots(input: EngineInput, date: string, minutes: number, max = 3, ignoreBlockId?: string): { start: DateTime; end: DateTime }[] {
  const tz = input.prefs.tz;
  const r = plan({ ...input, blocks: input.blocks.filter((b) => b.id !== ignoreBlockId), tasks: input.tasks.filter((t) => t.status === 'in_progress'), facts: {} });
  const dayStart = atLocal(date, '00:00', tz);
  const startFrom = dayStart < r.now ? roundUp5(r.now) : dayStart;
  let free: [DateTime, DateTime][] = [[startFrom, dayStart.plus({ days: 1 })]];
  const buf = input.prefs.bufferMin;
  for (const b of r.busy) free = subtract(free, b.start.minus({ minutes: b.bufferable ? buf : 0 }), b.end.plus({ minutes: b.bufferable ? buf : 0 }));
  for (const b of input.blocks) {
    if (b.kind !== 'planned' || b.deletedAt || b.status === 'cancelled' || b.id === ignoreBlockId) continue;
    free = subtract(free, DateTime.fromISO(b.start).setZone(tz), DateTime.fromISO(b.end).setZone(tz).plus({ minutes: buf }));
  }
  const out: { start: DateTime; end: DateTime }[] = [];
  for (const [a, b] of free) {
    if (minutesBetween(a, b) >= minutes) out.push({ start: a, end: a.plus({ minutes }) });
    if (out.length >= max) break;
  }
  return out;
}
