// L'état du Bureau raconté en phrases, pour Max.
import type { MissionResume, MissionVue, Phase, RobotVue } from "../../shared/protocol.ts";

const PHASES: Record<Phase, string> = {
  planification: "Max planifie",
  travail: "l'équipe travaille",
  relecture: "Max relit le travail",
  termine: "terminée",
  pause: "en pause (quota atteint)",
  echec: "échouée",
  arrete: "arrêtée",
};

const STATUTS: Record<RobotVue["statut"], string> = {
  attente: "attend son tour",
  travail: "travaille",
  fini: "a fini",
  quota: "en pause (quota)",
  erreur: "a eu un problème",
  arrete: "arrêté",
};

export const STATUTS_MISSION: Record<MissionResume["statut"], string> = {
  "en-cours": "en cours",
  terminee: "terminée",
  "en-pause": "en pause",
  echouee: "échouée",
  arretee: "arrêtée",
  interrompue: "interrompue",
};

export function decrireEtat(m: MissionVue | null): string {
  if (!m) return "Aucune mission en cours.";
  const etape = m.phase === "travail" && m.totalEtapes > 1 ? ` (étape ${m.etape + 1} sur ${m.totalEtapes})` : "";
  const lignes = [`Mission « ${m.titre} » : ${PHASES[m.phase]}${etape}.`];
  for (const r of m.robots) {
    const detail = r.erreur ? ` — ${r.erreur}` : r.statut === "travail" && r.bulle ? ` — ${r.bulle}` : "";
    lignes.push(`- ${r.nom} (${r.tache}) : ${STATUTS[r.statut]}${detail}`);
  }
  if (m.resultat) lignes.push("Le résultat est prêt : utilise lire_resultat pour le lire.");
  if (m.erreur) lignes.push(`Erreur : ${m.erreur}`);
  return lignes.join("\n");
}

export const ligneMission = (m: MissionResume) => `- ${m.debut.slice(0, 10)} · ${m.titre} (${STATUTS_MISSION[m.statut]}) · nom : ${m.nom}`;

export function decrireHistorique(missions: MissionResume[]): string {
  return missions.length ? missions.slice(0, 30).map(ligneMission).join("\n") : "Aucune mission pour l'instant.";
}
