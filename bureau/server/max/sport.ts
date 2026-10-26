// Le sport : une semaine type à jours fixes (Pec-Dos, Biceps-Triceps-Épaules, Jambes, Repos), un journal des séances
// faites (sport/seances.jsonl, une ligne par jour) et les muscles travaillés ces 14 derniers jours, pour le corps 3D.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { SportVue } from "../../shared/protocol.ts";
import { JOURS_SEMAINE, MUSCLES, SEANCES, SEMAINE_DEFAUT, seance, trouverSeance, type MuscleId, type SeanceId } from "../../shared/sport.ts";
import { jourDe } from "./coach.ts";

const DOSSIER = "sport";
const FICHIER_SEMAINE = "semaine.json";
const FICHIER_JOURNAL = "seances.jsonl";
/** Deux fois par muscle en 14 jours = intensité maximale sur le corps. */
const FOIS_PLEIN = 4;

export interface SeanceFaite {
  jour: string; // AAAA-MM-JJ
  seance: SeanceId;
  note?: string;
}

interface Reponse {
  ok: boolean;
  texte: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const date = (jour: string) => new Date(`${jour}T12:00:00`);
const decaler = (jour: string, n: number) => {
  const d = date(jour);
  d.setDate(d.getDate() + n);
  return iso(d);
};
/** 0 = lundi … 6 = dimanche. */
export const indiceJour = (jour: string) => (date(jour).getDay() + 6) % 7;
const nomSeance = (id: SeanceId) => seance(id)?.nom ?? id;

/** Le journal, une séance par jour (la dernière notée l'emporte), du plus ancien au plus récent. */
export function lireSeances(dossier: string): SeanceFaite[] {
  let brut = "";
  try {
    brut = fs.readFileSync(path.join(dossier, DOSSIER, FICHIER_JOURNAL), "utf8");
  } catch {
    return [];
  }
  const parJour = new Map<string, SeanceFaite>();
  for (const l of brut.split("\n")) {
    try {
      const s = JSON.parse(l) as SeanceFaite;
      if (/^\d{4}-\d{2}-\d{2}$/.test(s.jour) && seance(s.seance)) parJour.set(s.jour, s);
    } catch {
      // ligne vide ou abîmée : ignorée
    }
  }
  return [...parJour.values()].sort((a, b) => a.jour.localeCompare(b.jour));
}

/** Combien de fois chaque muscle a été travaillé sur les 14 jours qui finissent `jour`, et la dernière fois. */
export function musclesTravailles(seances: SeanceFaite[], jour: string): SportVue["muscles"] {
  const depuis = decaler(jour, -13);
  const stats = new Map<MuscleId, { fois: number; derniere: string | null }>();
  for (const id of Object.keys(MUSCLES) as MuscleId[]) stats.set(id, { fois: 0, derniere: null });
  for (const s of seances) {
    if (s.jour > jour) continue;
    for (const m of seance(s.seance)?.muscles ?? []) {
      const v = stats.get(m)!;
      if (s.jour >= depuis) v.fois++;
      if (!v.derniere || s.jour > v.derniere) v.derniere = s.jour;
    }
  }
  return [...stats].map(([id, v]) => ({ id, ...v, intensite: Math.min(1, v.fois / FOIS_PLEIN) }));
}

/** Événement : `etat` quand le journal ou la semaine type change. */
export class Sport extends EventEmitter {
  constructor(private o: { dossier: string }) {
    super();
  }

  private chemin(nom: string) {
    return path.join(this.o.dossier, DOSSIER, nom);
  }

  semaine(): SeanceId[] {
    try {
      const s = JSON.parse(fs.readFileSync(this.chemin(FICHIER_SEMAINE), "utf8")) as string[];
      if (Array.isArray(s) && s.length === 7 && s.every((x) => seance(x))) return s as SeanceId[];
    } catch {
      // pas encore de semaine choisie
    }
    return [...SEMAINE_DEFAUT];
  }

  /** Change la séance d'un jour de la semaine type (0 = lundi), ou de plusieurs jours d'un coup. */
  changerSemaine(changements: { jour: number | string; seance: string }[]): Reponse {
    const semaine = this.semaine();
    const faits: string[] = [];
    for (const c of changements) {
      const i = typeof c.jour === "number" ? c.jour : JOURS_SEMAINE.indexOf(String(c.jour).toLowerCase().trim());
      const s = trouverSeance(String(c.seance));
      if (!(i >= 0 && i < 7) || !s) return { ok: false, texte: `Je n'ai pas compris « ${c.jour} : ${c.seance} ». Jours : lundi à dimanche ; séances : ${SEANCES.map((x) => x.nom).join(", ")}.` };
      semaine[i] = s.id;
      faits.push(`${JOURS_SEMAINE[i]} : ${s.nom}`);
    }
    fs.mkdirSync(path.join(this.o.dossier, DOSSIER), { recursive: true });
    fs.writeFileSync(this.chemin(FICHIER_SEMAINE), JSON.stringify(semaine) + "\n");
    this.emit("etat");
    return { ok: true, texte: `Semaine type mise à jour (${faits.join(", ")}).` };
  }

  /** Note la séance faite un jour (aujourd'hui par défaut) ; une seule par jour, la dernière notée l'emporte. */
  noter(texteSeance: string, o: { jour?: string; note?: string } = {}): Reponse {
    const s = trouverSeance(texteSeance);
    if (!s) return { ok: false, texte: `Séance inconnue. Les séances : ${SEANCES.map((x) => `${x.numero}. ${x.nom}`).join(", ")}.` };
    const aujourdhui = jourDe(new Date());
    const jour = o.jour && /^\d{4}-\d{2}-\d{2}$/.test(o.jour) ? o.jour : aujourdhui;
    if (jour > aujourdhui) return { ok: false, texte: "On ne peut pas noter une séance dans le futur." };
    const ligne: SeanceFaite = { jour, seance: s.id, ...(o.note?.trim() ? { note: o.note.replace(/\s+/g, " ").trim().slice(0, 300) } : {}) };
    fs.mkdirSync(path.join(this.o.dossier, DOSSIER), { recursive: true });
    fs.appendFileSync(this.chemin(FICHIER_JOURNAL), JSON.stringify(ligne) + "\n");
    this.emit("etat");
    const quand = jour === aujourdhui ? "aujourd'hui" : `le ${date(jour).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`;
    return { ok: true, texte: s.id === "repos" ? `Repos noté ${quand}. Bien récupérer, ça fait partie de l'entraînement.` : `Séance ${s.nom} notée ${quand} (${s.muscles.map((m) => MUSCLES[m]).join(", ")}).` };
  }

  vue(maintenant = new Date()): SportVue {
    const jour = jourDe(maintenant);
    const semaine = this.semaine();
    const seances = lireSeances(this.o.dossier);
    const faiteLe = (j: string) => seances.find((s) => s.jour === j)?.seance ?? null;
    const lundi = decaler(jour, -indiceJour(jour));
    const depuis30 = decaler(jour, -29);
    return {
      semaine,
      jour,
      prevue: semaine[indiceJour(jour)],
      faite: faiteLe(jour),
      cetteSemaine: [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const j = decaler(lundi, i);
        return { jour: j, prevue: semaine[i], faite: faiteLe(j) };
      }),
      muscles: musclesTravailles(seances, jour),
      seances30: seances.filter((s) => s.jour >= depuis30 && s.jour <= jour && s.seance !== "repos").length,
    };
  }

  /** Pour Max : la séance du jour, demain, la semaine type et les muscles travaillés. */
  decrire(maintenant = new Date()): string {
    const v = this.vue(maintenant);
    const demain = v.semaine[(indiceJour(v.jour) + 1) % 7];
    const travailles = v.muscles.filter((m) => m.fois).sort((a, b) => b.fois - a.fois);
    const oublies = v.muscles.filter((m) => !m.fois && m.id !== "abdos").map((m) => MUSCLES[m.id]);
    return [
      `Sport — séance du jour (${JOURS_SEMAINE[indiceJour(v.jour)]}) : ${nomSeance(v.prevue)}${v.faite ? ` ; faite : ${nomSeance(v.faite)}` : " ; pas encore notée"}. Demain : ${nomSeance(demain)}.`,
      `Semaine type : ${v.semaine.map((s, i) => `${JOURS_SEMAINE[i]} ${nomSeance(s)}`).join(", ")}.`,
      `14 derniers jours : ${travailles.length ? travailles.map((m) => `${MUSCLES[m.id]} ×${m.fois}`).join(", ") : "aucune séance notée"}${oublies.length && travailles.length ? ` ; pas travaillés : ${oublies.join(", ")}` : ""}. Séances sur 30 jours : ${v.seances30}.`,
    ].join("\n");
  }
}
