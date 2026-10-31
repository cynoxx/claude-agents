// Modifier quelques cases d'un fichier .xlsx SANS le réécrire : on ouvre l'archive, on change seulement ces cellules
// dans le XML de la feuille, et on referme. Tout le reste (graphiques, couleurs, formules, mise en forme
// conditionnelle) reste exactement comme dans ton fichier. (Les bibliothèques qui réécrivent le classeur perdent les
// graphiques.)
import fs from "node:fs";
import JSZip from "jszip";

export type ValeurCase = "x" | number | null;

/** Le numéro de série Excel d'une date AAAA-MM-JJ (jours depuis le 30/12/1899). */
export function serialExcel(jour: string): number {
  return Math.round((Date.UTC(+jour.slice(0, 4), +jour.slice(5, 7) - 1, +jour.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const desechapper = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const colonneNum = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

/** La ligne dont la colonne A vaut ce numéro de date, ou null. */
export function trouverLigne(xml: string, serial: number): number | null {
  const m = new RegExp(`<c r="A(\\d+)"[^>]*>\\s*<v>${serial}</v>`).exec(xml);
  return m ? Number(m[1]) : null;
}

function cellule(ref: string, ancien: string | null, valeur: ValeurCase): string {
  const style = /\ss="(\d+)"/.exec(ancien ?? "")?.[1];
  const s = style ? ` s="${style}"` : "";
  if (valeur === null) return `<c r="${ref}"${s}/>`;
  if (valeur === "x") return `<c r="${ref}"${s} t="inlineStr"><is><t>x</t></is></c>`;
  return `<c r="${ref}"${s} t="n"><v>${valeur}</v></c>`;
}

/** Pose une valeur dans une cellule du XML d'une feuille (en gardant le style de la cellule). */
export function poserCellule(xml: string, ref: string, valeur: ValeurCase): string {
  const ligne = Number(ref.replace(/\D/g, ""));
  const debut = xml.search(new RegExp(`<row r="${ligne}"[\\s>/]`));
  if (debut < 0) return xml; // la ligne n'existe pas dans ce fichier : on n'invente rien
  const finOuverture = xml.indexOf(">", debut);
  const autoFermee = xml[finOuverture - 1] === "/";
  let ouverture = xml.slice(debut, finOuverture + 1);
  let contenu = "";
  let fin = finOuverture + 1;
  if (autoFermee) ouverture = ouverture.slice(0, -2) + ">";
  else {
    const f = xml.indexOf("</row>", finOuverture);
    contenu = xml.slice(finOuverture + 1, f);
    fin = f + "</row>".length;
  }
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  const m = re.exec(contenu);
  if (m) contenu = contenu.slice(0, m.index) + cellule(ref, m[0], valeur) + contenu.slice(m.index + m[0].length);
  else {
    // une nouvelle cellule, à sa place dans l'ordre des colonnes
    const n = colonneNum(ref);
    const cellules = [...contenu.matchAll(/<c r="([A-Z]+)\d+"/g)];
    const apres = cellules.find((c) => colonneNum(c[1]) > n);
    contenu = apres ? contenu.slice(0, apres.index) + cellule(ref, null, valeur) + contenu.slice(apres.index) : contenu + cellule(ref, null, valeur);
  }
  return xml.slice(0, debut) + ouverture + contenu + "</row>" + xml.slice(fin);
}

/** Le chemin (dans l'archive) du XML d'une feuille, par son nom. */
export async function cheminFeuille(zip: JSZip, nom: string): Promise<string | null> {
  const wb = await zip.file("xl/workbook.xml")?.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wb || !rels) return null;
  const feuille = [...wb.matchAll(/<sheet\s[^>]*>/g)].map((m) => m[0]).find((t) => desechapper(/\sname="([^"]*)"/.exec(t)?.[1] ?? "") === nom);
  const id = feuille && /r:id="([^"]+)"/.exec(feuille)?.[1];
  const cible = id && new RegExp(`<Relationship\\s[^>]*Id="${id}"[^>]*>`).exec(rels)?.[0].match(/Target="([^"]+)"/)?.[1];
  return cible ? `xl/${cible.replace(/^\/?(xl\/)?/, "")}` : null;
}

export async function nomsFeuilles(fichier: string): Promise<string[]> {
  const zip = await JSZip.loadAsync(fs.readFileSync(fichier), { createFolders: false });
  const wb = (await zip.file("xl/workbook.xml")?.async("string")) ?? "";
  return [...wb.matchAll(/<sheet\s+(?:[^>]*?\s)?name="([^"]*)"/g)].map((m) => desechapper(m[1]));
}

/**
 * Applique des changements de cases à une feuille. `modifs` : [cellule, valeur]. Exige les lignes existantes ; les
 * formules sont recalculées par Excel à l'ouverture (fullCalcOnLoad).
 */
export async function patcherFeuille(fichier: string, feuille: string, modifs: { ref: string; valeur: ValeurCase }[]): Promise<void> {
  const zip = await JSZip.loadAsync(fs.readFileSync(fichier), { createFolders: false });
  const chemin = await cheminFeuille(zip, feuille);
  if (!chemin || !zip.file(chemin)) throw new Error(`feuille « ${feuille} » introuvable`);
  let xml = await zip.file(chemin)!.async("string");
  for (const m of modifs) xml = poserCellule(xml, m.ref, m.valeur);
  zip.file(chemin, xml);
  // Excel recalcule les scores à l'ouverture (les valeurs gardées en mémoire dans le fichier sont celles d'avant)
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  if (!/fullCalcOnLoad/.test(wb)) zip.file("xl/workbook.xml", /<calcPr[^>]*\/>/.test(wb) ? wb.replace(/<calcPr/, '<calcPr fullCalcOnLoad="1"') : wb.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>'));
  const sortie = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  // on écrit d'abord à côté, puis on remplace : jamais de fichier à moitié écrit
  const tmp = `${fichier}.max-tmp`;
  fs.writeFileSync(tmp, sortie);
  fs.renameSync(tmp, fichier);
}

