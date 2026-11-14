// Calculs purs du décor : le moment de la journée et le texte du bandeau lumineux.
import type { MissionVue, Phase } from "../shared/protocol.ts";

export type Moment = "aube" | "jour" | "soir" | "nuit";

/** Le moment de la journée pour une heure (0 à 23). */
export function momentDe(heure: number): Moment {
  if (heure >= 6 && heure < 8) return "aube";
  if (heure >= 8 && heure < 18) return "jour";
  if (heure >= 18 && heure < 21) return "soir";
  return "nuit";
}

const PHASES: Record<Phase, string> = {
  planification: "MAX PLANIFIE",
  travail: "L'ÉQUIPE TRAVAILLE",
  relecture: "MAX RELIT",
  termine: "QUÊTE ACCOMPLIE !",
  pause: "EN PAUSE (QUOTA)",
  echec: "QUÊTE ÉCHOUÉE",
  arrete: "QUÊTE ARRÊTÉE",
};

/** Le texte du bandeau lumineux de l'enseigne. */
export function texteBandeau(m: MissionVue | null): string {
  if (!m) return "EN ATTENTE D'UNE QUÊTE · DIS « MAX, … » · ";
  return `QUÊTE : ${m.titre.toUpperCase()} · ${PHASES[m.phase]} · `;
}
