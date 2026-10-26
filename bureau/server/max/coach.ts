// Le coach : sessions de travail minutées, journal des heures, bilan, échéances (moi.md), parking à idées et rappels.
// Les fichiers lisibles (moi.md, travail.jsonl, idees.md) sont dans le dossier des missions ; l'état technique
// (minuteur et rappels en cours) dans le dossier des données, pour survivre à un redémarrage du Bureau.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { CoachVue } from "../../shared/protocol.ts";

export const FICHIER_PROFIL = "moi.md";
export const FICHIER_JOURNAL = "travail.jsonl";
export const FICHIER_IDEES = "idees.md";
const FICHIER_MINUTEUR = "minuteur.json";
const FICHIER_RAPPELS = "rappels.json";
const MAX_PROFIL = 8000;
const COUPURE_NUIT_H = 5; // avant 5 h du matin, on est encore « hier »
const MINUTE = 60_000;

export interface SessionTravail {
  debut: string; // ISO
  fin: string;
  minutes: number;
  sujet: string;
  note?: string;
}

export interface Minuteur {
  type: "travail" | "pause";
  sujet: string;
  debut: string;
  fin: string;
  minutes: number;
}

export interface FinMinuteur {
  type: Minuteur["type"];
  sujet: string;
  minutes: number;
  /** Minutes de travail notées aujourd'hui, celle-ci comprise. */
  aujourdhui: number;
}

interface Rappel {
  texte: string;
  quand: string; // ISO
}

export interface Reponse {
  ok: boolean;
  texte: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const heureParlee = (d: Date) => `${d.getHours()} h ${pad(d.getMinutes())}`;
const dateParlee = (d: Date, jourSemaine = false) =>
  d.toLocaleDateString("fr-FR", { ...(jourSemaine ? { weekday: "long" } : {}), day: "numeric", month: "long", year: "numeric" });

function lire(fichier: string): string {
  try {
    return fs.readFileSync(fichier, "utf8");
  } catch {
    return "";
  }
}

function lireJson<T>(fichier: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(fichier, "utf8")) as T;
  } catch {
    return null;
  }
}

/** « 45 minutes », « 1 heure 15 », « 2 heures ». */
export function dureeParlee(minutes: number): string {
  const m = Math.round(minutes);
  if (m <= 0) return "rien";
  if (m < 60) return `${m} minute${m > 1 ? "s" : ""}`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return `${h} heure${h > 1 ? "s" : ""}${reste ? ` ${reste}` : ""}`;
}

/** Le jour (AAAA-MM-JJ, heure locale) auquel compte un moment : la nuit jusqu'à 5 h compte pour la veille. */
export function jourDe(d: Date): string {
  return iso(new Date(d.getTime() - COUPURE_NUIT_H * 3_600_000));
}

// --- journal et bilan ----------------------------------------------------------------------------------

export function lireJournal(dossier: string): SessionTravail[] {
  return lire(path.join(dossier, FICHIER_JOURNAL))
    .split("\n")
    .filter((l) => l.trim())
    .flatMap((l) => {
      try {
        const s = JSON.parse(l) as SessionTravail;
        return typeof s.minutes === "number" && typeof s.debut === "string" ? [s] : [];
      } catch {
        return [];
      }
    });
}

function ajouterAuJournal(dossier: string, s: SessionTravail): void {
  fs.mkdirSync(dossier, { recursive: true });
  fs.appendFileSync(path.join(dossier, FICHIER_JOURNAL), JSON.stringify(s) + "\n");
}

export interface Bilan {
  aujourdhui: number;
  sessionsAujourdhui: number;
  hier: number;
  /** Les 7 derniers jours, du plus ancien à aujourd'hui. */
  jours: { jour: string; minutes: number }[];
  semaine: number;
  /** Jours d'affilée avec au moins une session (aujourd'hui compte s'il y en a déjà une). */
  serie: number;
}

export function bilan(sessions: SessionTravail[], maintenant: Date): Bilan {
  const parJour = new Map<string, { minutes: number; n: number }>();
  for (const s of sessions) {
    const j = jourDe(new Date(s.debut));
    const v = parJour.get(j) ?? { minutes: 0, n: 0 };
    v.minutes += s.minutes;
    v.n++;
    parJour.set(j, v);
  }
  const base = new Date(maintenant.getTime() - COUPURE_NUIT_H * 3_600_000);
  const jourIlYA = (n: number) => iso(new Date(base.getFullYear(), base.getMonth(), base.getDate() - n));
  const jours = [6, 5, 4, 3, 2, 1, 0].map((n) => ({ jour: jourIlYA(n), minutes: parJour.get(jourIlYA(n))?.minutes ?? 0 }));
  let serie = 0;
  for (let n = parJour.has(jourIlYA(0)) ? 0 : 1; parJour.has(jourIlYA(n)); n++) serie++;
  return {
    aujourdhui: parJour.get(jourIlYA(0))?.minutes ?? 0,
    sessionsAujourdhui: parJour.get(jourIlYA(0))?.n ?? 0,
    hier: parJour.get(jourIlYA(1))?.minutes ?? 0,
    jours,
    semaine: jours.reduce((t, j) => t + j.minutes, 0),
    serie,
  };
}

export function decrireBilan(b: Bilan): string {
  if (!b.semaine && !b.serie) return "Aucune session de travail notée ces 7 derniers jours.";
  const jourCourt = (j: string) => new Date(`${j}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
  return [
    `Aujourd'hui : ${dureeParlee(b.aujourdhui)}${b.sessionsAujourdhui ? ` (${b.sessionsAujourdhui} session${b.sessionsAujourdhui > 1 ? "s" : ""})` : ""}.`,
    `Hier : ${dureeParlee(b.hier)}.`,
    `7 derniers jours : ${dureeParlee(b.semaine)}, soit ${dureeParlee(Math.round(b.semaine / 7))} par jour en moyenne.`,
    `Série : ${b.serie} jour${b.serie > 1 ? "s" : ""} d'affilée avec au moins une session.`,
    `Détail : ${b.jours.map((j) => `${jourCourt(j.jour)} ${dureeParlee(j.minutes)}`).join(" ; ")}.`,
  ].join("\n");
}

// --- profil (moi.md) et échéances ------------------------------------------------------------------------

export function lireProfil(dossier: string): string {
  const p = lire(path.join(dossier, FICHIER_PROFIL)).trim();
  return p.length > MAX_PROFIL ? p.slice(0, MAX_PROFIL) + "\n(…)" : p;
}

export interface Echeance {
  nom: string;
  date: string; // AAAA-MM-JJ
  jours: number;
}

const LIGNE_ECHEANCE = /^\s*[-*]\s*(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))\s*[:–—-]\s*(.+?)\s*$/;

/** Les lignes « - AAAA-MM-JJ : nom » (ou JJ/MM/AAAA) de moi.md, à venir, de la plus proche à la plus lointaine. */
export function echeances(profil: string, maintenant: Date): Echeance[] {
  const aujourdhui = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
  const out: Echeance[] = [];
  for (const l of profil.split("\n")) {
    const m = LIGNE_ECHEANCE.exec(l);
    if (!m) continue;
    const [a, mo, j] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
    const d = new Date(Number(a), Number(mo) - 1, Number(j));
    if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(mo) - 1) continue;
    const jours = Math.round((d.getTime() - aujourdhui.getTime()) / 86_400_000);
    if (jours >= 0) out.push({ nom: m[7], date: iso(d), jours });
  }
  return out.sort((x, y) => x.jours - y.jours);
}

/** Ajoute « - AAAA-MM-JJ : nom » à la section « ## Échéances » de moi.md (créée au besoin). */
export function ajouterEcheance(dossier: string, date: string, nom: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m || new Date(`${date.trim()}T12:00:00`).getMonth() !== Number(m[2]) - 1) throw new Error("La date doit être au format AAAA-MM-JJ.");
  const ligne = `- ${date.trim()} : ${nom.replace(/\s+/g, " ").trim()}`;
  const fichier = path.join(dossier, FICHIER_PROFIL);
  const lignes = lire(fichier).replace(/\s+$/, "").split("\n");
  const titre = lignes.findIndex((l) => /^##\s+[ÉE]ch[ée]ances/i.test(l));
  if (titre < 0) {
    lignes.push("", "## Échéances", ligne);
  } else {
    let fin = titre + 1;
    while (fin < lignes.length && !/^#/.test(lignes[fin])) fin++;
    while (fin > titre + 1 && !lignes[fin - 1].trim()) fin--;
    lignes.splice(fin, 0, ligne);
  }
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(fichier, lignes.join("\n").replace(/^\n+/, "") + "\n");
  return ligne;
}

// --- parking à idées --------------------------------------------------------------------------------------

const ENTETE_IDEES = "# Idées au parking\n\nLes idées notées par Max pendant le travail, pour y revenir au bon moment.\n\n";

export function noterIdee(dossier: string, idee: string, date = new Date()): string {
  const texte = idee.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!texte) throw new Error("L'idée est vide.");
  const ligne = `- [${iso(date)}] ${texte}`;
  const fichier = path.join(dossier, FICHIER_IDEES);
  fs.mkdirSync(dossier, { recursive: true });
  if (!fs.existsSync(fichier)) fs.writeFileSync(fichier, ENTETE_IDEES);
  fs.appendFileSync(fichier, ligne + "\n");
  return ligne;
}

export function lireIdees(dossier: string): string[] {
  return lire(path.join(dossier, FICHIER_IDEES))
    .split("\n")
    .filter((l) => l.startsWith("- "));
}

// --- rappels ----------------------------------------------------------------------------------------------

/** « dans N minutes » ou « à HH:MM » (« 23:00 », « 7h30 ») ; demain si l'heure est déjà passée. */
export function heureCible(o: { dansMinutes?: number; heure?: string }, maintenant: Date): Date | null {
  if (typeof o.dansMinutes === "number" && o.dansMinutes > 0 && o.dansMinutes <= 7 * 24 * 60) return new Date(maintenant.getTime() + o.dansMinutes * MINUTE);
  const m = /^\s*(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?\s*$/i.exec(o.heure ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return null;
  const d = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate(), h, mi);
  if (d.getTime() <= maintenant.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

// --- le coach ---------------------------------------------------------------------------------------------

/**
 * Événements : `fin` (FinMinuteur) quand une session ou une pause se termine, `rappel` (texte) à l'heure d'un rappel,
 * `etat` quand sa vue change.
 */
export class Coach extends EventEmitter {
  private minuteur: Minuteur | null = null;
  private timer?: NodeJS.Timeout;
  private rappels: Rappel[] = [];
  private timersRappels: NodeJS.Timeout[] = [];

  constructor(private o: { dossier: string; dossierDonnees: string }) {
    super();
    this.restaurer();
  }

  // minuteur

  demarrerSession(sujet: string, minutes: number): Reponse {
    if (!(minutes >= 1 && minutes <= 180)) return { ok: false, texte: "Une session dure entre 1 et 180 minutes." };
    if (this.minuteur?.type === "travail") {
      const reste = Math.ceil((new Date(this.minuteur.fin).getTime() - Date.now()) / MINUTE);
      return { ok: false, texte: `Une session est déjà en cours (« ${this.minuteur.sujet} », encore ${dureeParlee(reste)}). Arrête-la d'abord.` };
    }
    const s = sujet.replace(/\s+/g, " ").trim() || "Révisions";
    this.armer({ type: "travail", sujet: s, minutes, debut: new Date().toISOString(), fin: new Date(Date.now() + minutes * MINUTE).toISOString() });
    return { ok: true, texte: `Session de ${dureeParlee(minutes)} lancée sur « ${s} », fin à ${heureParlee(new Date(this.minuteur!.fin))}. Je préviendrai à la fin.` };
  }

  demarrerPause(minutes: number): Reponse {
    if (!(minutes >= 1 && minutes <= 60)) return { ok: false, texte: "Une pause dure entre 1 et 60 minutes." };
    if (this.minuteur?.type === "travail") this.enregistrer(this.minuteur, new Date());
    this.armer({ type: "pause", sujet: "", minutes, debut: new Date().toISOString(), fin: new Date(Date.now() + minutes * MINUTE).toISOString() });
    return { ok: true, texte: `Pause de ${dureeParlee(minutes)}, jusqu'à ${heureParlee(new Date(this.minuteur!.fin))}.` };
  }

  arreterSession(note?: string): Reponse {
    const m = this.minuteur;
    if (!m) return { ok: false, texte: "Aucune session ni pause en cours." };
    this.desarmer();
    if (m.type === "pause") return { ok: true, texte: "Pause arrêtée." };
    const faites = this.enregistrer(m, new Date(), note);
    const b = this.bilan();
    return {
      ok: true,
      texte: faites
        ? `Session arrêtée : ${dureeParlee(faites)} sur « ${m.sujet} ». Aujourd'hui : ${dureeParlee(b.aujourdhui)}.`
        : "Session arrêtée avant une minute : rien de noté.",
    };
  }

  bilan(): Bilan {
    return bilan(lireJournal(this.o.dossier), new Date());
  }

  // rappels

  programmerRappel(texte: string, quand: { dansMinutes?: number; heure?: string }): Reponse {
    const t = texte.replace(/\s+/g, " ").trim();
    if (!t) return { ok: false, texte: "Le rappel est vide." };
    const d = heureCible(quand, new Date());
    if (!d) return { ok: false, texte: "Je n'ai pas compris l'heure du rappel : donne un nombre de minutes ou une heure comme 23:00." };
    this.rappels.push({ texte: t, quand: d.toISOString() });
    this.sauverRappels();
    this.armerRappels();
    return { ok: true, texte: `Rappel programmé ${this.quandParle(d)} : « ${t} ».` };
  }

  listeRappels(): string {
    if (!this.rappels.length) return "Aucun rappel programmé.";
    return this.rappels.map((r) => `- ${this.quandParle(new Date(r.quand))} : ${r.texte}`).join("\n");
  }

  annulerRappel(texte: string): Reponse {
    const cherche = sansAccents(texte.trim());
    const avant = this.rappels.length;
    if (cherche) this.rappels = this.rappels.filter((r) => !sansAccents(r.texte).includes(cherche));
    const n = avant - this.rappels.length;
    if (!n) return { ok: false, texte: "Aucun rappel ne correspond." };
    this.sauverRappels();
    this.armerRappels();
    return { ok: true, texte: `${n} rappel(s) annulé(s).` };
  }

  // vues

  vue(): CoachVue {
    const e = echeances(lireProfil(this.o.dossier), new Date())[0];
    const journal = lireJournal(this.o.dossier);
    const b = bilan(journal, new Date());
    return {
      minuteur: this.minuteur ? { type: this.minuteur.type, sujet: this.minuteur.sujet, fin: this.minuteur.fin } : null,
      aujourdhui: b.aujourdhui,
      total: journal.reduce((t, s) => t + s.minutes, 0),
      serie: b.serie,
      echeance: e ? { nom: e.nom, jours: e.jours } : null,
    };
  }

  /** Ce que Max doit savoir au début d'une conversation : date, échéances, travail, minuteur, rappels, idées. */
  contexte(): string {
    const maintenant = new Date();
    const lignes = [`Nous sommes le ${dateParlee(maintenant, true)}, il est ${heureParlee(maintenant)}.`];
    const e = echeances(lireProfil(this.o.dossier), maintenant);
    lignes.push(
      e.length
        ? `Échéances : ${e.map((x) => `${x.nom} : le ${dateParlee(new Date(`${x.date}T12:00:00`))}, ${x.jours === 0 ? "aujourd'hui" : `dans ${x.jours} jour${x.jours > 1 ? "s" : ""}`}`).join(" ; ")}.`
        : "Échéances : aucune notée (ajouter_echeance pour en ajouter).",
    );
    lignes.push(`Travail noté : ${decrireBilan(this.bilan()).split("\n").slice(0, 4).join(" ")}`);
    const m = this.minuteur;
    if (m) lignes.push(m.type === "travail" ? `Session de travail en cours : « ${m.sujet} », fin à ${heureParlee(new Date(m.fin))}.` : `Pause en cours jusqu'à ${heureParlee(new Date(m.fin))}.`);
    if (this.rappels.length) lignes.push(`Rappels programmés :\n${this.listeRappels()}`);
    const idees = lireIdees(this.o.dossier).length;
    if (idees) lignes.push(`Idées au parking : ${idees} (lire_idees pour les voir).`);
    return lignes.join("\n");
  }

  /** Phrase d'accueil au réveil. */
  accueil(): string {
    const b = this.bilan();
    if (this.minuteur?.type === "travail") return `Salut ! Ta session « ${this.minuteur.sujet} » tourne toujours. Je t'écoute.`;
    if (b.aujourdhui) return `Salut ! Déjà ${dureeParlee(b.aujourdhui)} de travail aujourd'hui. Je t'écoute.`;
    return "Salut ! Je t'écoute.";
  }

  fermer(): void {
    clearTimeout(this.timer);
    this.timersRappels.forEach(clearTimeout);
    this.timersRappels = [];
  }

  // --- interne -------------------------------------------------------------------------------------------

  private fichier(nom: string) {
    return path.join(this.o.dossierDonnees, nom);
  }

  private armer(m: Minuteur): void {
    clearTimeout(this.timer);
    this.minuteur = m;
    fs.mkdirSync(this.o.dossierDonnees, { recursive: true });
    fs.writeFileSync(this.fichier(FICHIER_MINUTEUR), JSON.stringify(m));
    this.timer = setTimeout(() => this.terminer(), Math.max(0, new Date(m.fin).getTime() - Date.now()));
    this.emit("etat");
  }

  private desarmer(): void {
    clearTimeout(this.timer);
    this.minuteur = null;
    fs.rmSync(this.fichier(FICHIER_MINUTEUR), { force: true });
    this.emit("etat");
  }

  private terminer(): void {
    const m = this.minuteur;
    if (!m) return;
    this.desarmer();
    if (m.type === "travail") this.enregistrer(m, new Date(m.fin));
    const fin: FinMinuteur = { type: m.type, sujet: m.sujet, minutes: m.minutes, aujourdhui: this.bilan().aujourdhui };
    this.emit("fin", fin);
    this.emit("etat");
  }

  /** Note la partie faite d'une session de travail ; renvoie les minutes notées (0 si moins d'une minute). */
  private enregistrer(m: Minuteur, jusqua: Date, note?: string): number {
    const fin = Math.min(jusqua.getTime(), new Date(m.fin).getTime());
    const minutes = Math.floor((fin - new Date(m.debut).getTime()) / MINUTE);
    if (minutes < 1) return 0;
    const n = note?.replace(/\s+/g, " ").trim();
    ajouterAuJournal(this.o.dossier, { debut: m.debut, fin: new Date(fin).toISOString(), minutes, sujet: m.sujet, ...(n ? { note: n } : {}) });
    return minutes;
  }

  private quandParle(d: Date): string {
    const demain = jourDe(d) !== jourDe(new Date()) && iso(d) !== iso(new Date());
    return `${demain ? `le ${d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })} ` : ""}à ${heureParlee(d)}`;
  }

  private sauverRappels(): void {
    fs.mkdirSync(this.o.dossierDonnees, { recursive: true });
    fs.writeFileSync(this.fichier(FICHIER_RAPPELS), JSON.stringify(this.rappels));
  }

  private armerRappels(): void {
    this.timersRappels.forEach(clearTimeout);
    this.timersRappels = this.rappels.map((r) =>
      setTimeout(() => {
        this.rappels = this.rappels.filter((x) => x !== r);
        this.sauverRappels();
        this.armerRappels();
        this.emit("rappel", r.texte);
        this.emit("etat");
      }, Math.max(0, new Date(r.quand).getTime() - Date.now())),
    );
  }

  private restaurer(): void {
    const m = lireJson<Minuteur>(this.fichier(FICHIER_MINUTEUR));
    if (m?.fin && m.debut) {
      if (new Date(m.fin).getTime() > Date.now()) this.armer(m);
      else {
        fs.rmSync(this.fichier(FICHIER_MINUTEUR), { force: true });
        if (m.type === "travail") this.enregistrer(m, new Date(m.fin));
      }
    }
    // Les rappels manqués depuis plus d'une heure (Bureau fermé) sont abandonnés ; les autres partent tout de suite.
    const r = lireJson<Rappel[]>(this.fichier(FICHIER_RAPPELS));
    this.rappels = Array.isArray(r) ? r.filter((x) => x?.texte && new Date(x.quand).getTime() > Date.now() - 3_600_000) : [];
    this.armerRappels();
  }
}
