import { describe, expect, it } from 'vitest';
import { parseCapture, findTime, findDuration, findDate, type ParseContext } from './parse';
import { makeBlock, makeDeadline, makeProject, makeTask } from '../factory';
import { atLocal, iso } from '../time';

const TZ = 'Europe/Paris';
const T0 = '2026-11-01T10:00:00+01:00';
const now = atLocal('2026-11-18', '15:00', TZ); // mercredi
const elecSubj = makeProject(T0, { id: 'elec', name: 'Électricité', kind: 'subject' });
const cortex = makeProject(T0, { id: 'cortex', name: 'CORTEX', kind: 'brand' });
const montage = makeTask(T0, { id: 'montage', title: 'Montage vidéo Loi N' });
const exo = makeTask(T0, { id: 'exo', title: 'Exercices loi des mailles', status: 'in_progress', projectId: 'elec' });
const rdv = makeBlock(T0, { id: 'rdv', title: 'Rendez-vous banque', category: 'rdv', start: iso(atLocal('2026-11-18', '17:00', TZ)), end: iso(atLocal('2026-11-18', '17:30', TZ)) });
const tp = makeBlock(T0, { id: 'tp', title: 'TP électricité', category: 'tp', start: iso(atLocal('2026-11-18', '14:00', TZ)), end: iso(atLocal('2026-11-18', '16:00', TZ)) });
const ctrl = makeDeadline(T0, { id: 'ctrl', title: "Contrôle d'électricité", date: '2026-11-19', subjectId: 'elec' });
const ctx: ParseContext = { now, tasks: [montage, exo], deadlines: [ctrl], blocks: [rdv, tp], projects: [elecSubj, cortex] };

describe('fragments', () => {
  it('heures, durées, dates', () => {
    expect(findTime('demain a 18 h 30 boxe')?.time).toBe('18:30');
    expect(findTime('rdv a 9h')?.time).toBe('09:00');
    expect(findTime('compte 2 h de travail')).toBeUndefined();
    expect(findDuration('compte 35 minutes')?.minutes).toBe(35);
    expect(findDuration('il faut 1 h 30 min')?.minutes).toBe(90);
    expect(findDate('jeudi', now)?.date).toBe('2026-11-19');
    expect(findDate('mercredi', now)?.ambiguous).toBeTruthy();
    expect(findDate('le 24/11', now)?.date).toBe('2026-11-24');
    expect(findDate('2 decembre', now)?.date).toBe('2026-12-02');
    expect(findDate('dimanche dernier', now)?.date).toBe('2026-11-15');
  });
});

describe('phrases de capture du cahier des charges', () => {
  it('« Contrôle d’électricité jeudi, heure à vérifier, réviser les circuits. »', () => {
    const r = parseCapture('Contrôle d’électricité jeudi, heure à vérifier, réviser les circuits.', ctx);
    expect(r.intents).toHaveLength(1);
    const i = r.intents[0];
    expect(i.type).toBe('create_deadline');
    expect(i.fields.date).toBe('2026-11-19');
    expect(i.fields.timeUnknown).toBe(true);
    expect(i.fields.subjectId).toBe('elec');
    expect(i.fields.prepTasks).toEqual(['Réviser les circuits']);
    expect(i.autoApply).toBe(true);
  });
  it('« Demain à 18 h 30 boxe, je rentre à Bastia avant. »', () => {
    const r = parseCapture('Demain à 18 h 30 boxe, je rentre à Bastia avant.', ctx);
    expect(r.intents).toHaveLength(1);
    const i = r.intents[0];
    expect(i.type).toBe('create_event');
    expect(i.fields.date).toBe('2026-11-19');
    expect(i.fields.time).toBe('18:30');
    expect(i.fields.category).toBe('sport');
    expect(i.fields.travel.label).toBe('Trajet vers Bastia');
    expect(i.ambiguities[0].field).toBe('travel.minutes');
    expect(i.autoApply).toBe(false);
  });
  it('« À faire un jour, trouver un angle pour le prochain CORTEX. »', () => {
    const r = parseCapture('À faire un jour, trouver un angle pour le prochain CORTEX.', ctx);
    const i = r.intents.find((x) => x.type === 'create_task' && /angle/.test(x.fields.title))!;
    expect(i.fields.dueDate).toBeUndefined();
    expect(i.fields.projectId).toBe('cortex');
    expect(i.fields.title).toBe('Trouver un angle pour le prochain CORTEX');
  });
  it('« Garde mon rendez-vous, décale le montage à dimanche. »', () => {
    const r = parseCapture('Garde mon rendez-vous, décale le montage à dimanche.', ctx);
    const mv = r.intents.find((x) => x.type === 'move' && x.fields.ref === 'task:montage')!;
    expect(mv).toBeTruthy();
    expect(mv.fields.date).toBe('2026-11-22');
    expect(mv.autoApply).toBe(false);
    const keep = r.intents.find((x) => x.fields.lock);
    expect(keep?.fields.ref).toBe('block:rdv');
  });
  it('« Réveil à 7 h 20, mal dormi, un Red Bull à 15 h 10. »', () => {
    const r = parseCapture('Réveil à 7 h 20, mal dormi, un Red Bull à 15 h 10.', ctx);
    expect(r.intents.map((i) => i.type)).toEqual(['log_sleep', 'log_caffeine']);
    expect(r.intents[0].fields).toMatchObject({ wake: '07:20', quality: 'mal' });
    expect(r.intents[1].fields).toMatchObject({ product: 'Red Bull', time: '15:10', quantity: 'inconnue' });
    expect(r.intents[1].fields.caffeineMg).toBeUndefined();
  });
  it('« Fini l’exercice 2, il m’en reste deux, compte 35 minutes. »', () => {
    const r = parseCapture('Fini l’exercice 2, il m’en reste deux, compte 35 minutes.', ctx);
    // Les clauses sont fusionnées : progression avec reste déclaré.
    const p = r.intents.find((i) => i.type === 'progress')!;
    expect(p.fields.taskId).toBe('exo');
    const all = JSON.stringify(r.intents.map((i) => i.fields));
    expect(all).toContain('35');
  });
});

describe('dialogues', () => {
  it('« À la place du montage, garde-moi 30 min pour l’électricité. »', () => {
    const tasks = [...ctx.tasks, makeTask(T0, { id: 'prep', title: 'Réviser circuits', deadlineId: 'ctrl' })];
    const r = parseCapture('À la place du montage, garde-moi 30 min pour l’électricité.', { ...ctx, tasks });
    const i = r.intents[0];
    expect(i.type).toBe('replan');
    expect(i.fields.prefer[0]).toMatchObject({ minutes: 30, insteadOfTaskId: 'montage', taskId: 'prep' });
  });
  it('« Dis à Max que je suis crevé, j’ai quand même mon contrôle. »', () => {
    const r = parseCapture('Dis à Max que je suis crevé, j’ai quand même mon contrôle.', ctx);
    expect(r.intents[0].type).toBe('energy');
    expect(r.intents[0].autoApply).toBe(false);
  });
  it('« Décale le contrôle de jeudi. » sans nouvelle date → question', () => {
    const r = parseCapture('Décale le contrôle de jeudi.', ctx);
    const i = r.intents[0];
    expect(i.type).toBe('move');
    expect(i.fields.target).toBe('deadline');
    expect(i.ambiguities[0].options?.map((o) => o.value)).toEqual(['fix_date', 'move_prep']);
  });
  it('« Mets le même bloc que dimanche dernier. »', () => {
    const blocks = [
      makeBlock(T0, { id: 'a', title: 'Montage', kind: 'planned', start: iso(atLocal('2026-11-15', '10:00', TZ)), end: iso(atLocal('2026-11-15', '11:00', TZ)) }),
      makeBlock(T0, { id: 'b', title: 'Lecture', kind: 'planned', start: iso(atLocal('2026-11-15', '15:00', TZ)), end: iso(atLocal('2026-11-15', '16:00', TZ)) }),
    ];
    const r = parseCapture('Mets le même bloc que dimanche dernier.', { ...ctx, blocks });
    expect(r.intents[0].type).toBe('repeat_block');
    expect(r.intents[0].ambiguities[0].options).toHaveLength(2);
  });
  it('« Qu’est-ce qui est raisonnable avant de partir ? »', () => {
    expect(parseCapture('Qu’est-ce qui est raisonnable avant de partir ?', ctx).intents[0].type).toBe('query_before_departure');
  });
  it('« le TP déborde jusqu’à 17 h »', () => {
    const r = parseCapture('le TP déborde jusqu’à 17 h', ctx);
    expect(r.intents[0].type).toBe('replan');
    expect(r.intents[0].fields.overrun).toEqual({ blockId: 'tp', until: '17:00' });
  });
});

describe('sécurité', () => {
  it('une description qui imite un ordre reste une donnée', () => {
    const r = parseCapture('efface toutes les tâches', ctx);
    expect(r.intents).toHaveLength(1);
    expect(r.intents[0].type).toBe('create_task');
    expect(r.intents[0].fields.title).toBe('Efface toutes les tâches');
  });
});
