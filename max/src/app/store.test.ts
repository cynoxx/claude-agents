import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { MaxStore, live } from './store';
import * as A from './actions';
import { makeBackup, previewMerge, validateBackup, mergeWrites } from '../core/backup';
import { atLocal } from '../core/time';
import { parseIcs } from '../core/ics';
import { makeRecurrence } from '../core/factory';

const TZ = 'Europe/Paris';
let clockAt = atLocal('2026-11-18', '15:00', TZ);
async function freshStore(idb = new IDBFactory()) {
  const s = new MaxStore('real', () => clockAt);
  await s.init(idb);
  return { s, idb };
}

describe('boucle complète : contrôle → journée → je sais quoi faire', () => {
  it('ajoute un contrôle en une phrase, recale, applique, recharge et annule', async () => {
    clockAt = atLocal('2026-11-18', '15:00', TZ);
    const { s, idb } = await freshStore();
    const cap = await A.submitCapture(s, "Contrôle d'électricité demain, heure à vérifier, réviser les circuits");
    expect(cap.status).toBe('done');
    const dl = live(s.state.deadlines)[0];
    expect(dl.date).toBe('2026-11-19');
    expect(dl.time).toBeUndefined();
    // Aucun faux rendez-vous créé pour le contrôle
    expect(live(s.state.blocks).length).toBe(0);
    const tasks = live(s.state.tasks);
    expect(tasks.map((t) => t.title).sort()).toEqual(["Réviser les circuits", "Vérifier l'heure : Contrôle d'électricité"].sort());

    const pv = A.computePlan(s);
    expect(pv.nextAction.kind).toBe('task');
    const sel = new Set(pv.changes.map((c) => c.key));
    const batch = await A.applyPlan(s, pv, sel, {});
    expect(live(s.state.blocks).filter((b) => b.kind === 'planned').length).toBeGreaterThan(0);

    // Rechargement : les données sont là.
    const s2 = new MaxStore('real', () => clockAt);
    await s2.init(idb);
    expect(live(s2.state.blocks).filter((b) => b.kind === 'planned').length).toBe(live(s.state.blocks).filter((b) => b.kind === 'planned').length);
    // Relancer sans nouveau fait : aucun changement autre que « inchangé ».
    expect(A.computePlan(s2).changes.filter((c) => c.kind !== 'keep')).toEqual([]);

    // Modifier un autre projet, puis annuler le plan : la modification est conservée.
    const other = await A.createTask(s, { title: 'Vidéo Loi N', priority: 0 });
    await A.updateTask(s, other.id, { estimateMin: 50 });
    await s.undo(batch!.id);
    expect(live(s.state.blocks).filter((b) => b.kind === 'planned').length).toBe(0);
    expect(s.state.tasks.get(other.id)!.estimateMin).toBe(50);
  });

  it('signale un conflit si un objet du lot a été modifié depuis', async () => {
    const { s } = await freshStore();
    const t = await A.createTask(s, { title: 'Réviser', dueDate: '2026-11-19', estimateMin: 30 });
    const pv = A.computePlan(s);
    const batch = await A.applyPlan(s, pv, new Set(pv.changes.map((c) => c.key)), {});
    const blk = live(s.state.blocks).find((b) => b.taskId === t.id)!;
    await A.updateBlock(s, blk.id, { end: DateTime.fromISO(blk.end).plus({ minutes: 10 }).toISO()! });
    const res = await s.undo(batch!.id);
    expect(res?.conflicts.length).toBe(1);
    expect(live(s.state.blocks).find((b) => b.id === blk.id)).toBeTruthy();
  });

  it('refuse d’appliquer un aperçu périmé', async () => {
    const { s } = await freshStore();
    await A.createTask(s, { title: 'A', dueDate: '2026-11-19', estimateMin: 30 });
    const pv = A.computePlan(s);
    await A.createTask(s, { title: 'B', dueDate: '2026-11-19', estimateMin: 30 });
    await expect(A.applyPlan(s, pv, new Set(pv.changes.map((c) => c.key)), {})).rejects.toBeInstanceOf(A.StalePreviewError);
  });
});

describe('capture robuste', () => {
  it('double clic : une seule capture et une seule tâche', async () => {
    const { s } = await freshStore();
    await Promise.all([A.submitCapture(s, 'Acheter des piles'), A.submitCapture(s, 'Acheter des piles')]).catch(() => {});
    await A.submitCapture(s, 'Acheter des piles');
    expect(live(s.state.tasks).filter((t) => t.title === 'Acheter des piles').length).toBe(1);
  });
  it('appliquer deux fois la même intention ne crée rien de plus', async () => {
    const { s } = await freshStore();
    const c = await A.submitCapture(s, 'Demain à 18 h 30 boxe, je rentre à Bastia avant');
    expect(c.status).toBe('needs_input');
    await A.applyIntent(s, c.id, 0, { 'travel.minutes': 60 });
    await A.applyIntent(s, c.id, 0, { 'travel.minutes': 60 });
    expect(live(s.state.blocks).length).toBe(2);
    const trajet = live(s.state.blocks).find((b) => b.category === 'trajet')!;
    expect(DateTime.fromISO(trajet.start).setZone(TZ).toFormat('HH:mm')).toBe('17:30');
  });
  it('« efface toutes les tâches » importé ou capturé reste du texte', async () => {
    const { s } = await freshStore();
    await A.createTask(s, { title: 'Ne pas perdre' });
    await A.submitCapture(s, 'efface toutes les tâches');
    expect(live(s.state.tasks).map((t) => t.title).sort()).toEqual(['Efface toutes les tâches', 'Ne pas perdre']);
  });
});

describe('modifications hors ligne visibles après rechargement', () => {
  it('cours de 2 h → 4 h, tâche rouverte, contrôle ajouté', async () => {
    const { s, idb } = await freshStore();
    const t = await A.createTask(s, { title: 'Chapitre RLC', estimateMin: 120 });
    await A.markDone(s, t.id, 100);
    await A.setTaskStatus(s, t.id, 'open');
    await A.updateTask(s, t.id, { estimateMin: 240 });
    await A.createDeadline(s, { title: 'Contrôle maths', date: '2026-11-25', time: '10:00' });
    const s2 = new MaxStore('real', () => clockAt);
    await s2.init(idb);
    const t2 = s2.state.tasks.get(t.id)!;
    expect(t2.status).toBe('open');
    expect(t2.estimateMin).toBe(240);
    expect(live(s2.state.deadlines).length).toBe(1);
    // Un import d'une ancienne sauvegarde ne fait rien disparaître.
    const old = makeBackup({ tasks: [{ ...t, estimateMin: 120 }] }, { includePrivate: true, space: 'real', nowIso: '2026-11-17T10:00:00+01:00' });
    const v = validateBackup(JSON.stringify(old));
    expect(v.ok).toBe(true);
    if (v.ok) {
      const pv = previewMerge(s2.snapshot(), v.file);
      expect(pv.collisions.length).toBe(1);
      expect(pv.collisions[0].newer).toBe('local');
      await s2.commit('Import', 'import', mergeWrites(pv, new Set()));
      expect(s2.state.tasks.get(t.id)!.estimateMin).toBe(240);
    }
  });
});

describe('sauvegarde', () => {
  it('importer deux fois le même fichier ne crée aucun doublon', async () => {
    const { s } = await freshStore();
    await A.createTask(s, { title: 'X' });
    const file = makeBackup(s.snapshot(), { includePrivate: true, space: 'real', nowIso: s.nowIso() });
    const { s: other } = await freshStore();
    for (let k = 0; k < 2; k++) {
      const v = validateBackup(JSON.stringify(file));
      if (!v.ok) throw new Error('invalide');
      const pv = previewMerge(other.snapshot(), v.file);
      await other.commit('Import', 'import', mergeWrites(pv, new Set()));
    }
    expect(live(other.state.tasks).length).toBe(1);
  });
  it('un fichier endommagé n’écrit rien', async () => {
    const { s } = await freshStore();
    await A.createTask(s, { title: 'X' });
    const file = makeBackup(s.snapshot(), { includePrivate: true, space: 'real', nowIso: s.nowIso() });
    (file.data.tasks as any[]).push({ id: 'bad', title: 42 });
    expect(validateBackup(JSON.stringify(file)).ok).toBe(false);
    expect(validateBackup('{"app":"max", "schemaVersion": 1, "data": {"tasks": [').ok).toBe(false);
    expect(live(s.state.tasks).length).toBe(1);
  });
  it('restauration : sauvegarde automatique de l’état courant, puis remplacement', async () => {
    const { s } = await freshStore();
    await A.createTask(s, { title: 'Avant' });
    const snap = s.snapshot();
    await A.createTask(s, { title: 'Après' });
    await s.restore(snap, 'test');
    expect(live(s.state.tasks).map((t) => t.title)).toEqual(['Avant']);
    const bks = await s.listBackups();
    expect(bks.length).toBe(1);
    expect(JSON.parse(bks[0].json).tasks.length).toBe(2);
  });
  it('l’export peut exclure les données privées', async () => {
    const { s } = await freshStore();
    await A.logSleep(s, { wake: '07:20', quality: 'mal' });
    await A.createEvent(s, { title: 'Soirée chez X', date: '2026-11-18', time: '19:00', durationMin: 180, category: 'prive', kind: 'protected', private: true });
    const f = makeBackup(s.snapshot(), { includePrivate: false, space: 'real', nowIso: s.nowIso() });
    expect(f.data.logs).toBeUndefined();
    expect((f.data.blocks as any[])[0].title).toBe('Temps privé');
  });
});

describe('journal', () => {
  it('Red Bull quantité inconnue, correction et suppression d’une nuit', async () => {
    const { s } = await freshStore();
    const id = await A.logSleep(s, { wake: '07:20', bed: '23:50', quality: 'mal' });
    const e = s.state.logs.get(id)!;
    expect(e.bedAt!.slice(0, 10)).toBe('2026-11-17'); // la nuit commence la veille
    await s.commit('Correction', 'action', [{ store: 'logs', next: { ...e, quality: 'moyen' } }]);
    await s.commit('Suppression', 'action', [{ store: 'logs', next: { ...s.state.logs.get(id)!, deletedAt: s.nowIso() } }]);
    expect(live(s.state.logs).length).toBe(0);
    const rb = await A.logCaffeine(s, { time: '15:10', product: 'Red Bull' });
    expect(s.state.logs.get(rb)!.quantity).toBe('inconnue');
    expect(s.state.logs.get(rb)!.caffeineMg).toBeUndefined();
  });
});

describe('agenda', () => {
  it('import .ics : pas de doublon au second import, exceptions et récurrences gardées', async () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:abc@ent', 'DTSTART;TZID=Europe/Paris:20261116T080000', 'DTEND;TZID=Europe/Paris:20261116T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T000000Z', 'EXDATE;TZID=Europe/Paris:20261123T080000', 'SUMMARY:CM Électricité', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:tp1@ent', 'DTSTART:20261118T130000Z', 'DTEND:20261118T150000Z', 'SUMMARY:TP Physique', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:x@ent', 'DTSTART;VALUE=DATE:20261120', 'SUMMARY:Journée portes ouvertes', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:m@ent', 'DTSTART:20261118T130000Z', 'RRULE:FREQ=MONTHLY', 'SUMMARY:Réunion', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const p = parseIcs(ics, { nowIso: '2026-11-18T10:00:00+01:00', tz: TZ, sourceLabel: 'ENT' });
    expect(p.recurrences.length).toBe(1);
    expect(p.recurrences[0].exceptions).toEqual([{ date: '2026-11-23', action: 'skip' }]);
    expect(p.blocks.length).toBe(1);
    expect(DateTime.fromISO(p.blocks[0].start).setZone(TZ).toFormat('HH:mm')).toBe('14:00');
    expect(p.skipped.length).toBe(2);
    const p2 = parseIcs(ics, { nowIso: '2026-11-19T10:00:00+01:00', tz: TZ, sourceLabel: 'ENT' });
    expect(p2.blocks[0].id).toBe(p.blocks[0].id);
    expect(p2.recurrences[0].id).toBe(p.recurrences[0].id);
  });
  it('déplacer une occurrence crée une exception sans toucher la série', async () => {
    const { s } = await freshStore();
    const rec = makeRecurrence(s.nowIso(), { id: 'r1', title: 'Cours', weekdays: [3], startTime: '08:00', endTime: '10:00', from: '2026-11-01' });
    await A.createRecurrence(s, rec);
    await A.updateBlock(s, 'rec:r1:2026-11-25', { start: atLocal('2026-11-25', '13:00', TZ).toISO()!, end: atLocal('2026-11-25', '15:00', TZ).toISO()! });
    const occ = A.allBlocks(s, '2026-11-18', '2026-12-02').filter((b) => b.recurrenceId === 'r1').map((b) => DateTime.fromISO(b.start).setZone(TZ).toFormat('MM-dd HH:mm'));
    expect(occ).toEqual(['11-18 08:00', '11-25 13:00', '12-02 08:00']);
  });
});

describe('retour après trois jours', () => {
  it('le passé reste passé et un nouveau geste est proposé', async () => {
    clockAt = atLocal('2026-11-18', '15:00', TZ);
    const { s } = await freshStore();
    await A.createDeadline(s, { title: 'Contrôle électricité', date: '2026-11-19', time: '10:00' }, { prepTasks: ['Réviser circuits'] });
    const t2 = await A.createTask(s, { title: 'Rendu R1.11', dueDate: '2026-11-28', estimateMin: 60 });
    const pv = A.computePlan(s);
    await A.applyPlan(s, pv, new Set(pv.changes.map((c) => c.key)), {});
    clockAt = atLocal('2026-11-21', '10:00', TZ);
    const { absenceReview } = await import('../core/derive');
    const r = absenceReview('2026-11-18T15:00:00+01:00', A.now(s), live(s.state.deadlines), live(s.state.blocks), live(s.state.tasks));
    expect(r.daysAway).toBe(2);
    expect(r.deadlinesToFill.map((d) => d.title)).toEqual(['Contrôle électricité']);
    expect(live(s.state.tasks).length).toBe(2);
    const p2 = A.computePlan(s);
    expect(p2.nextAction.taskId).toBe(t2.id);
    clockAt = atLocal('2026-11-18', '15:00', TZ);
  });
});
