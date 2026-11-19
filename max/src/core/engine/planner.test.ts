import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { plan, suggestForMinutes, findCycles, wouldCreateCycle, type EngineInput } from './planner';
import { defaultPrefs, makeBlock, makeDeadline, makeTask, makeRecurrence } from '../factory';
import { expandRecurrence } from '../recurrence';
import { atLocal, iso, resolveLocal } from '../time';
import type { Block } from '../types';

const TZ = 'Europe/Paris';
const at = (d: string, t: string) => atLocal(d, t, TZ);
const T0 = '2026-11-01T10:00:00+01:00';

function base(now: DateTime, extra: Partial<EngineInput> = {}): EngineInput {
  return { now, prefs: defaultPrefs(T0), blocks: [], tasks: [], deadlines: [], ...extra };
}

/** Transforme un plan en blocs acceptés (comme le ferait « Appliquer »). */
function accept(r: ReturnType<typeof plan>, blocks: Block[]): Block[] {
  const kept = blocks.filter((b) => b.kind !== 'planned');
  return [
    ...kept,
    ...r.chunks.map((c, i) => makeBlock(T0, { id: c.keptBlockId ?? `p${i}-${c.taskId}`, title: 'plan', start: iso(c.start), end: iso(c.end), kind: 'planned', protection: c.pinned ? 'locked' : 'flexible', taskId: c.taskId, stepTitle: c.stepTitle, plannedMin: c.minutes })),
  ];
}

describe('scénario 1 : contrôle demain, heure inconnue', () => {
  const now = at('2026-11-18', '15:00');
  const exam = makeDeadline(T0, { id: 'elec', title: "Rattrapage d'électricité", date: '2026-11-19', kind: 'rattrapage', dateConfirmed: true });
  const verify = makeTask(T0, { id: 'verif', title: "Vérifier l'heure du rattrapage d'électricité", deadlineId: 'elec', estimateMin: 5, unblocks: true, estimateSource: 'user' });
  const prep = makeTask(T0, { id: 'prep', title: 'Réviser la loi des mailles', deadlineId: 'elec', estimateMin: 60, nextStep: 'Refaire sans le corrigé le premier exercice', kind: 'prep' });
  const r = plan(base(now, { deadlines: [exam], tasks: [prep, verify] }));

  it('planifie la préparation avant le jour J et met la vérification en premier', () => {
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.chunks[0].taskId).toBe('verif');
    for (const c of r.chunks) expect(+c.end).toBeLessThanOrEqual(+at('2026-11-19', '00:00'));
    expect(r.outcomes.find((o) => o.taskId === 'prep')?.outcome).toBe('today');
  });
  it("signale l'heure incertaine sans créer de faux créneau de contrôle", () => {
    expect(r.warnings.some((w) => w.kind === 'uncertain_time')).toBe(true);
    expect(r.busy.some((b) => b.label.includes('Rattrapage'))).toBe(false);
  });
  it('donne une prochaine action concrète', () => {
    expect(r.nextAction.kind).toBe('task');
    expect(r.nextAction.taskId).toBe('verif');
  });
});

describe('scénario 2 : le TP déborde jusqu’à 17 h', () => {
  const now = at('2026-11-18', '16:30');
  const tp = makeBlock(T0, { id: 'tp', title: 'TP électricité', start: iso(at('2026-11-18', '14:00')), end: iso(at('2026-11-18', '16:00')), category: 'tp' });
  const boxe = makeBlock(T0, { id: 'boxe', title: 'Boxe', start: iso(at('2026-11-18', '18:30')), end: iso(at('2026-11-18', '20:00')), category: 'sport' });
  const exam = makeDeadline(T0, { id: 'ctrl', title: 'Contrôle maths', date: '2026-11-19', time: '10:00' });
  const rev = makeTask(T0, { id: 'rev', title: 'Révision maths', deadlineId: 'ctrl', estimateMin: 40 });
  const montage = makeTask(T0, { id: 'montage', title: 'Montage vidéo CORTEX', estimateMin: 60, priority: 1 });
  const before = { blocks: [tp, boxe], tasks: [rev, montage], deadlines: [exam] };
  const r1 = plan(base(at('2026-11-18', '13:00'), before));
  const accepted = accept(r1, before.blocks);
  const r = plan(base(now, { ...before, blocks: accepted, facts: { overrun: { blockId: 'tp', until: '17:00' } } }));

  it('recale à partir de la fin réelle du TP, garde la boxe et la révision', () => {
    expect(r.changes.find((c) => c.kind === 'block_extend')?.to?.end.toFormat('HH:mm')).toBe('17:00');
    const revChunks = r.chunks.filter((c) => c.taskId === 'rev');
    expect(revChunks.reduce((s, c) => s + c.minutes, 0)).toBe(40);
    for (const c of r.chunks) {
      expect(+c.start).toBeGreaterThanOrEqual(+at('2026-11-18', '17:10'));
      const overlapsBoxe = c.start < at('2026-11-18', '20:10') && c.end > at('2026-11-18', '18:20');
      expect(overlapsBoxe).toBe(false);
    }
    expect(r.summary.length).toBeGreaterThan(0);
    expect(r.summary.length).toBeLessThanOrEqual(3);
  });
  it('le montage décalé reste une tâche ouverte (aucune suppression)', () => {
    const o = r.outcomes.find((x) => x.taskId === 'montage');
    expect(o).toBeTruthy();
    expect(['today', 'later', 'split', 'unplanned']).toContain(o!.outcome);
  });
  it('retirer le montage d’aujourd’hui le remet dans la liste', () => {
    const r2 = plan(base(now, { ...before, blocks: accepted, facts: { overrun: { blockId: 'tp', until: '17:00' }, removeTaskIds: ['montage'] } }));
    const todayM = r2.chunks.filter((c) => c.taskId === 'montage' && c.start.toISODate() === '2026-11-18');
    expect(todayM.length).toBe(0);
  });
});

describe('scénario 3 : 25 min pour deux tâches de 45 min', () => {
  const now = at('2026-11-18', '17:05');
  const trajet = makeBlock(T0, { id: 'trajet', title: 'Trajet Corte → Bastia', start: iso(at('2026-11-18', '17:40')), end: iso(at('2026-11-18', '18:55')), category: 'trajet' });
  const soiree = makeBlock(T0, { id: 'soiree', title: 'Soirée privée', start: iso(at('2026-11-18', '19:00')), end: iso(at('2026-11-18', '22:00')), category: 'prive', kind: 'protected', private: true });
  const exam = makeDeadline(T0, { id: 'ctrl', title: 'Contrôle électricité', date: '2026-11-19', time: '08:00' });
  const a = makeTask(T0, { id: 'a', title: 'Exercices loi des mailles', deadlineId: 'ctrl', estimateMin: 45, nextStep: 'Refaire sans le corrigé le premier exercice', continuous: true });
  const b = makeTask(T0, { id: 'b', title: 'Fiche théorèmes', deadlineId: 'ctrl', estimateMin: 45, continuous: true });
  const matin = makeBlock(T0, { id: 'matin', title: 'Trajet retour vers Corte', start: iso(at('2026-11-19', '06:00')), end: iso(at('2026-11-19', '07:50')), category: 'trajet' });
  const r = plan(base(now, { blocks: [trajet, soiree, matin], tasks: [a, b], deadlines: [exam] }));

  it('montre le manque et propose une étape qui tient', () => {
    expect(r.capacity.shortfallMin).toBeGreaterThan(0);
    const step = r.chunks.find((c) => c.stepTitle);
    expect(step).toBeTruthy();
    expect(step!.minutes).toBeLessThanOrEqual(25);
    expect(r.tradeoffs.length).toBeGreaterThan(0);
  });
  it('la soirée verrouillée reste entière', () => {
    for (const c of r.chunks) expect(c.end <= at('2026-11-18', '19:00') || c.start >= at('2026-11-18', '22:00')).toBe(true);
  });
});

describe('stabilité', () => {
  it('relancer le calcul sans nouveau fait ne redistribue pas les blocs', () => {
    const now = at('2026-11-18', '09:00');
    const exam = makeDeadline(T0, { id: 'e', title: 'Contrôle', date: '2026-11-20', time: '10:00' });
    const tasks = [
      makeTask(T0, { id: 't1', title: 'Révision 1', deadlineId: 'e', estimateMin: 120 }),
      makeTask(T0, { id: 't2', title: 'Rendu R1.11', dueDate: '2026-11-21', estimateMin: 90 }),
      makeTask(T0, { id: 't3', title: 'Vidéo', priority: 1, estimateMin: 45 }),
    ];
    const cours = makeBlock(T0, { id: 'c', title: 'Cours', start: iso(at('2026-11-18', '10:00')), end: iso(at('2026-11-18', '12:00')), category: 'cours' });
    const r1 = plan(base(now, { tasks, deadlines: [exam], blocks: [cours] }));
    const blocks = accept(r1, [cours]);
    const r2 = plan(base(now.plus({ minutes: 1 }), { tasks, deadlines: [exam], blocks }));
    expect(r2.changes.filter((c) => c.kind !== 'keep')).toEqual([]);
    const r3 = plan(base(now.plus({ minutes: 1 }), { tasks, deadlines: [exam], blocks }));
    expect(r3.chunks.map((c) => iso(c.start))).toEqual(r2.chunks.map((c) => iso(c.start)));
  });
});

describe('épingle et compromis', () => {
  it('épingler un montage qui raccourcit la préparation montre le compromis', () => {
    const now = at('2026-11-18', '20:00');
    const exam = makeDeadline(T0, { id: 'e', title: 'Contrôle', date: '2026-11-19', time: '07:00' });
    const prep = makeTask(T0, { id: 'p', title: 'Préparation contrôle', deadlineId: 'e', estimateMin: 90, continuous: true });
    const montage = makeTask(T0, { id: 'm', title: 'Montage', estimateMin: 90 });
    const r = plan(base(now, { tasks: [prep, montage], deadlines: [exam], facts: { pins: [{ taskId: 'm', start: '20:00', minutes: 90 }] } }));
    expect(r.tradeoffs[0]?.message).toMatch(/Montage/);
    expect(r.tradeoffs[0]?.options.length).toBe(2);
  });
});

describe("j'ai 30 minutes", () => {
  it('propose une tâche qui tient, sinon une étape, sinon du repos', () => {
    const now = at('2026-11-18', '14:00');
    const small = makeTask(T0, { id: 's', title: 'Répondre aux questions de préparation R1.11', dueDate: '2026-11-25', estimateMin: 25 });
    const s = suggestForMinutes(base(now, { tasks: [small] }), 30);
    expect(s.taskId).toBe('s');
    const empty = suggestForMinutes(base(now), 30);
    expect(empty.kind).toBe('rest');
  });
});

describe('énergie basse', () => {
  it('raccourcit les séances et allège la journée', () => {
    const now = at('2026-11-18', '09:00');
    const t = makeTask(T0, { id: 't', title: 'Gros rendu', dueDate: '2026-11-25', estimateMin: 240 });
    const r = plan(base(now, { tasks: [t], facts: { energy: 'basse' } }));
    const today = r.chunks.filter((c) => c.start.toISODate() === '2026-11-18');
    expect(today.every((c) => c.minutes <= 30)).toBe(true);
    expect(today.reduce((s, c) => s + c.minutes, 0)).toBeLessThanOrEqual(90);
  });
});

describe('conflits et dépendances', () => {
  it('signale deux rendez-vous fixes incompatibles sans les déplacer', () => {
    const now = at('2026-11-18', '08:00');
    const a = makeBlock(T0, { id: 'a', title: 'Dentiste', start: iso(at('2026-11-18', '14:00')), end: iso(at('2026-11-18', '15:00')), category: 'rdv' });
    const b = makeBlock(T0, { id: 'b', title: 'TP', start: iso(at('2026-11-18', '14:30')), end: iso(at('2026-11-18', '16:30')), category: 'tp' });
    const r = plan(base(now, { blocks: [a, b] }));
    expect(r.warnings.filter((w) => w.kind === 'conflict').length).toBe(1);
    expect(r.changes.length).toBe(0);
  });
  it('détecte et refuse les dépendances circulaires', () => {
    const t1 = makeTask(T0, { id: '1', title: 'A', dependsOn: ['2'] });
    const t2 = makeTask(T0, { id: '2', title: 'B', dependsOn: ['1'] });
    expect([...findCycles([t1, t2])].sort()).toEqual(['1', '2']);
    const t3 = makeTask(T0, { id: '3', title: 'C', dependsOn: [] });
    const t4 = makeTask(T0, { id: '4', title: 'D', dependsOn: ['3'] });
    expect(wouldCreateCycle([t3, t4], '3', '4')).toBe(true);
    expect(wouldCreateCycle([t3, t4], '4', '3')).toBe(false);
  });
  it('place une tâche après celle qui la débloque', () => {
    const now = at('2026-11-18', '09:00');
    const ask = makeTask(T0, { id: 'ask', title: 'Demander le sujet', estimateMin: 10, priority: 1 });
    const write = makeTask(T0, { id: 'write', title: "Rédiger l'introduction", estimateMin: 60, priority: 2, dependsOn: ['ask'] });
    const r = plan(base(now, { tasks: [write, ask] }));
    const a = r.chunks.find((c) => c.taskId === 'ask')!;
    const w = r.chunks.find((c) => c.taskId === 'write')!;
    expect(+w.start).toBeGreaterThanOrEqual(+a.end);
  });
});

describe('heures locales et changement d’heure', () => {
  it('un cours récurrent garde 8 h locale de part et d’autre du passage à l’heure d’hiver', () => {
    const rec = makeRecurrence(T0, { id: 'r', title: 'Cours maths', weekdays: [5, 1], startTime: '08:00', endTime: '10:00', from: '2026-10-19' });
    const occ = expandRecurrence(rec, '2026-10-23', '2026-10-26');
    expect(occ.map((o) => DateTime.fromISO(o.start).setZone(TZ).toFormat('yyyy-MM-dd HH:mm'))).toEqual(['2026-10-23 08:00', '2026-10-26 08:00']);
    expect(occ[0].start).toContain('+02:00');
    expect(occ[1].start).toContain('+01:00');
  });
  it('une occurrence déplacée garde son exception', () => {
    const rec = makeRecurrence(T0, { id: 'r', title: 'Cours', weekdays: [1], startTime: '08:00', endTime: '10:00', from: '2026-11-01', exceptions: [{ date: '2026-11-16', action: 'move', start: '14:00', end: '16:00' }, { date: '2026-11-23', action: 'skip' }] });
    const occ = expandRecurrence(rec, '2026-11-09', '2026-11-30');
    expect(occ.map((o) => DateTime.fromISO(o.start).setZone(TZ).toFormat('MM-dd HH:mm'))).toEqual(['11-09 08:00', '11-16 14:00', '11-30 08:00']);
  });
  it('détecte une heure ambiguë (2 h 30 le 25/10/2026) et une heure inexistante (2 h 30 le 29/03/2026)', () => {
    expect(resolveLocal('2026-10-25', '02:30', TZ).ambiguous).toBe(true);
    expect(resolveLocal('2026-03-29', '02:30', TZ).gap).toBe(true);
    expect(resolveLocal('2026-11-19', '14:00', TZ).ambiguous).toBe(false);
  });
  it('gère un sommeil qui passe minuit et un week-end', () => {
    const now = at('2026-11-21', '23:30'); // samedi soir
    const prefs = { ...defaultPrefs(T0), sleep: { bed: '00:30', wake: '07:30', protect: true, confirmed: true } };
    const t = makeTask(T0, { id: 't', title: 'Lire', priority: 1, estimateMin: 20 });
    const r = plan({ now, prefs, blocks: [], tasks: [t], deadlines: [] });
    const c = r.chunks[0];
    expect(c.start.toFormat('HH:mm')).toBe('23:30');
    expect(+c.end).toBeLessThanOrEqual(+at('2026-11-22', '00:30'));
  });
});

describe('créneaux manqués', () => {
  it('un créneau passé non fait est marqué manqué et la tâche est replacée', () => {
    const now = at('2026-11-21', '10:00');
    const t = makeTask(T0, { id: 't', title: 'Révision', dueDate: '2026-11-25', estimateMin: 30 });
    const old = makeBlock(T0, { id: 'old', title: 'Révision', kind: 'planned', protection: 'flexible', taskId: 't', start: iso(at('2026-11-18', '17:00')), end: iso(at('2026-11-18', '17:30')) });
    const r = plan(base(now, { tasks: [t], blocks: [old] }));
    expect(r.changes.some((c) => c.kind === 'missed' && c.blockId === 'old')).toBe(true);
    expect(r.chunks.some((c) => c.taskId === 't' && c.start >= now)).toBe(true);
  });
});
