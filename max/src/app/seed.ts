// Reprise de contexte facultative : propositions sourcées, à confirmer une par une.
// Rien n'est écrit dans l'espace réel tant que Johan ne coche pas. Aucune donnée sensible
// (adresse, téléphone, finances détaillées, noms de proches, santé) n'est incluse.
import type { Area, Deadline, Project, StoreName, Task } from '../core/types';
import { makeArea, makeBlock, makeDeadline, makeProject, makeRecurrence, makeTask, makeVideo } from '../core/factory';
import { addDays, atLocal, iso } from '../core/time';

export interface Proposal {
  id: string;
  domain: string;
  label: string;
  proposedStatus: string;
  provenance: string;
  toConfirm: string[];
  writes: { store: StoreName; next: any }[];
  defaultChecked: boolean;
}

const SRC = 'export Max / mémoire, photographie du 18/11/2026';

export function contextProposals(nowIso: string): Proposal[] {
  const o = { origin: 'seed' as const, source: SRC };
  const area = (id: string, name: string, status: Area['status'], extra: Partial<Area> = {}) => makeArea(nowIso, { id, name, status, ...o, ...extra });
  const proj = (id: string, p: Partial<Project> & { name: string }) => makeProject(nowIso, { id, ...o, ...p });
  const task = (id: string, p: Partial<Task> & { title: string }) => makeTask(nowIso, { id, ...o, ...p });
  const dl = (id: string, p: Partial<Deadline> & { title: string; date: string }) => makeDeadline(nowIso, { id, ...o, ...p });
  const note = (text: string, date = '2026-11-18') => ({ id: 'n-' + text.length + date, date, text, source: SRC });

  const P: Proposal[] = [];
  const add = (p: Omit<Proposal, 'defaultChecked'> & { defaultChecked?: boolean }) => P.push({ defaultChecked: true, ...p });

  add({
    id: 'etudes', domain: 'Études', label: 'BUT MT2E à Corte (1re année) · matières Maths et Électricité', proposedStatus: 'actif', provenance: SRC,
    toConfirm: ['Retard d’environ deux mois à évaluer matière par matière'],
    writes: [
      { store: 'areas', next: area('seed-area-etudes', 'Études', 'active') },
      { store: 'projects', next: proj('seed-subj-maths', { name: 'Maths', kind: 'subject', areaId: 'seed-area-etudes' }) },
      { store: 'projects', next: proj('seed-subj-elec', { name: 'Électricité', kind: 'subject', areaId: 'seed-area-etudes' }) },
      { store: 'tasks', next: task('seed-t-retard', { title: 'Évaluer le retard matière par matière', areaId: 'seed-area-etudes', estimateMin: 30, priority: 1, nextStep: 'Lister les chapitres vus depuis la rentrée pour une matière' }) },
    ],
  });
  add({
    id: 'elec-rattrapage', domain: 'Études', label: 'Rattrapage d’électricité le 19/11/2026', proposedStatus: 'annoncé · heure inconnue', provenance: SRC,
    toConfirm: ['Heure du rattrapage (inconnue)', 'Est-il toujours prévu aujourd’hui ?'],
    writes: [
      { store: 'deadlines', next: dl('seed-dl-elec', { title: "Rattrapage d'électricité", date: '2026-11-19', kind: 'rattrapage', subjectId: 'seed-subj-elec', status: 'announced', dateConfirmed: false }) },
      { store: 'tasks', next: task('seed-t-elec-heure', { title: "Vérifier l'heure du rattrapage d'électricité", deadlineId: 'seed-dl-elec', projectId: 'seed-subj-elec', estimateMin: 5, unblocks: true, kind: 'admin' }) },
      { store: 'tasks', next: task('seed-t-elec-mailles', { title: 'Refaire sans le corrigé le premier exercice de loi des mailles', deadlineId: 'seed-dl-elec', projectId: 'seed-subj-elec', estimateMin: 15, kind: 'prep', learnState: 'a_pratiquer' }) },
    ],
  });
  add({
    id: 'maths-rattrapage', domain: 'Études', label: 'Rattrapage de maths du 16/11/2026', proposedStatus: 'passé · résultat à renseigner', provenance: SRC,
    toConfirm: ['Résultat inconnu'],
    writes: [
      { store: 'deadlines', next: dl('seed-dl-maths', { title: 'Rattrapage de maths', date: '2026-11-16', kind: 'rattrapage', subjectId: 'seed-subj-maths', status: 'to_fill' }) },
      { store: 'tasks', next: task('seed-t-maths-res', { title: 'Renseigner le résultat du rattrapage de maths', deadlineId: 'seed-dl-maths', projectId: 'seed-subj-maths', estimateMin: 5, kind: 'admin' }) },
    ],
  });
  add({
    id: 'r111', domain: 'Études', label: 'Rendu R1.11 : prochaines étapes', proposedStatus: 'actif', provenance: SRC, toConfirm: ['Date de rendu inconnue'],
    writes: [
      { store: 'projects', next: proj('seed-p-r111', { name: 'Rendu R1.11', areaId: 'seed-area-etudes', nextAction: 'Répondre aux questions de préparation' }) },
      { store: 'tasks', next: task('seed-t-r111-a', { title: 'Répondre aux questions de préparation (R1.11)', projectId: 'seed-p-r111', estimateMin: 45 }) },
      { store: 'tasks', next: task('seed-t-r111-b', { title: "Rédiger l'introduction (R1.11)", projectId: 'seed-p-r111', estimateMin: 60, dependsOn: ['seed-t-r111-a'] }) },
    ],
  });
  add({
    id: 'ast', domain: 'Études', label: 'Concours AST et grande école (objectif de fond)', proposedStatus: 'actif, sans date', provenance: SRC, toConfirm: [],
    writes: [{ store: 'projects', next: proj('seed-p-ast', { name: 'Concours AST / grande école', areaId: 'seed-area-etudes', notes: [note('Objectif de fond, pas d’échéance connue.')] }) }],
  });
  add({
    id: 'carriere', domain: 'Carrière', label: 'Stage de 3–4 semaines en mai 2027 (piste Baldassari) et alternance S2 2027', proposedStatus: 'piste', provenance: SRC,
    toConfirm: ['Piste Baldassari à confirmer', 'Aucune date limite de candidature connue'],
    writes: [
      { store: 'areas', next: area('seed-area-carriere', 'Carrière', 'active') },
      { store: 'projects', next: proj('seed-p-stage', { name: 'Stage mai 2027 — Baldassari', kind: 'application', areaId: 'seed-area-carriere', company: 'Baldassari', applicationStatus: 'piste', notes: [note('Préférence : ne pas présenter le bureau d’études comme objectif.'), note('Une note de mémoire ne vaut pas candidature envoyée.')] }) },
      { store: 'projects', next: proj('seed-p-alt', { name: 'Alternance second semestre 2027', kind: 'application', areaId: 'seed-area-carriere', applicationStatus: 'piste' }) },
      { store: 'tasks', next: task('seed-t-stage-duree', { title: 'Vérifier si le stage de mai accepte une durée de 3 à 4 semaines', projectId: 'seed-p-stage', estimateMin: 15, priority: 1 }) },
    ],
  });
  add({
    id: 'asclepium', domain: 'Asclepium', label: 'Vidéos « Loi N », livre et boutique Shopify', proposedStatus: 'à confirmer', provenance: SRC,
    toConfirm: ['Date cible du 01/12/2026 : toujours d’actualité ?', 'Ancien objectif de 50 € de CA en décembre', 'Budget business 45–60 min certains jours', 'Promotion ≈ 30 €/mois', 'Formats et cadences en cours'],
    writes: [
      { store: 'areas', next: area('seed-area-asclepium', 'Asclepium', 'to_confirm', { dailyBudgetMin: 60 }) },
      { store: 'projects', next: proj('seed-p-loin', { name: 'Vidéos Loi N', kind: 'brand', areaId: 'seed-area-asclepium', status: 'to_confirm', notes: [note('Public : étudiants en santé.')] }) },
      { store: 'projects', next: proj('seed-p-livre', { name: 'Livre Asclepium', kind: 'book', areaId: 'seed-area-asclepium', status: 'to_confirm' }) },
      { store: 'projects', next: proj('seed-p-shop', { name: 'Boutique Shopify Asclepium', kind: 'shop', areaId: 'seed-area-asclepium', status: 'to_confirm', targetDate: '2026-12-01', targetConfirmed: false, notes: [note('Ancien objectif : 50 € de chiffre d’affaires en décembre (à confirmer).')] }) },
      { store: 'deadlines', next: dl('seed-dl-shop', { title: 'Lancement boutique Asclepium (date cible)', date: '2026-12-01', kind: 'business', projectId: 'seed-p-shop', importance: 'normale', status: 'to_confirm', dateConfirmed: false }) },
      { store: 'tasks', next: task('seed-t-shop-page', { title: 'Vérifier si la page de vente s’ouvre', projectId: 'seed-p-shop', areaId: 'seed-area-asclepium', estimateMin: 10, deadlineId: 'seed-dl-shop' }) },
      { store: 'tasks', next: task('seed-t-shop-fichier', { title: 'Tester la réception du fichier en environnement de test', projectId: 'seed-p-shop', areaId: 'seed-area-asclepium', estimateMin: 20, deadlineId: 'seed-dl-shop' }) },
    ],
  });
  add({
    id: 'cortex', domain: 'CORTEX', label: 'Guide de l’étudiant (vidéos courtes, idée de livre) · TikTok, YouTube', proposedStatus: 'à confirmer', provenance: SRC,
    toConfirm: ['Direction actuelle : « guide de l’étudiant »'],
    writes: [
      { store: 'areas', next: area('seed-area-cortex', 'CORTEX', 'to_confirm') },
      { store: 'projects', next: proj('seed-p-cortex', { name: 'CORTEX — guide de l’étudiant', kind: 'brand', areaId: 'seed-area-cortex', status: 'to_confirm', notes: [note('Ancienne direction « teste ton cerveau » : historique.'), note('Préférence : tests créatifs ciblés, attention au temps et aux crédits de production.')] }) },
    ],
  });
  add({
    id: 'lupu', domain: 'U Lupu Corsu', label: 'Compte @u.lupu.corsu, univers de dessin animé', proposedStatus: 'à confirmer', provenance: SRC,
    toConfirm: ['T-shirts et autres plateformes : pistes non validées', 'Vidéos déjà rendues ou programmées : à indiquer'],
    writes: [
      { store: 'areas', next: area('seed-area-lupu', 'U Lupu Corsu', 'to_confirm') },
      { store: 'projects', next: proj('seed-p-lupu', { name: 'U Lupu Corsu (@u.lupu.corsu)', kind: 'brand', areaId: 'seed-area-lupu', status: 'to_confirm', notes: [note('Pistes non validées : t-shirts, autres plateformes.')] }) },
    ],
  });
  add({
    id: 'perso', domain: 'Vie personnelle', label: 'Sommeil, boxe, muscu, trajets Corte–Bastia, proches, foi, repos', proposedStatus: 'actif', provenance: SRC,
    toConfirm: ['Repère de sommeil ≈ 22 h–6 h (déjà réglé dans les préférences, à vérifier)'],
    writes: [{ store: 'areas', next: area('seed-area-perso', 'Vie personnelle', 'active') }],
  });
  add({
    id: 'pause', domain: 'Projets en pause', label: 'Fruit TV, Cynox Fitness, Lifforge, apprentissage du corse', proposedStatus: 'en pause', provenance: SRC + ' (traces parfois anciennes)', toConfirm: ['Lequel est actif ?'], defaultChecked: false,
    writes: ['Fruit TV', 'Cynox Fitness', 'Lifforge', 'Apprendre le corse'].map((n) => ({ store: 'areas' as const, next: area('seed-area-' + n.toLowerCase().replace(/\W+/g, '-'), n, 'paused') })),
  });
  add({
    id: 'pass', domain: 'Historique', label: 'PASS : examen du 14/12, révisions médecine, pistes à l’étranger', proposedStatus: 'historique (réactivable)', provenance: SRC, toConfirm: [], defaultChecked: false,
    writes: [
      { store: 'areas', next: area('seed-area-pass', 'PASS / médecine (historique)', 'history') },
      { store: 'deadlines', next: dl('seed-dl-pass', { title: 'Examen PASS (historique)', date: '2026-12-14', kind: 'controle', status: 'history', importance: 'normale' }) },
    ],
  });
  return P;
}

/** Données de démonstration : espace séparé, horloge réelle, aucune donnée personnelle. */
export function demoWrites(nowIso: string, today: string, tz: string): { store: StoreName; next: any }[] {
  const at = (d: string, t: string) => iso(atLocal(d, t, tz));
  const o = { origin: 'seed' as const, source: 'démonstration' };
  const tomorrow = addDays(today, 1);
  return [
    { store: 'areas', next: makeArea(nowIso, { id: 'd-a1', name: 'Études (démo)', ...o }) },
    { store: 'projects', next: makeProject(nowIso, { id: 'd-p1', name: 'Physique (démo)', kind: 'subject', areaId: 'd-a1', ...o }) },
    { store: 'deadlines', next: makeDeadline(nowIso, { id: 'd-d1', title: 'Contrôle de physique (démo)', date: tomorrow, subjectId: 'd-p1', ...o }) },
    { store: 'tasks', next: makeTask(nowIso, { id: 'd-t1', title: 'Réviser les circuits RC', deadlineId: 'd-d1', projectId: 'd-p1', estimateMin: 60, nextStep: 'Refaire l’exercice 1 sans le corrigé', ...o }) },
    { store: 'tasks', next: makeTask(nowIso, { id: 'd-t2', title: "Vérifier l'heure du contrôle", deadlineId: 'd-d1', estimateMin: 5, unblocks: true, ...o }) },
    { store: 'tasks', next: makeTask(nowIso, { id: 'd-t3', title: 'Monter la vidéo (démo)', priority: 1, estimateMin: 60, ...o }) },
    { store: 'blocks', next: makeBlock(nowIso, { id: 'd-b1', title: 'TP (démo)', start: at(today, '14:00'), end: at(today, '16:00'), category: 'tp', ...o }) },
    { store: 'blocks', next: makeBlock(nowIso, { id: 'd-b2', title: 'Boxe (démo)', start: at(today, '18:30'), end: at(today, '20:00'), category: 'sport', ...o }) },
    { store: 'recurrences', next: makeRecurrence(nowIso, { id: 'd-r1', title: 'Cours magistral (démo)', weekdays: [1, 3, 5], startTime: '08:00', endTime: '10:00', from: addDays(today, -14), ...o }) },
    { store: 'videos', next: makeVideo(nowIso, { id: 'd-v1', title: 'Vidéo test (démo)', workState: 'pret', platforms: { youtube: { state: 'publie', date: today }, tiktok: { state: 'programme', date: tomorrow } }, nextStep: 'Publier sur Instagram', ...o }) },
  ];
}
