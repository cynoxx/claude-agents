// Les séances de sport et les muscles qu'elles travaillent (partagé entre le serveur et la page).

export type SeanceId = "pec_dos" | "bras_epaules" | "jambes" | "repos";
export type MuscleId =
  | "pectoraux"
  | "dorsaux"
  | "trapezes"
  | "lombaires"
  | "epaules"
  | "biceps"
  | "triceps"
  | "avant_bras"
  | "abdos"
  | "quadriceps"
  | "ischios"
  | "fessiers"
  | "mollets";

export interface SeanceDef {
  id: SeanceId;
  nom: string;
  emoji: string;
  numero: number;
  muscles: MuscleId[];
}

export const SEANCES: SeanceDef[] = [
  { id: "pec_dos", nom: "Pec-Dos", emoji: "🏋️", numero: 1, muscles: ["pectoraux", "dorsaux", "trapezes", "lombaires"] },
  { id: "bras_epaules", nom: "Biceps-Triceps-Épaules", emoji: "💪", numero: 2, muscles: ["biceps", "triceps", "epaules", "avant_bras"] },
  { id: "jambes", nom: "Jambes", emoji: "🦵", numero: 3, muscles: ["quadriceps", "ischios", "fessiers", "mollets"] },
  { id: "repos", nom: "Repos", emoji: "😴", numero: 4, muscles: [] },
];

export const MUSCLES: Record<MuscleId, string> = {
  pectoraux: "Pectoraux",
  dorsaux: "Dorsaux",
  trapezes: "Trapèzes",
  lombaires: "Lombaires",
  epaules: "Épaules",
  biceps: "Biceps",
  triceps: "Triceps",
  avant_bras: "Avant-bras",
  abdos: "Abdos",
  quadriceps: "Quadriceps",
  ischios: "Ischios",
  fessiers: "Fessiers",
  mollets: "Mollets",
};

export const JOURS_SEMAINE = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Par défaut : 5 séances et 2 jours de repos (modifiable dans la fiche Sport ou en le disant à Max). */
export const SEMAINE_DEFAUT: SeanceId[] = ["pec_dos", "bras_epaules", "jambes", "repos", "pec_dos", "bras_epaules", "repos"];

export const seance = (id: string): SeanceDef | undefined => SEANCES.find((s) => s.id === id);

/** Une séance désignée par son id, son numéro ou son nom (« pec dos », « 2 », « jambes », « repos »). */
export function trouverSeance(texte: string): SeanceDef | undefined {
  const t = texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!t) return undefined;
  return SEANCES.find(
    (s) =>
      s.id.replace("_", " ") === t ||
      String(s.numero) === t ||
      `seance ${s.numero}` === t ||
      s.nom
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim() === t,
  ) ?? (/pec|dos/.test(t) ? SEANCES[0] : /bras|bicep|tricep|epaule/.test(t) ? SEANCES[1] : /jambe|squat|cuisse/.test(t) ? SEANCES[2] : /repos|off|rien/.test(t) ? SEANCES[3] : undefined);
}
