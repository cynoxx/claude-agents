// Interprétation locale et déterministe des phrases de capture.
// Grammaire d'intentions versionnée : voir docs/grammaire-intentions.md.
// Le texte reste une donnée : aucune phrase ne peut déclencher autre chose que les intentions listées.
import { DateTime } from 'luxon';
import type { Ambiguity, Block, Deadline, Intent, ParseResult, Project, Task } from '../types';
import { addDays, localDate } from '../time';

export const GRAMMAR_VERSION = '1.0';

export interface ParseContext {
  now: DateTime;
  tasks: Task[];
  deadlines: Deadline[];
  blocks: Block[];
  projects: Project[];
}

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const NUMBERS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30, quarante: 40, 'quarante-cinq': 45, soixante: 60 };

export interface DateHit { date: string; text: string; ambiguous?: { options: { label: string; value: string }[] } ; relative?: 'last' }
/** Repère une date dans un fragment normalisé. */
export function findDate(n: string, now: DateTime): DateHit | undefined {
  const today = localDate(now);
  let m: RegExpExecArray | null;
  if ((m = /\b(apres-demain|apres demain)\b/.exec(n))) return { date: addDays(today, 2), text: m[0] };
  if ((m = /\bdemain\b/.exec(n))) return { date: addDays(today, 1), text: m[0] };
  if ((m = /\b(aujourd'hui|ce soir|ce matin|cet apres-midi|cet aprem|tout a l'heure)\b/.exec(n))) return { date: today, text: m[0] };
  if ((m = /\bhier\b/.exec(n))) return { date: addDays(today, -1), text: m[0] };
  if ((m = /\b(?:le )?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(n))) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : now.year;
    if (y < 100) y += 2000;
    let dt = DateTime.fromObject({ year: y, month: mo, day: d }, { zone: now.zone });
    if (!m[3] && dt < now.startOf('day').minus({ days: 60 })) dt = dt.plus({ years: 1 });
    if (dt.isValid) return { date: dt.toISODate()!, text: m[0] };
  }
  if ((m = new RegExp(`\\b(?:le )?(\\d{1,2})(?:er)? (${MONTHS.join('|')})(?: (\\d{4}))?\\b`).exec(n))) {
    const d = +m[1], mo = MONTHS.indexOf(m[2]) + 1;
    let dt = DateTime.fromObject({ year: m[3] ? +m[3] : now.year, month: mo, day: d }, { zone: now.zone });
    if (!m[3] && dt < now.startOf('day').minus({ days: 60 })) dt = dt.plus({ years: 1 });
    if (dt.isValid) return { date: dt.toISODate()!, text: m[0] };
  }
  if ((m = new RegExp(`\\b(${WEEKDAYS.join('|')})( prochain| dernier)?\\b`).exec(n))) {
    const wd = WEEKDAYS.indexOf(m[1]) + 1;
    if (m[2]?.trim() === 'dernier') {
      let delta = now.weekday - wd;
      if (delta <= 0) delta += 7;
      return { date: addDays(today, -delta), text: m[0], relative: 'last' };
    }
    let delta = (wd - now.weekday + 7) % 7;
    if (m[2]?.trim() === 'prochain') delta = delta === 0 ? 7 : delta;
    const hit: DateHit = { date: addDays(today, delta), text: m[0] };
    if (delta === 0 && !m[2]) {
      hit.ambiguous = { options: [{ label: "Aujourd'hui", value: today }, { label: `${m[1]} prochain`, value: addDays(today, 7) }] };
    }
    return hit;
  }
  return undefined;
}

export interface TimeHit { time: string; text: string }
/** Repère une heure : « 18 h 30 », « 18h », « à midi ». Ignore les durées (« 2 h de travail » sans « à »). */
export function findTime(n: string, opts: { requireAt?: boolean } = {}): TimeHit | undefined {
  let m: RegExpExecArray | null;
  if ((m = /\b(?:a |vers |jusqu'a |avant |des )?midi\b/.exec(n))) return { time: '12:00', text: m[0] };
  if ((m = /\b(?:a |vers |jusqu'a |avant |des )?minuit\b/.exec(n))) return { time: '00:00', text: m[0] };
  const re = /(\b(?:a|vers|jusqu'a|avant|des|de|levee?|reveil|couche|couchee?)\s+)?\b(\d{1,2})\s?(?:h|:)\s?(\d{2})?\b(?!\s?(?:min|minutes))/g;
  while ((m = re.exec(n))) {
    const h = +m[2], mi = m[3] ? +m[3] : 0;
    if (h > 23 || mi > 59) continue;
    const after = n.slice(m.index + m[0].length, m.index + m[0].length + 12);
    // « 2 h de travail », « compte 1 h » : c'est une durée.
    if (!m[1] && (/^\s?(de |d'|pour |restant|en tout)/.test(after) || /(compte|reste|pendant|durant|environ|en)\s*$/.test(n.slice(0, m.index)))) continue;
    if (opts.requireAt && !m[1]) continue;
    return { time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, text: m[0] };
  }
  return undefined;
}

/** Repère une durée : « 35 minutes », « 30 min », « 1 h 30 », « compte 2 h ». */
export function findDuration(n: string): { minutes: number; text: string } | undefined {
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{1,3})\s?(?:min|minutes|mn)\b/.exec(n))) {
    // « 1 h 30 min » ?
    const before = /(\d{1,2})\s?h\s?$/.exec(n.slice(0, m.index));
    if (before) return { minutes: +before[1] * 60 + +m[1], text: before[0] + m[0] };
    return { minutes: +m[1], text: m[0] };
  }
  if ((m = new RegExp(`\\b(${Object.keys(NUMBERS).join('|')})\\s(?:min|minutes)\\b`).exec(n))) return { minutes: NUMBERS[m[1]], text: m[0] };
  if ((m = /\b(compte|reste|pendant|durant|environ|en|prevoir|prevois|garde-moi|garde moi)\s(\d{1,2})\s?h\s?(\d{2})?\b/.exec(n))) return { minutes: +m[2] * 60 + (m[3] ? +m[3] : 0), text: m[0] };
  if ((m = /\b(\d{1,2})\s?h\s?(\d{2})?\s(de |d')/.exec(n))) return { minutes: +m[1] * 60 + (m[2] ? +m[2] : 0), text: m[0] };
  if ((m = /\b(une|1) heure\b/.exec(n))) return { minutes: 60, text: m[0] };
  if ((m = /\b(une|1) demi-heure\b/.exec(n))) return { minutes: 30, text: m[0] };
  return undefined;
}

const EXAM_RE = /\b(controle|partiel|examen|exam|ds|interro|interrogation|rattrapage|tp note|rendu|oral|soutenance|devoir surveille)\b/;
const EVENT_WORDS: [RegExp, string][] = [
  [/\b(boxe|muscu|musculation|sport|footing|course a pied|foot|seance de sport)\b/, 'sport'],
  [/\b(rdv|rendez-vous|rendez vous|dentiste|medecin|kine|banque|prefecture)\b/, 'rdv'],
  [/\b(cours|amphi|td)\b/, 'cours'],
  [/\b(tp)\b/, 'tp'],
  [/\b(famille|parents|proches|repas de famille)\b/, 'famille'],
  [/\b(messe|eglise|priere|temps spirituel)\b/, 'spirituel'],
  [/\b(trajet|train|bus|navette)\b/, 'trajet'],
  [/\b(temps perso|soiree libre|repos)\b/, 'perso'],
];
const VERB_RE = /^(reviser|refaire|faire|revoir|preparer|apprendre|relire|travailler|finir|terminer|rediger|lire|ficher|s'entrainer|entrainer|tester|verifier|appeler|envoyer|contacter|relancer|trouver|acheter|payer|regler|monter|ecrire|chercher)\b/;

function cap(s: string): string {
  const t = s.trim().replace(/^[,.;:\s]+|[,.;:\s]+$/g, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Retire de l'original les fragments repérés sur le texte normalisé (positions identiques hors accents). */
function stripFragments(original: string, normalized: string, fragments: string[]): string {
  // Les deux chaînes ont des longueurs proches mais l'original peut contenir des accents composés :
  // on travaille sur une version de l'original normalisée caractère par caractère.
  const chars = [...original];
  const mapped = chars.map((c) => norm(c) || c);
  let mask = new Array(chars.length).fill(true);
  const joined = mapped.join('');
  for (const f of fragments) {
    if (!f) continue;
    const i = joined.indexOf(f);
    if (i < 0) continue;
    // Retrouver les index de caractères couvrant [i, i+f.length)
    let pos = 0;
    for (let k = 0; k < mapped.length; k++) {
      const len = mapped[k].length;
      if (pos + len > i && pos < i + f.length) mask[k] = false;
      pos += len;
    }
  }
  void normalized;
  return chars.filter((_, k) => mask[k]).join('').replace(/\s+/g, ' ').trim();
}


/** Retrouve dans le texte original le fragment correspondant à un fragment normalisé (accents conservés). */
export function originalOf(raw: string, fragment: string): string {
  if (!fragment) return fragment;
  const chars = [...raw];
  const mapped = chars.map((c) => (c === ' ' ? ' ' : norm(c) || c));
  const joined = mapped.join('');
  const i = joined.indexOf(fragment);
  if (i < 0) return fragment;
  let pos = 0;
  let out = '';
  for (let k = 0; k < mapped.length; k++) {
    const len = mapped[k].length;
    if (pos >= i && pos < i + fragment.length) out += chars[k];
    pos += len;
  }
  return out || fragment;
}

function matchProject(n: string, projects: Project[]): Project | undefined {
  let best: Project | undefined;
  for (const p of projects) {
    if (p.deletedAt) continue;
    const pn = norm(p.name);
    const words = pn.split(/[^a-z0-9.]+/).filter((w) => w.length >= 4 || /\d/.test(w));
    if (n.includes(pn) || words.some((w) => new RegExp(`\\b${w.replace('.', '\\.')}\\b`).test(n))) {
      if (!best || pn.length > norm(best.name).length) best = p;
    }
  }
  return best;
}

const STOP = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'mon', 'ma', 'mes', 'a', 'au', 'aux', 'pour', 'et', 'en', 'sur', 'avec', 'd', 'l', 'que', 'qui', 'je', 'me', 'moi', 'garde', 'decale', 'deplace', 'mets', 'reporte', 'fini', 'termine', 'il', 'reste', 'en', 'm']);
function keywords(n: string): string[] {
  return n.split(/[^a-z0-9.]+/).filter((w) => (w.length > 2 || ['tp', 'td', 'ds'].includes(w)) && !STOP.has(w));
}
/** Cherche les tâches dont le titre partage le plus de mots-clés. */
export function matchTasks(n: string, tasks: Task[], filter: (t: Task) => boolean = (t) => t.status !== 'done' && t.status !== 'archived' && t.status !== 'cancelled'): Task[] {
  const kws = keywords(n);
  if (!kws.length) return [];
  const scored = tasks
    .filter((t) => !t.deletedAt && filter(t))
    .map((t) => {
      const tn = norm(t.title + ' ' + (t.nextStep ?? '') + ' ' + t.steps.map((s) => s.title).join(' '));
      const score = kws.filter((k) => tn.includes(k) || (k.length > 5 && tn.includes(k.slice(0, -1)))).length;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.t.updatedAt.localeCompare(a.t.updatedAt));
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((x) => x.score === top).map((x) => x.t);
}
function matchBlocks(n: string, blocks: Block[], date?: string): Block[] {
  const kws = keywords(n);
  return blocks
    .filter((b) => !b.deletedAt && b.status !== 'cancelled' && (!date || b.start.slice(0, 10) === date))
    .map((b) => ({ b, score: kws.filter((k) => norm(b.title + ' ' + b.category).includes(k)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.b);
}

function splitClauses(text: string): string[] {
  const parts = text
    .split(/(?<=[.;!?])\s+|,\s*|\s+puis\s+/)
    .map((s) => s.trim().replace(/[.;!?]+$/, ''))
    .filter(Boolean);
  // « À la place du montage, garde-moi… » : la proposition introductive appartient à la suivante.
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (/^(a la place|au lieu)\b/.test(norm(parts[i])) && i + 1 < parts.length) {
      out.push(parts[i] + ', ' + parts[i + 1]);
      i++;
    } else out.push(parts[i]);
  }
  return out;
}

export function parseCapture(text: string, ctx: ParseContext): ParseResult {
  const now = ctx.now;
  const intents: Intent[] = [];
  const clauses = splitClauses(text.replace(/^(dis a max que|dis à max que|max,?)\s*/i, ''));
  let last: Intent | undefined;

  for (const raw of clauses) {
    const n = norm(raw);
    // ----- Modificateurs du dernier élément -----
    if (last && /\b(heure (a verifier|inconnue|a confirmer|pas encore connue))\b/.test(n)) {
      if (last.type === 'create_deadline' || last.type === 'create_event') { last.fields.timeUnknown = true; delete last.fields.time; last.text += ', ' + raw; continue; }
    }
    if (last?.type === 'create_deadline' && VERB_RE.test(n)) {
      last.fields.prepTasks = [...(last.fields.prepTasks ?? []), cap(raw)];
      last.text += ', ' + raw;
      last.label = deadlineLabel(last.fields);
      continue;
    }
    if (last?.type === 'log_sleep' && /\b(mal|bien|moyen|pas assez|peu) dormi\b|\bnuit (courte|blanche|difficile)\b/.test(n)) {
      last.fields.quality = /bien/.test(n) ? 'bien' : /moyen/.test(n) ? 'moyen' : 'mal';
      last.text += ', ' + raw;
      last.label = sleepLabel(last.fields);
      continue;
    }
    if (last?.type === 'create_event' && /\b(je (rentre|vais|pars|passe|monte|descends?)|trajet|avant de|j'y vais)\b/.test(n) && /\b(avant|bastia|corte|ajaccio|chez|maison)\b/.test(n)) {
      const place = /\b(?:a|vers|sur) ([a-z-]+)\b/.exec(n)?.[1];
      last.fields.travel = { label: `Trajet${place ? ' vers ' + cap(place) : ''}`, minutes: findDuration(n)?.minutes };
      if (!last.fields.travel.minutes) {
        last.ambiguities.push({ field: 'travel.minutes', question: `Durée du trajet${place ? ' vers ' + cap(place) : ''} ?`, options: [{ label: '45 min', value: 45 }, { label: '1 h', value: 60 }, { label: '1 h 30', value: 90 }, { label: 'Je ne sais pas (marge 2 h)', value: 120 }] });
        last.autoApply = false;
      }
      last.text += ', ' + raw;
      continue;
    }

    const intent = parseClause(raw, n, ctx, now);
    intents.push(intent);
    last = intent;
  }

  // « Garde mon rendez-vous » + déplacement : la garde est une précision du déplacement.
  return { grammarVersion: GRAMMAR_VERSION, intents, parsedAt: now.toISO()!, by: 'local' };
}

function deadlineLabel(f: Record<string, any>): string {
  const prep = f.prepTasks?.length ? ` + ${f.prepTasks.length} tâche${f.prepTasks.length > 1 ? 's' : ''} de préparation` : '';
  return `Échéance : ${f.title} — ${f.date}${f.time ? ' ' + f.time : ', heure à confirmer'}${prep}`;
}
function sleepLabel(f: Record<string, any>): string {
  return `Journal sommeil : ${f.wake ? 'réveil ' + f.wake : ''}${f.bed ? ' coucher ' + f.bed : ''}${f.quality ? ', ' + (f.quality === 'mal' ? 'mal dormi' : f.quality === 'bien' ? 'bien dormi' : 'nuit moyenne') : ''}`;
}

function parseClause(raw: string, n: string, ctx: ParseContext, now: DateTime): Intent {
  const today = localDate(now);
  const base = (type: Intent['type'], fields: Record<string, any>, label: string, autoApply: boolean, ambiguities: Ambiguity[] = []): Intent => ({ type, text: raw, fields, ambiguities, autoApply, label });

  // ----- Sommeil -----
  if (/\b(reveil|reveille|leve|levee|debout|couche|couchee|endormi|dormi)\b/.test(n) && !EXAM_RE.test(n)) {
    const fields: Record<string, any> = {};
    const wake = /\b(?:reveil(?:le)?|leve(?:e)?|debout)\s(?:a\s|vers\s)?(\d{1,2})\s?h\s?(\d{2})?/.exec(n);
    const bed = /\b(?:couche(?:e)?|endormi)\s(?:a\s|vers\s)?(\d{1,2})\s?h\s?(\d{2})?/.exec(n);
    if (wake) fields.wake = `${wake[1].padStart(2, '0')}:${wake[2] ?? '00'}`;
    if (bed) fields.bed = `${bed[1].padStart(2, '0')}:${bed[2] ?? '00'}`;
    if (/\b(mal|pas assez|peu) dormi\b/.test(n)) fields.quality = 'mal';
    else if (/\bbien dormi\b/.test(n)) fields.quality = 'bien';
    const dh = findDate(n, now);
    fields.date = dh?.date ?? today;
    if (fields.wake || fields.bed || fields.quality) return base('log_sleep', fields, sleepLabel(fields), true);
  }
  // ----- Caféine -----
  const caf = /\b(red ?bull|cafe|expresso|espresso|monster|energy drink|boisson energisante|the)\b/.exec(n);
  if (caf && !/\b(acheter|payer)\b/.test(n)) {
    const t = findTime(n);
    const qty = /\b(\d{2,3})\s?(cl|ml)\b/.exec(n);
    const mg = /\b(\d{2,3})\s?mg\b/.exec(n);
    const product = /red ?bull/.test(caf[1]) ? 'Red Bull' : caf[1] === 'the' ? 'Thé' : cap(caf[1]);
    const fields = { product, time: t?.time ?? now.toFormat('HH:mm'), date: findDate(n, now)?.date ?? today, quantity: qty ? `${qty[1]} ${qty[2]}` : 'inconnue', caffeineMg: mg ? +mg[1] : undefined };
    return base('log_caffeine', fields, `Journal caféine : ${product} à ${fields.time} (quantité ${fields.quantity})`, true);
  }
  // ----- Énergie -----
  if (/\b(crev[ee]|fatigu[ee]e?|epuis[ee]e?|peu d'energie|pas d'energie|a plat|vide|naze|ko)\b/.test(n)) {
    return base('energy', { level: 'basse', keepDeadlines: /\b(quand meme|controle|exam|rendu)\b/.test(n) }, 'Énergie basse : proposer une journée plus légère', false);
  }
  // ----- Avant de partir -----
  if (/\b(raisonnable|faisable|j'ai le temps).*(avant de partir|avant mon depart|avant le depart)\b|\bavant de partir\b.*\?/.test(n) || /^qu'est-ce que je (fais|peux faire)/.test(n)) {
    return base('query_before_departure', {}, 'Question : que faire avant de partir ?', false);
  }
  // ----- J'ai N minutes -----
  const haveMin = /\b(?:j'ai|il me reste|reste|dispo(?:nible)?)\s(?:encore\s)?(\d{1,3})\s?(?:min|minutes)\b/.exec(n);
  if (haveMin && !/\b(fini|termine|exercice)\b/.test(n)) {
    return base('replan', { minutesLeft: +haveMin[1] }, `Il te reste ${haveMin[1]} min : choisir quoi en faire`, false);
  }
  // ----- Débordement / dispo jusqu'à -----
  const overrun = /\b(deborde|finit|termine|dure|se prolonge)\b.*\b(?:jusqu'a|a|vers)\s(\d{1,2})\s?h\s?(\d{2})?/.exec(n);
  if (overrun && !/\b(fini|j'ai fini)\b/.test(n)) {
    const until = `${overrun[2].padStart(2, '0')}:${overrun[3] ?? '00'}`;
    const cands = matchBlocks(n, ctx.blocks, today);
    const amb: Ambiguity[] = [];
    if (cands.length !== 1) amb.push({ field: 'blockId', question: 'Quel bloc déborde ?', options: cands.slice(0, 3).map((b) => ({ label: `${b.title} (${b.start.slice(11, 16)})`, value: b.id })) });
    return base('replan', { overrun: { blockId: cands.length === 1 ? cands[0].id : undefined, until } }, `Recaler : ${cands[0]?.title ?? 'bloc'} jusqu'à ${until}`, false, amb);
  }
  const avail = /\b(dispo|disponible|libre)\b.*\bjusqu'a\s(\d{1,2})\s?h\s?(\d{2})?/.exec(n);
  if (avail) return base('replan', { availableUntil: `${avail[2].padStart(2, '0')}:${avail[3] ?? '00'}` }, `Disponible jusqu'à ${avail[2]} h${avail[3] ?? ''}`, false);
  const cancel = /\b(annule|annulee?|saute|n'a pas lieu|tombe a l'eau)\b/.exec(n);
  if (cancel && !EXAM_RE.test(n)) {
    const cands = matchBlocks(n, ctx.blocks, findDate(n, now)?.date ?? today);
    const amb: Ambiguity[] = cands.length === 1 ? [] : [{ field: 'blockId', question: 'Quel événement est annulé ?', options: cands.slice(0, 3).map((b) => ({ label: `${b.title} (${b.start.slice(11, 16)})`, value: b.id })) }];
    return base('replan', { cancelledBlockIds: cands.length === 1 ? [cands[0].id] : [] }, `Annuler : ${cands[0]?.title ?? '?'}`, false, amb);
  }
  // ----- À la place de X, garde-moi N min pour Y -----
  const instead = /\b(?:a la place d[eu']?|au lieu d[eu']?)\s?(.+?)\s?(?:,|garde|mets|prevois)\s?(?:-?moi)?\s?(.*)$/.exec(n);
  if (instead) {
    const victim = matchTasks(instead[1], ctx.tasks);
    const rest = instead[2];
    const dur = findDuration(rest)?.minutes ?? 30;
    const targetText = rest.replace(/\d+\s?(min|minutes)/, '').replace(/\bpour\b/, '');
    const target = matchTargetTask(targetText, ctx);
    const amb: Ambiguity[] = [];
    if (!target.task) amb.push({ field: 'taskId', question: `Pour quelle tâche garder ${dur} min ?`, options: target.options });
    if (victim.length !== 1) amb.push({ field: 'insteadOfTaskId', question: 'À la place de quelle tâche ?', options: victim.slice(0, 3).map((t) => ({ label: t.title, value: t.id })) });
    return base('replan', { prefer: [{ taskId: target.task?.id, minutes: dur, insteadOfTaskId: victim.length === 1 ? victim[0].id : undefined }] }, `Échanger : ${dur} min pour ${target.task?.title ?? '?'} à la place de ${victim[0]?.title ?? '?'}`, false, amb);
  }
  // ----- Progression -----
  const prog = /\b(fini|termine|j'ai fait|fait|boucle|avance)\b/.exec(n);
  if (prog && !/\ba faire\b/.test(n) && !EXAM_RE.test(n.replace(/exercice/, ''))) {
    const dur = findDuration(n);
    const left = /\b(?:il m'en reste|reste|encore)\s(\w+)\b/.exec(n);
    const stepText = n.slice(prog.index + prog[0].length).split(/\b(il m'en reste|reste|compte)\b/)[0].trim();
    let cands = matchTasks(stepText || n, ctx.tasks);
    if (!cands.length) cands = ctx.tasks.filter((t) => t.status === 'in_progress');
    const amb: Ambiguity[] = [];
    if (cands.length !== 1) {
      const recent = (cands.length ? cands : [...ctx.tasks].filter((t) => t.status === 'open' || t.status === 'in_progress').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))).slice(0, 3);
      amb.push({ field: 'taskId', question: 'Sur quelle tâche ?', options: recent.map((t) => ({ label: t.title, value: t.id })) });
    }
    const fields = { taskId: cands.length === 1 ? cands[0].id : undefined, stepDone: stepText ? cap(stepText) : undefined, remainingMin: dur?.minutes, remainingCount: left ? (NUMBERS[left[1]] ?? +left[1]) || undefined : undefined, finished: !dur && !left };
    return base('progress', fields, `Avancement : ${fields.stepDone ?? 'étape'} faite${dur ? `, reste ${dur.minutes} min` : ''}`, amb.length === 0, amb);
  }
  // ----- Même bloc que … -----
  if (/\b(meme bloc|meme creneau|comme)\b.*\b(dernier|derniere|hier|la semaine derniere)\b/.test(n)) {
    const dh = findDate(n.replace(/meme bloc que /, ''), now);
    const date = dh?.date ?? addDays(today, -7);
    const cands = ctx.blocks.filter((b) => !b.deletedAt && b.start.slice(0, 10) === date && b.category !== 'sommeil');
    const amb: Ambiguity[] = cands.length === 1 ? [] : [{ field: 'blockId', question: cands.length ? 'Lequel de ces blocs ?' : `Aucun bloc trouvé le ${date}. Lequel veux-tu ?`, options: cands.slice(0, 3).map((b) => ({ label: `${b.title} ${b.start.slice(11, 16)}–${b.end.slice(11, 16)}`, value: b.id })) }];
    return base('repeat_block', { sourceDate: date, blockId: cands.length === 1 ? cands[0].id : undefined, targetDate: today }, `Reprendre le bloc du ${date}`, false, amb);
  }
  // ----- Déplacement -----
  const mv = /\b(decale|deplace|reporte|repousse|bouge|mets|passe)\b\s(.+?)\s(?:a|au|pour|en|jusqu'a)\s(.+)$/.exec(n) || /\b(decale|deplace|reporte|repousse)\b\s(.+)$/.exec(n);
  if (mv) {
    const what = mv[2];
    const target = mv[3] ?? '';
    const dh = findDate(target, now) ?? (mv[3] ? undefined : findDate(what, now));
    const th = findTime(target);
    const amb: Ambiguity[] = [];
    // Échéance officielle ?
    if (EXAM_RE.test(what)) {
      const dls = ctx.deadlines.filter((d) => !d.deletedAt && (d.status === 'announced' || d.status === 'to_confirm') && keywords(what).some((k) => norm(d.title).includes(k) || (dh && d.date === dh.date)));
      const d = dls[0];
      if (!mv[3] || !dh) {
        return base('move', { target: 'deadline', deadlineId: d?.id }, `Le contrôle est une échéance officielle`, false, [{ field: 'choice', question: `« ${d?.title ?? 'Ce contrôle'} » est une date officielle. Que veux-tu faire ?`, options: [{ label: 'Corriger la date (nouvelle date connue)', value: 'fix_date' }, { label: 'Déplacer la révision pour faire de la place', value: 'move_prep' }] }]);
      }
      return base('move', { target: 'deadline', deadlineId: d?.id, date: dh.date, time: th?.time }, `Corriger la date de ${d?.title ?? 'l’échéance'} → ${dh.date}`, false, d ? [] : [{ field: 'deadlineId', question: 'Quelle échéance ?', options: dls.slice(0, 3).map((x) => ({ label: x.title, value: x.id })) }]);
    }
    const tasks = matchTasks(what, ctx.tasks);
    const blocks = tasks.length ? [] : matchBlocks(what, ctx.blocks.filter((b) => b.kind !== 'planned'));
    if (!dh && !th) amb.push({ field: 'date', question: 'Vers quand ?', options: [{ label: 'Demain', value: addDays(today, 1) }, { label: 'Ce week-end', value: addDays(today, (6 - now.weekday + 7) % 7 || 7) }, { label: 'Remettre dans la liste', value: 'list' }] });
    if (dh?.ambiguous) amb.push({ field: 'date', question: 'Quel jour exactement ?', options: dh.ambiguous.options });
    if (tasks.length !== 1 && blocks.length !== 1) amb.push({ field: 'ref', question: 'Que faut-il déplacer ?', options: [...tasks.slice(0, 3).map((t) => ({ label: t.title, value: 'task:' + t.id })), ...blocks.slice(0, 3).map((b) => ({ label: `${b.title} (${b.start.slice(5, 10)} ${b.start.slice(11, 16)})`, value: 'block:' + b.id }))].slice(0, 3) });
    const ref = tasks.length === 1 ? 'task:' + tasks[0].id : blocks.length === 1 ? 'block:' + blocks[0].id : undefined;
    const keep = /\bgarde\b/.test(n) ? matchBlocks(n.split(/decale|deplace/)[0], ctx.blocks)[0]?.id : undefined;
    return base('move', { ref, date: dh?.date, time: th?.time, keepBlockId: keep }, `Déplacer ${tasks[0]?.title ?? blocks[0]?.title ?? '?'} → ${dh?.date ?? ''}${th ? ' ' + th.time : ''}`, false, amb);
  }
  if (/^garde (mon|ma|le|la)\b/.test(n)) {
    const b = matchBlocks(n, ctx.blocks)[0];
    return base('move', { ref: b ? 'block:' + b.id : undefined, lock: true }, `Protéger ${b?.title ?? 'ce rendez-vous'}`, !!b, b ? [] : [{ field: 'ref', question: 'Quel rendez-vous garder ?', options: [] }]);
  }

  // ----- Échéance / contrôle -----
  const ex = EXAM_RE.exec(n);
  if (ex) {
    const dh = findDate(n, now);
    const th = findTime(n);
    const kind = /rattrapage/.test(ex[1]) ? 'rattrapage' : /rendu/.test(ex[1]) ? 'rendu' : /tp/.test(ex[1]) ? 'tp' : 'controle';
    // Matière : « contrôle d'électricité », « partiel de maths », « contrôle maths ».
    const after = n.slice(ex.index + ex[0].length).replace(/^\s*(de |d'|en |du )?/, '');
    let subjectRaw = after.split(/\s(?:le |la |les |demain|aujourd'hui|apres|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|a |\d)/)[0].trim();
    if (dh && subjectRaw.includes(dh.text)) subjectRaw = subjectRaw.replace(dh.text, '').trim();
    const subjects = ctx.projects.filter((p) => p.kind === 'subject');
    const subject = matchProject(n, subjects);
    const subjName = subject?.name ?? (subjectRaw ? cap(originalOf(raw, subjectRaw)) : undefined);
    const exWord = { controle: 'Contrôle', rattrapage: 'Rattrapage', rendu: 'Rendu', tp: 'TP noté' }[kind];
    const title = subjName ? `${exWord} ${/^[aeiouyh]/i.test(norm(subjName)) ? "d'" : 'de '}${subjName.charAt(0).toLowerCase() + subjName.slice(1)}` : exWord;
    const fields: Record<string, any> = { kind, title, date: dh?.date, time: th?.time, timeUnknown: !th, subjectId: subject?.id, subjectName: subject ? undefined : subjName, prepTasks: [] as string[] };
    const amb: Ambiguity[] = [];
    if (!dh) amb.push({ field: 'date', question: 'Quelle date ?', options: [{ label: 'Demain', value: addDays(today, 1) }, { label: 'Dans une semaine', value: addDays(today, 7) }] });
    else if (dh.ambiguous) amb.push({ field: 'date', question: 'Quel jour exactement ?', options: dh.ambiguous.options });
    // Préparation incluse dans la même phrase (« … réviser les circuits »)
    const verbMatch = /\b(reviser|refaire|revoir|preparer|apprendre|relire)\b.*/.exec(after);
    if (verbMatch) fields.prepTasks.push(cap(raw.slice(raw.length - verbMatch[0].length)));
    return base('create_deadline', fields, deadlineLabel(fields), amb.length === 0, amb);
  }

  // ----- Événement daté avec heure -----
  const dh = findDate(n, now);
  const th = findTime(n, { requireAt: false });
  const evCat = EVENT_WORDS.find(([re]) => re.test(n));
  if (th && (evCat || dh)) {
    const dur = findDuration(n);
    const titleTxt = stripFragments(raw, n, [dh?.text ?? '', th.text, dur?.text ?? '']).replace(/^(a|à|le|la)\s+/i, '').replace(/\s(à|a)$/i, '');
    const date = dh?.date ?? today;
    const fields: Record<string, any> = { title: cap(titleTxt || evCat?.[1] || 'Événement'), date, time: th.time, durationMin: dur?.minutes, category: evCat?.[1] ?? 'rdv' };
    const amb: Ambiguity[] = [];
    if (dh?.ambiguous) amb.push({ field: 'date', question: 'Quel jour exactement ?', options: dh.ambiguous.options });
    if (!dur) fields.durationMin = fields.category === 'sport' ? 90 : 60;
    fields.durationGuessed = !dur;
    return base('create_event', fields, `Rendez-vous : ${fields.title} — ${date} ${th.time} (${fields.durationMin} min${!dur ? ', durée proposée' : ''})`, amb.length === 0, amb);
  }

  // ----- Tâche (par défaut) -----
  const someday = /\b(a faire un jour|un jour|quand j'aurai le temps|plus tard|idee)\b/.test(n);
  const dur = findDuration(n);
  const proj = matchProject(n, ctx.projects);
  let title = stripFragments(raw, n, [dh?.text ?? '', dur?.text ?? '']);
  title = title.replace(/^(à faire un jour|a faire un jour|un jour|à faire|a faire|idée|idee|penser à|penser a|il faut|je dois|todo)\s*[:,]?\s*/i, '');
  const fields: Record<string, any> = { title: cap(title || raw), dueDate: someday ? undefined : dh?.date, estimateMin: dur?.minutes, projectId: proj?.id, someday };
  const amb: Ambiguity[] = [];
  if (dh?.ambiguous) amb.push({ field: 'dueDate', question: 'Quel jour exactement ?', options: dh.ambiguous.options });
  return base('create_task', fields, `Tâche : ${fields.title}${fields.dueDate ? ' — pour le ' + fields.dueDate : ''}${proj ? ' · ' + proj.name : ''}`, amb.length === 0, amb);
}

function matchTargetTask(text: string, ctx: ParseContext): { task?: Task; options: { label: string; value: any }[] } {
  const n = norm(text);
  // Une matière ou un contrôle cité : on prend la tâche ouverte la plus urgente qui lui est liée.
  const dl = ctx.deadlines.find((d) => !d.deletedAt && d.status !== 'done' && d.status !== 'cancelled' && keywords(n).some((k) => norm(d.title).includes(k)));
  const subj = ctx.projects.find((p) => p.kind === 'subject' && keywords(n).some((k) => norm(p.name).includes(k)));
  const linked = ctx.tasks.filter((t) => !t.deletedAt && t.status !== 'done' && ((dl && t.deadlineId === dl.id) || (subj && t.projectId === subj.id)));
  if (linked.length) return { task: linked.sort((a, b) => (dl && a.deadlineId === dl.id ? 0 : 1) - (dl && b.deadlineId === dl.id ? 0 : 1) || b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))[0], options: [] };
  const m = matchTasks(n, ctx.tasks);
  if (m.length === 1) return { task: m[0], options: [] };
  return { options: m.slice(0, 3).map((t) => ({ label: t.title, value: t.id })) };
}
