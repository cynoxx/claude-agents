// Le plan de reconstruction : des objectifs assez petits pour être tenus, qui grandissent chaque semaine.
// - Le réveil recule de 30 min tous les 3 jours, de 8 h 30 jusqu'à 7 h (c'est l'heure de lever qui recale le sommeil).
// - Les blocs de 50 min de médecine : 3 par jour la 1re semaine, 5 la 2e, 6 ensuite.
// - Trois règles par jour ; une journée où elles sont tenues est une bonne journée, même si le reste a déraillé.
// L'état (début du plan, règles cochées par jour) est dans vie/plan.json. Rien de personnel dans ce fichier de code :
// les détails sont dans moi.md, sur le Mac seulement.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { PlanVue, RegleId } from "../../shared/protocol.ts";
import { jourDe } from "./coach.ts";

export const REGLES: { id: RegleId; texte: string }[] = [
  { id: "lever", texte: "Levé à l'heure, téléphone hors de la chambre" },
  { id: "bloc", texte: "Premier bloc de médecine avant tout réseau social" },
  { id: "coucher", texte: "Couché avant l'heure, sans écran au lit" },
];

export const PHRASE_IDENTITE = "Je suis quelqu'un qui tient parole envers lui-même, un petit engagement à la fois.";
export const BLOC_MIN = 50;

export interface ReglagesPlan {
  reveilDepart: string; // HH:MM
  reveilCible: string;
  pasMinutes: number;
  tousLesJours: number;
}

export const REGLAGES_PLAN: ReglagesPlan = { reveilDepart: "08:30", reveilCible: "07:00", pasMinutes: 30, tousLesJours: 3 };

const enMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const enHeure = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const joursEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00`) - Date.parse(`${a}T12:00:00`)) / 86_400_000);

/** L'heure du réveil pour un jour donné du plan (0 = premier jour). */
export function reveilDuJour(n: number, r: ReglagesPlan = REGLAGES_PLAN): string {
  const recul = Math.floor(Math.max(0, n) / r.tousLesJours) * r.pasMinutes;
  return enHeure(Math.max(enMin(r.reveilCible), enMin(r.reveilDepart) - recul));
}

/** Le nombre de blocs de 50 min visés selon la semaine du plan (1, 2, 3+). */
export function blocsDeLaSemaine(semaine: number): number {
  return semaine <= 1 ? 3 : semaine === 2 ? 5 : 6;
}

interface Etat {
  debut: string;
  /** jour → règles tenues */
  regles: Record<string, Partial<Record<RegleId, boolean>>>;
}

export class Plan extends EventEmitter {
  private etat: Etat;
  private readonly fichier: string;

  constructor(private o: { dossier: string; maintenant?: () => Date; reglages?: ReglagesPlan }) {
    super();
    this.fichier = path.join(o.dossier, "vie", "plan.json");
    try {
      this.etat = JSON.parse(fs.readFileSync(this.fichier, "utf8"));
    } catch {
      this.etat = { debut: jourDe(this.maintenant), regles: {} };
      this.sauver();
    }
  }

  private get maintenant(): Date {
    return this.o.maintenant?.() ?? new Date();
  }

  private sauver(): void {
    fs.mkdirSync(path.dirname(this.fichier), { recursive: true });
    fs.writeFileSync(this.fichier, JSON.stringify(this.etat, null, 2) + "\n");
    this.emit("etat");
  }

  /** Le jour du plan (0 = premier jour) pour une date. */
  private numero(jour = jourDe(this.maintenant)): number {
    return Math.max(0, joursEntre(this.etat.debut, jour));
  }

  /** Le réveil de demain (pour le régler le soir). */
  reveilDemain(): string {
    return reveilDuJour(this.numero() + 1, this.o.reglages);
  }

  /** L'objectif de médecine du jour, en minutes. */
  objectifMinutes(): number {
    return blocsDeLaSemaine(Math.floor(this.numero() / 7) + 1) * BLOC_MIN;
  }

  cocher(regle: RegleId, tenue = true, jour = jourDe(this.maintenant)): { ok: boolean; texte: string } {
    if (!REGLES.some((r) => r.id === regle)) return { ok: false, texte: `Règle inconnue : ${regle}.` };
    (this.etat.regles[jour] ??= {})[regle] = tenue;
    this.sauver();
    const v = this.vue();
    const n = REGLES.filter((r) => v.aujourdhui[r.id]).length;
    return { ok: true, texte: `${n}/3 règles tenues aujourd'hui${n === 3 ? " : bonne journée, quoi qu'il arrive d'autre." : "."}` };
  }

  /** Jours d'affilée (jusqu'à hier, ou aujourd'hui s'il est déjà complet) avec les 3 règles tenues. */
  private serie(): number {
    const auj = jourDe(this.maintenant);
    const tenu = (j: string) => REGLES.every((r) => this.etat.regles[j]?.[r.id]);
    let n = 0;
    const d = new Date(`${auj}T12:00:00`);
    if (!tenu(auj)) d.setDate(d.getDate() - 1);
    while (tenu(jourDe(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  vue(): PlanVue {
    const n = this.numero();
    const semaine = Math.floor(n / 7) + 1;
    const r = this.etat.regles[jourDe(this.maintenant)] ?? {};
    return {
      jour: n + 1,
      semaine,
      blocs: blocsDeLaSemaine(semaine),
      reveil: reveilDuJour(n, this.o.reglages),
      reveilDemain: this.reveilDemain(),
      regles: REGLES,
      aujourdhui: { lever: !!r.lever, bloc: !!r.bloc, coucher: !!r.coucher },
      serie: this.serie(),
      identite: PHRASE_IDENTITE,
    };
  }

  /** Pour la consigne de Max. */
  decrire(): string {
    const v = this.vue();
    const tenues = REGLES.filter((x) => v.aujourdhui[x.id]).map((x) => x.texte);
    return `Plan de reconstruction : jour ${v.jour} (semaine ${v.semaine}). Objectif du jour : ${v.blocs} blocs de 50 min de médecine. Réveil aujourd'hui ${v.reveil}, demain ${v.reveilDemain}. Règles tenues aujourd'hui : ${tenues.length ? tenues.join(" ; ") : "aucune encore"}. Série de journées à 3/3 : ${v.serie}.`;
  }
}
