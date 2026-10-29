// Le suivi d'habitudes dans Excel, comme au début de médecine : un fichier .xlsx avec une feuille par mois, les
// habitudes en lignes, les jours en colonnes. Max remplit les cases tout seul à partir de ce qu'il sait (tes 3 règles,
// tes blocs de médecine, ta séance de sport) et de ce que tu lui dis (« j'ai prié », « créatine prise »). Il ne touche
// qu'aux cases qu'il connaît : tes propres modifications dans le fichier restent.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { jourDe } from "./coach.ts";
import { nomsFeuilles, patcherFeuille, serialExcel, type ValeurCase } from "./xlsx-patch.ts";

export interface Habitude {
  id: string;
  nom: string;
  /** « case » : ✓ ; « nombre » : une quantité (blocs). */
  type: "case" | "nombre";
  /** Comment reconnaître cette habitude dans TON fichier (par le nom de ta ligne). */
  motif?: RegExp;
}

export const HABITUDES: Habitude[] = [
  { id: "lever", nom: "Levé à l'heure, téléphone hors de la chambre", type: "case", motif: /r[ée]veil|lev[ée]/i },
  { id: "bloc", nom: "Premier bloc de médecine avant les réseaux", type: "case" },
  { id: "coucher", nom: "Couché à l'heure, sans écran au lit", type: "case", motif: /coucher|dormir/i },
  { id: "blocs", nom: "Blocs de médecine (50 min)", type: "nombre", motif: /m[ée]decine|[ée]tude|r[ée]vis|cours/i },
  { id: "sport", nom: "Salle / sport", type: "case", motif: /boxe|muscu|sport|salle|entra[iî]n/i },
  { id: "priere", nom: "Prière", type: "case", motif: /pri[èe]re|dieu/i },
  { id: "abdos", nom: "Abdos du matin", type: "case", motif: /abdo/i },
  { id: "planif", nom: "Planification de la journée", type: "case", motif: /planif/i },
  { id: "etirements", nom: "Étirements", type: "case", motif: /[ée]tir/i },
  { id: "creatine", nom: "Créatine", type: "case", motif: /cr[ée]atine/i },
  { id: "business", nom: "Business / projets annexes (heures)", type: "nombre", motif: /annexe|business|projet/i },
  { id: "famille", nom: "Appel à la famille", type: "case", motif: /famille|appel/i },
];

const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export type Valeur = boolean | number;

/** Ce que Max sait sans qu'on le lui dise. */
export interface Sources {
  regles: () => { lever: boolean; bloc: boolean; coucher: boolean };
  /** Blocs de 50 min travaillés aujourd'hui. */
  blocs: () => number;
  /** Une vraie séance de sport faite aujourd'hui. */
  sport: () => boolean;
}

interface Reponse {
  ok: boolean;
  texte: string;
}

export const nomFeuille = (jour: string) => `${MOIS[Number(jour.slice(5, 7)) - 1]} ${jour.slice(0, 4)}`;
const joursDuMois = (jour: string) => new Date(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)), 0).getDate();

export class Habitudes extends EventEmitter {
  private valeurs: Record<string, Record<string, Valeur>> = {};
  private file: Promise<void> = Promise.resolve();
  private minuterie?: NodeJS.Timeout;
  private readonly json: string;

  constructor(private o: { fichier: string; dossier: string; sources: Sources; maintenant?: () => Date }) {
    super();
    this.json = path.join(o.dossier, "vie", "habitudes.json");
    try {
      this.valeurs = JSON.parse(fs.readFileSync(this.json, "utf8"));
    } catch {
      this.valeurs = {};
    }
  }

  get fichier(): string {
    return this.o.fichier;
  }

  private get aujourdhui(): string {
    return jourDe(this.o.maintenant?.() ?? new Date());
  }

  private trouver(cle: string): Habitude | undefined {
    const c = sansAccents(cle);
    return HABITUDES.find((h) => h.id === cle) ?? HABITUDES.find((h) => sansAccents(h.nom).includes(c) || c.includes(h.id));
  }

  /** Demande une mise à jour du fichier dans quelques secondes (les changements rapprochés se regroupent). */
  planifier(delaiMs = 4000): void {
    clearTimeout(this.minuterie);
    this.minuterie = setTimeout(() => void this.synchroniser(), delaiMs);
  }

  /** Reprend ce que Max sait d'aujourd'hui, puis écrit le fichier. */
  async synchroniser(): Promise<Reponse> {
    const j = this.aujourdhui;
    const v = (this.valeurs[j] ??= {});
    const r = this.o.sources.regles();
    // les règles cochées sur l'écran remplissent leurs cases ; décochées, elles ne vident pas une case que tu as mise toi-même
    for (const id of ["lever", "bloc", "coucher"] as const) if (r[id]) v[id] = true;
    const blocs = this.o.sources.blocs();
    if (blocs > 0) v.blocs = Math.max(Number(v.blocs ?? 0), blocs);
    if (this.o.sources.sport()) v.sport = true;
    return this.ecrire();
  }

  /** Note une habitude à la main (« j'ai prié ») et met le fichier à jour. */
  async noter(cle: string, valeur: Valeur = true, jour = this.aujourdhui): Promise<Reponse> {
    const h = this.trouver(cle);
    if (!h) return { ok: false, texte: `Habitude inconnue : ${cle}. Il y a : ${HABITUDES.map((x) => x.id).join(", ")}.` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return { ok: false, texte: "Jour au format AAAA-MM-JJ." };
    (this.valeurs[jour] ??= {})[h.id] = h.type === "nombre" ? Math.max(0, h.id === "blocs" ? Math.round(Number(valeur) || 0) : Math.round((Number(valeur) || 0) * 10) / 10) : valeur !== false && valeur !== 0;
    const r = await this.ecrire(jour);
    return r.ok ? { ok: true, texte: `${h.nom} : ${this.valeurs[jour][h.id] === true ? "✓" : this.valeurs[jour][h.id] === false ? "décochée" : this.valeurs[jour][h.id]} le ${jour}.` } : r;
  }

  private ecrire(jour = this.aujourdhui): Promise<Reponse> {
    const tache = this.file.then(() => this.ecrireFichier(jour));
    this.file = tache.then(
      () => undefined,
      () => undefined,
    );
    return tache;
  }

  /** Ton propre fichier (feuilles « Mes habitudes » et « Suivi ») : on ne change que les cases du jour. */
  private async ecrireDansTonFichier(jours: string[]): Promise<Reponse> {
    const classeur = new ExcelJS.Workbook();
    await classeur.xlsx.readFile(this.o.fichier); // lecture seule : le fichier n'est pas réécrit par cette bibliothèque
    const liste = classeur.getWorksheet("Mes habitudes")!;
    // tes habitudes : ligne 5 à 16, nom en C, type en D (Case / Min / Max), colonnes D à O dans « Suivi »
    const tes: { col: string; nom: string; type: string }[] = [];
    for (let l = 5; l <= 16; l++) {
      const nom = String(liste.getCell(`C${l}`).value ?? "").trim();
      if (nom) tes.push({ col: String.fromCharCode(68 + (l - 5)), nom, type: String(liste.getCell(`D${l}`).value ?? "Case").trim() });
    }
    const modifs: { ref: string; valeur: ValeurCase }[] = [];
    const xml = await ligneParJour(this.o.fichier, jours);
    for (const j of jours) {
      const ligne = xml.get(j);
      if (!ligne) continue; // ce jour n'est pas dans ton tableau
      const vus = new Set<string>();
      for (const h of HABITUDES) {
        const v = this.valeurs[j]?.[h.id];
        if (v === undefined || !h.motif) continue;
        const cible = tes.find((t) => !vus.has(t.col) && h.motif!.test(t.nom));
        if (!cible) continue; // pas dans ton fichier : Max la garde pour lui
        vus.add(cible.col);
        const numerique = /^(min|max)$/i.test(cible.type);
        let valeur: ValeurCase;
        if (numerique) {
          // en heures : un bloc = 50 minutes
          const nombre = h.id === "blocs" ? Math.round(((Number(v) * 50) / 60) * 10) / 10 : typeof v === "number" ? v : v ? 1 : 0;
          valeur = nombre > 0 ? nombre : null;
        } else valeur = v === true || (typeof v === "number" && v > 0) ? "x" : null;
        modifs.push({ ref: `${cible.col}${ligne}`, valeur });
      }
    }
    if (!modifs.length) return { ok: true, texte: "Rien à écrire pour l'instant." };
    // une copie de sécurité, une seule fois, avant la première modification
    const copie = this.o.fichier.replace(/\.xlsx$/i, ".avant-max.xlsx");
    if (!fs.existsSync(copie)) fs.copyFileSync(this.o.fichier, copie);
    await patcherFeuille(this.o.fichier, "Suivi", modifs);
    this.emit("etat");
    return { ok: true, texte: "Suivi mis à jour dans ton fichier." };
  }

  private async ecrireFichier(jourCible: string): Promise<Reponse> {
    try {
      fs.mkdirSync(path.dirname(this.json), { recursive: true });
      fs.writeFileSync(this.json, JSON.stringify(this.valeurs, null, 2) + "\n");
      fs.mkdirSync(path.dirname(this.o.fichier), { recursive: true });
      if (fs.existsSync(this.o.fichier)) {
        const feuilles = await nomsFeuilles(this.o.fichier).catch(() => [] as string[]);
        if (feuilles.includes("Suivi") && feuilles.includes("Mes habitudes")) return await this.ecrireDansTonFichier([...new Set([jourCible, this.aujourdhui])]);
      }
      const classeur = new ExcelJS.Workbook();
      if (fs.existsSync(this.o.fichier)) await classeur.xlsx.readFile(this.o.fichier);
      // les mois qui ont des valeurs (le mois de la case modifiée, et celui d'aujourd'hui)
      const mois = new Set([jourCible.slice(0, 7), this.aujourdhui.slice(0, 7)]);
      for (const m of mois) this.remplirFeuille(classeur, `${m}-01`, Object.keys(this.valeurs).filter((j) => j.startsWith(m)));
      await classeur.xlsx.writeFile(this.o.fichier);
      this.emit("etat");
      return { ok: true, texte: "Suivi mis à jour." };
    } catch (e) {
      const m = (e as Error).message;
      return { ok: false, texte: /EBUSY|EACCES|EPERM/i.test(m) ? "Le fichier Excel est verrouillé (ouvert ailleurs ?) : je réessaierai." : `Excel : ${m}` };
    }
  }

  private remplirFeuille(classeur: ExcelJS.Workbook, premierJour: string, jours: string[]): void {
    const nom = nomFeuille(premierJour);
    const nb = joursDuMois(premierJour);
    let f = classeur.getWorksheet(nom);
    if (!f) {
      f = classeur.addWorksheet(nom, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
      f.getColumn(1).width = 44;
      const en = f.getRow(1);
      en.getCell(1).value = nom;
      for (let d = 1; d <= nb; d++) {
        const c = en.getCell(1 + d);
        c.value = d;
        c.alignment = { horizontal: "center" };
        f.getColumn(1 + d).width = 4.5;
      }
      const tot = en.getCell(2 + nb);
      tot.value = "Total";
      f.getColumn(2 + nb).width = 8;
      en.font = { bold: true };
      en.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E3F7" } };
    }
    for (const h of HABITUDES) {
      let ligne = 0;
      f.getColumn(1).eachCell((c, n) => {
        if (n > 1 && String(c.value ?? "") === h.nom) ligne = n;
      });
      if (!ligne) {
        ligne = Math.max(2, f.rowCount + 1);
        f.getRow(ligne).getCell(1).value = h.nom;
        const t = f.getRow(ligne).getCell(2 + nb);
        t.value = h.type === "nombre" ? { formula: `SUM(B${ligne}:${colonne(1 + nb)}${ligne})`, result: 0 } : { formula: `COUNTA(B${ligne}:${colonne(1 + nb)}${ligne})`, result: 0 };
        t.font = { bold: true };
      }
      for (const j of jours) {
        const val = this.valeurs[j]?.[h.id];
        if (val === undefined) continue;
        const c = f.getRow(ligne).getCell(1 + Number(j.slice(8, 10)));
        c.value = h.type === "nombre" ? (val as number) || null : val === true ? "✓" : null;
        c.alignment = { horizontal: "center" };
      }
    }
  }

  /** Les cases d'aujourd'hui, pour l'écran et pour Max. */
  vue(): { fichier: string; jour: string; cases: { id: string; nom: string; valeur: Valeur | null }[]; existe: boolean } {
    const j = this.aujourdhui;
    return { fichier: this.o.fichier, jour: j, existe: fs.existsSync(this.o.fichier), cases: HABITUDES.map((h) => ({ id: h.id, nom: h.nom, valeur: this.valeurs[j]?.[h.id] ?? null })) };
  }

  decrire(): string {
    const v = this.vue();
    const faites = v.cases.filter((c) => c.valeur && c.valeur !== 0).map((c) => (typeof c.valeur === "number" ? `${c.nom} (${c.valeur})` : c.nom));
    return `Suivi d'habitudes Excel (tu le remplis toi-même avec habitude_du_jour) : cochées aujourd'hui : ${faites.join(" ; ") || "aucune"}.`;
  }
}

/** Pour chaque jour demandé, la ligne de la feuille « Suivi » qui le porte (la colonne A contient la date). */
async function ligneParJour(fichier: string, jours: string[]): Promise<Map<string, number>> {
  const { default: JSZip } = await import("jszip");
  const { cheminFeuille, trouverLigne } = await import("./xlsx-patch.ts");
  const zip = await JSZip.loadAsync(fs.readFileSync(fichier), { createFolders: false });
  const chemin = await cheminFeuille(zip, "Suivi");
  const xml = chemin ? ((await zip.file(chemin)?.async("string")) ?? "") : "";
  const out = new Map<string, number>();
  for (const j of jours) {
    const l = trouverLigne(xml, serialExcel(j));
    if (l) out.set(j, l);
  }
  return out;
}

/**
 * Retrouve ton tableau d'habitudes s'il n'est pas à sa place (Téléchargements, Bureau, Documents, iCloud Drive) :
 * le copie à `cible` (ton fichier d'origine n'est pas touché). Renvoie d'où il vient, ou null.
 */
export function trouverTableur(cible: string, maison = os.homedir()): string | null {
  if (fs.existsSync(cible)) return cible;
  const motif = /suivi.?habitudes.*\.xlsx$/i;
  const lieux = ["Downloads", "Desktop", "Documents", path.join("Library", "Mobile Documents", "com~apple~CloudDocs")].map((d) => path.join(maison, d));
  const trouves: string[] = [];
  for (const dossier of lieux) {
    try {
      for (const n of fs.readdirSync(dossier)) if (motif.test(n) && !/avant-max|max-tmp/i.test(n)) trouves.push(path.join(dossier, n));
    } catch {
      // dossier absent : suivant
    }
  }
  trouves.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!trouves[0]) return null;
  try {
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.copyFileSync(trouves[0], cible);
  } catch {
    return null;
  }
  return trouves[0];
}

/** 1 → A, 27 → AA. */
function colonne(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
