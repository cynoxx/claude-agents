// Le carnet de Max : ce qu'il retient de toi d'une conversation à l'autre (un fichier Markdown modifiable à la main).
import fs from "node:fs";
import path from "node:path";

export const FICHIER_CARNET = "carnet.md";
const ENTETE = "# Carnet de Max\n\nCe que Max a retenu. Tu peux modifier ou supprimer des lignes.\n\n";
const MAX_NOTES = 200;

const fichier = (dossier: string, nom = FICHIER_CARNET) => path.join(dossier, nom);
const estNote = (l: string) => l.startsWith("- ");
const pad = (n: number) => String(n).padStart(2, "0");
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function lignes(dossier: string, nom?: string): string[] {
  try {
    return fs.readFileSync(fichier(dossier, nom), "utf8").split("\n");
  } catch {
    return [];
  }
}

/** Les notes du carnet (les 200 plus récentes), telles qu'écrites. `nom` : un autre carnet (ceux des conseillers). */
export function lireCarnet(dossier: string, nom?: string): string[] {
  return lignes(dossier, nom).filter(estNote).slice(-MAX_NOTES);
}

/** Ajoute une note datée ; renvoie la ligne écrite. */
export function memoriser(dossier: string, note: string, date = new Date(), nom = FICHIER_CARNET, entete = ENTETE): string {
  const texte = note.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!texte) throw new Error("La note est vide.");
  const ligne = `- [${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}] ${texte}`;
  fs.mkdirSync(dossier, { recursive: true });
  if (!fs.existsSync(fichier(dossier, nom))) fs.writeFileSync(fichier(dossier, nom), entete);
  fs.appendFileSync(fichier(dossier, nom), ligne + "\n");
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
