// Le carnet de Max : ce qu'il retient de toi d'une conversation à l'autre (un fichier Markdown modifiable à la main).
import fs from "node:fs";
import path from "node:path";

export const FICHIER_CARNET = "carnet.md";
const ENTETE = "# Carnet de Max\n\nCe que Max a retenu. Tu peux modifier ou supprimer des lignes.\n\n";
const MAX_NOTES = 200;

const fichier = (dossier: string) => path.join(dossier, FICHIER_CARNET);
const estNote = (l: string) => l.startsWith("- ");
const pad = (n: number) => String(n).padStart(2, "0");
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function lignes(dossier: string): string[] {
  try {
    return fs.readFileSync(fichier(dossier), "utf8").split("\n");
  } catch {
    return [];
  }
}

/** Les notes du carnet (les 200 plus récentes), telles qu'écrites. */
export function lireCarnet(dossier: string): string[] {
  return lignes(dossier).filter(estNote).slice(-MAX_NOTES);
}

/** Ajoute une note datée ; renvoie la ligne écrite. */
export function memoriser(dossier: string, note: string, date = new Date()): string {
  const texte = note.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!texte) throw new Error("La note est vide.");
  const ligne = `- [${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}] ${texte}`;
  fs.mkdirSync(dossier, { recursive: true });
  if (!fs.existsSync(fichier(dossier))) fs.writeFileSync(fichier(dossier), ENTETE);
  fs.appendFileSync(fichier(dossier), ligne + "\n");
  return ligne;
}

/** Retire les notes qui contiennent ce texte (sans tenir compte des accents ni des majuscules) ; renvoie combien. */
export function oublier(dossier: string, texte: string): number {
  const cherche = sansAccents(texte.trim());
  if (!cherche) return 0;
  const avant = lignes(dossier);
  const apres = avant.filter((l) => !(estNote(l) && sansAccents(l).includes(cherche)));
  const retirees = avant.length - apres.length;
  if (retirees) fs.writeFileSync(fichier(dossier), apres.join("\n"));
  return retirees;
}
