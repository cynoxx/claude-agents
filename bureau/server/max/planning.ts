// L'emploi du temps du jour, construit avec Max : des créneaux (début, fin, titre, type), enregistrés dans
// `emplois-du-temps/AAAA-MM-JJ.json`, affichés sur l'écran de Max et annoncés quand ils commencent.
// Comme le journal de travail, la journée va de 5 h à 5 h : « 00:30 » est la nuit qui suit, pas le matin d'avant.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { Creneau, PlanningVue, TypeCreneau } from "../../shared/protocol.ts";
import { jourDe } from "./coach.ts";

export type { Creneau } from "../../shared/protocol.ts";

const TYPES: TypeCreneau[] = ["travail", "cours", "pause", "repas", "sport", "perso", "sommeil", "autre"];
const FIN_DE_JOURNEE_H = 5;
const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

interface Fichier {
  jour: string;
  creneaux: Creneau[];
  calendrier: boolean;
}

interface Reponse {
  ok: boolean;
  texte: string;
}

/** « 9h », « 09:30 », « 0h30 » → minutes depuis le début de la journée (avant 5 h = la nuit qui suit). */
export function minutesDuJour(heure: string): number {
  const m = /^\s*(\d{1,2})\s*[:h]\s*(\d{2})?\s*$/i.exec(heure);
  if (!m) return NaN;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return NaN;
  return (h < FIN_DE_JOURNEE_H ? h + 24 : h) * 60 + mi;
}

const format = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** Début et fin d'un créneau en minutes de la journée (un créneau du soir peut finir le lendemain matin). */
function bornes(c: Creneau): [number, number] {
  const debut = minutesDuJour(c.debut);
  let fin = minutesDuJour(c.fin);
  if (fin <= debut && debut >= 20 * 60) fin += 24 * 60;
  return [debut, fin];
}

/** Vérifie et range des créneaux venus de Max ; lève une erreur lisible s'il y a un problème. */
export function validerCreneaux(brut: unknown): Creneau[] {
  if (!Array.isArray(brut) || !brut.length) throw new Error("Il faut au moins un créneau.");
  if (brut.length > 40) throw new Error("Trop de créneaux (40 au plus).");
  const creneaux = brut.map((x: Partial<Creneau>, i) => {
    const titre = String(x?.titre ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!titre) throw new Error(`Le créneau ${i + 1} n'a pas de titre.`);
    const debut = minutesDuJour(String(x?.debut ?? ""));
    const fin = minutesDuJour(String(x?.fin ?? ""));
    if (Number.isNaN(debut) || Number.isNaN(fin)) throw new Error(`« ${titre} » : il faut une heure de début et de fin (HH:MM).`);
    const c: Creneau = { debut: format(debut), fin: format(fin), titre, type: TYPES.includes(x?.type as TypeCreneau) ? (x!.type as TypeCreneau) : "autre" };
    const [d, f] = bornes(c);
    if (f <= d || f - d > 14 * 60) throw new Error(`« ${titre} » finit avant de commencer.`);
    return c;
  });
  creneaux.sort((a, b) => bornes(a)[0] - bornes(b)[0]);
  for (let i = 1; i < creneaux.length; i++) {
    if (bornes(creneaux[i])[0] < bornes(creneaux[i - 1])[1]) throw new Error(`« ${creneaux[i].titre} » chevauche « ${creneaux[i - 1].titre} ».`);
  }
  return creneaux;
}

/** Les minutes de la journée en cours pour ce moment (la nuit avant 5 h compte pour la veille). */
function minutesMaintenant(d: Date): number {
  return (d.getHours() < FIN_DE_JOURNEE_H ? d.getHours() + 24 : d.getHours()) * 60 + d.getMinutes();
}

/** L'indice du créneau en cours, ou -1. */
export function creneauEnCours(creneaux: Creneau[], maintenant: Date): number {
  const m = minutesMaintenant(maintenant);
  return creneaux.findIndex((c) => {
    const [d, f] = bornes(c);
    return m >= d && m < f;
  });
}

/** Événements : `creneau` (Creneau) quand un créneau commence, `etat` quand l'emploi du temps change. */
export class Planning extends EventEmitter {
  private timers: NodeJS.Timeout[] = [];
  private fichierJour: Fichier | null = null;

  constructor(private o: { dossier: string; dossierDonnees: string }) {
    super();
    this.fichierJour = this.lire(jourDe(new Date()));
    this.armer();
  }

  private chemin(jour: string) {
    return path.join(this.o.dossier, "emplois-du-temps", `${jour}.json`);
  }

  private lire(jour: string): Fichier | null {
    try {
      const f = JSON.parse(fs.readFileSync(this.chemin(jour), "utf8")) as Fichier;
      return { jour, creneaux: validerCreneaux(f.creneaux), calendrier: !!f.calendrier };
    } catch {
      return null;
    }
  }

  /** L'emploi du temps d'aujourd'hui (relu si la journée a changé). */
  private aujourdhui(): Fichier | null {
    const jour = jourDe(new Date());
    if (this.fichierJour?.jour !== jour) {
      this.fichierJour = this.lire(jour);
      this.armer();
    }
    return this.fichierJour;
  }

  private ecrire(f: Fichier): void {
    fs.mkdirSync(path.dirname(this.chemin(f.jour)), { recursive: true });
    fs.writeFileSync(this.chemin(f.jour), JSON.stringify(f, null, 2) + "\n");
  }

  enregistrer(brut: unknown): Reponse {
    let creneaux: Creneau[];
    try {
      creneaux = validerCreneaux(brut);
    } catch (e) {
      return { ok: false, texte: (e as Error).message };
    }
    this.fichierJour = { jour: jourDe(new Date()), creneaux, calendrier: false };
    this.ecrire(this.fichierJour);
    this.armer();
    this.emit("etat");
    return { ok: true, texte: `Emploi du temps enregistré (${creneaux.length} créneaux), affiché sur l'écran. Je préviendrai au début de chaque créneau.` };
  }

  marquerCalendrier(): void {
    const f = this.aujourdhui();
    if (!f) return;
    f.calendrier = true;
    this.ecrire(f);
    this.emit("etat");
  }

  /** Les créneaux d'aujourd'hui, pour les ajouter au Calendrier (avec leur date réelle). */
  creneauxDates(): { titre: string; date: string; heure: string; minutes: number }[] {
    const f = this.aujourdhui();
    if (!f) return [];
    const [a, m, j] = f.jour.split("-").map(Number);
    return f.creneaux.map((c) => {
      const [d, fin] = bornes(c);
      const debut = new Date(a, m - 1, j, 0, d);
      return {
        titre: c.titre,
        date: `${debut.getFullYear()}-${pad(debut.getMonth() + 1)}-${pad(debut.getDate())}`,
        heure: c.debut,
        minutes: fin - d,
      };
    });
  }

  /** Faut-il proposer de construire l'emploi du temps ? (pas encore fait aujourd'hui, et pas encore proposé) */
  doitProposer(): boolean {
    const jour = jourDe(new Date());
    if (this.aujourdhui()) return false;
    try {
      return fs.readFileSync(path.join(this.o.dossierDonnees, "planning-propose"), "utf8").trim() !== jour;
    } catch {
      return true;
    }
  }

  noterPropose(): void {
    fs.mkdirSync(this.o.dossierDonnees, { recursive: true });
    fs.writeFileSync(path.join(this.o.dossierDonnees, "planning-propose"), jourDe(new Date()));
  }

  vue(): PlanningVue | null {
    const f = this.aujourdhui();
    return f ? { jour: f.jour, creneaux: f.creneaux, enCours: creneauEnCours(f.creneaux, new Date()), calendrier: f.calendrier } : null;
  }

  /** L'emploi du temps en texte, pour Max. */
  decrire(): string {
    const f = this.aujourdhui();
    if (!f) return "Pas encore d'emploi du temps aujourd'hui.";
    const i = creneauEnCours(f.creneaux, new Date());
    const lignes = f.creneaux.map((c, k) => `${k === i ? "▶ " : "- "}${c.debut}–${c.fin} ${c.titre} (${c.type})`);
    return `Emploi du temps du ${f.jour}${f.calendrier ? " (ajouté au Calendrier)" : ""} :\n${lignes.join("\n")}`;
  }

  fermer(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  /** Un minuteur par créneau à venir aujourd'hui. */
  private armer(): void {
    this.fermer();
    const f = this.fichierJour;
    if (!f) return;
    const [a, m, j] = f.jour.split("-").map(Number);
    for (const c of f.creneaux) {
      const debut = new Date(a, m - 1, j, 0, bornes(c)[0]).getTime();
      const dans = debut - Date.now();
      if (dans < 0 || dans > 30 * 3_600_000) continue;
      this.timers.push(
        setTimeout(() => {
          this.emit("creneau", c);
          this.emit("etat");
        }, dans),
      );
    }
    // l'écran change de créneau en cours même sans annonce : on le rafraîchit chaque minute
    const t = setInterval(() => this.emit("etat"), MINUTE);
    t.unref?.();
    this.timers.push(t as unknown as NodeJS.Timeout);
  }
}
