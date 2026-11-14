// Johan a quitté le PASS : ce que Max avait gardé de cette époque (le projet de départ, les anciennes sanctions)
// est remis à jour à la lecture, pour que l'écran ne parle plus de médecine. Ses propres projets ne sont pas touchés.
import type { ProjetVie } from "../../shared/protocol.js";

/** « bloc de médecine » devient « bloc d'études » dans un texte gardé par Max. */
export const sansMedecine = (texte: string): string =>
  texte.replace(/\b([Bb]locs?) de médecine/g, "$1 d'études").replace(/\b([Hh]eures?) de médecine/g, "$1 d'études");

/** Le projet d'études de départ et la catégorie « PASS » passent aux études d'aujourd'hui. */
export function sansPass(projets: ProjetVie[]): ProjetVie[] {
  return projets.map((p) => {
    if (p.domaine !== "etudes") return p;
    const q = { ...p };
    if (/^pass$/i.test(q.categorie ?? "")) q.categorie = "Cours";
    if (/\bPASS\b/.test(q.nom)) {
      q.nom = "Réussir mon année";
      q.prochaineAction = "Caler les révisions de la semaine jusqu'au prochain examen";
    }
    return q;
  });
}
