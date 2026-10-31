// Les pôles du QG, sans DOM (testable) : ce que dit chaque tuile de l'accueil, les barres des 7 derniers jours,
// et l'état des jours de la semaine de sport.
import type { EtatBureau, Phase, SportVue, TempsPole } from "../shared/protocol.ts";
import { SEANCES, seance } from "../shared/sport.ts";

/** « 0 min », « 45 min », « 1 h », « 3 h 12 ». */
export function duree(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}` : `${m} min`;
}

export interface Tuile {
  /** La ligne sous le nom du pôle. */
  ligne: string;
  /** Remplissage de la jauge (0 à 1, plus si dépassé), ou null s'il n'y en a pas. */
  jauge: number | null;
  /** Limite dépassée, ou séance du jour pas encore faite le soir : la tuile s'allume. */
  alerte: boolean;
}

const PHASES: Partial<Record<Phase, string>> = {
  planification: "Max prépare la quête",
  travail: "L'équipe travaille",
  relecture: "Max relit",
  pause: "Quête en pause",
  termine: "Quête terminée",
};

export function tuile(id: string, etat: EtatBureau, maintenant = new Date()): Tuile {
  const t: TempsPole | undefined = etat.poles?.find((p) => p.id === id);
  const fait = t?.aujourdhui ?? 0;
  if (id === "sante" && etat.sport) {
    const s = etat.sport;
    const prevue = seance(s.prevue)!;
    if (s.faite) return { ligne: `${seance(s.faite)!.emoji} ${seance(s.faite)!.nom} ✅`, jauge: null, alerte: false };
    return { ligne: prevue.id === "repos" ? "😴 Jour de repos" : `${prevue.emoji} ${prevue.nom} · à faire`, jauge: null, alerte: prevue.id !== "repos" && maintenant.getHours() >= 19 };
  }
  if (id === "apps") {
    const m = etat.mission;
    return { ligne: m && PHASES[m.phase] ? `🛠 ${PHASES[m.phase]}` : "Aucune quête en cours", jauge: null, alerte: m?.phase === "pause" };
  }
  if (id === "vie" && etat.mails) {
    const n = etat.mails.categories.find((c) => c.id === "a_traiter")?.mails.length ?? 0;
    return { ligne: n ? `📬 ${n} mail${n > 1 ? "s" : ""} à traiter` : "📭 Rien d'urgent", jauge: null, alerte: n > 0 };
  }
  if (t?.limite) return { ligne: `${duree(fait)} / ${duree(t.limite)}`, jauge: fait / t.limite, alerte: fait >= t.limite };
  if (t?.objectif) return { ligne: `${duree(fait)} / ${duree(t.objectif)}`, jauge: fait / t.objectif, alerte: false };
  return { ligne: fait ? `${duree(fait)} aujourd'hui` : "Rien aujourd'hui", jauge: null, alerte: false };
}

/** Les 7 derniers jours en barres : hauteur relative (0 à 1) et initiale du jour. */
export function barres(t: TempsPole, maintenant = new Date()): { hauteur: number; jour: string; minutes: number }[] {
  const max = Math.max(...t.jours, t.objectif ?? 0, t.limite ?? 0, 1);
  return t.jours.map((m, i) => {
    const d = new Date(maintenant.getTime() - 5 * 3_600_000);
    d.setDate(d.getDate() - (6 - i));
    return { hauteur: m / max, jour: d.toLocaleDateString("fr-FR", { weekday: "narrow" }), minutes: m };
  });
}

export type EtatJourSport = "faite" | "repos" | "manquee" | "aujourdhui" | "avenir";

/** Pour chaque jour de cette semaine : séance faite, repos, manquée, aujourd'hui ou à venir. */
export function semaineSport(s: SportVue): { jour: string; nom: string; emoji: string; etat: EtatJourSport; initiale: string }[] {
  return s.cetteSemaine.map((j) => {
    const prevue = seance(j.prevue)!;
    const faite = j.faite ? seance(j.faite)! : null;
    const etat: EtatJourSport = faite
      ? faite.id === "repos"
        ? "repos"
        : "faite"
      : j.jour === s.jour
        ? "aujourdhui"
        : j.jour > s.jour
          ? "avenir"
          : prevue.id === "repos"
            ? "repos"
            : "manquee";
    const affichee = faite ?? prevue;
    return { jour: j.jour, nom: affichee.nom, emoji: affichee.emoji, etat, initiale: new Date(`${j.jour}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short" }) };
  });
}

/** « demain 07:00 », « aujourd'hui 07:00 », « mardi 08:15 ». */
export function quandReveil(prochainIso: string | null, maintenant = new Date()): string {
  if (!prochainIso) return "aucun";
  const p = new Date(prochainIso);
  const hh = `${String(p.getHours()).padStart(2, "0")}:${String(p.getMinutes()).padStart(2, "0")}`;
  const jour = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const demain = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + 1);
  if (jour(p) === jour(maintenant)) return `aujourd'hui ${hh}`;
  if (jour(p) === jour(demain)) return `demain ${hh}`;
  return `${p.toLocaleDateString("fr-FR", { weekday: "long" })} ${hh}`;
}

/** Décale une heure « HH:MM » de quelques minutes (sur 24 h). */
export function decalerHeure(heure: string, minutes: number): string {
  const [h, m] = heure.split(":").map(Number);
  const t = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** La séance suivante dans l'ordre 1 → 2 → 3 → repos → 1 (pour changer un jour d'un clic). */
export function seanceSuivante(id: string): string {
  const i = SEANCES.findIndex((s) => s.id === id);
  return SEANCES[(i + 1) % SEANCES.length].id;
}
