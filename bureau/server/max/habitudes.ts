// Le suivi d'habitudes dans Excel, comme au début de médecine : un fichier .xlsx avec une feuille par mois, les
// habitudes en lignes, les jours en colonnes. Max remplit les cases tout seul à partir de ce qu'il sait (tes 3 règles,
// tes blocs de médecine, ta séance de sport) et de ce que tu lui dis (« j'ai prié », « créatine prise »). Il ne touche
// qu'aux cases qu'il connaît : tes propres modifications dans le fichier restent.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { jourDe } from "./coach.ts";

export interface Habitude {
  id: string;
  nom: string;
  /** « case » : ✓ ; « nombre » : une quantité (blocs). */
  type: "case" | "nombre";
}

export const HABITUDES: Habitude[] = [
  { id: "lever", nom: "Levé à l'heure, téléphone hors de la chambre", type: "case" },
  { id: "bloc", nom: "Premier bloc de médecine avant les réseaux", type: "case" },
  { id: "coucher", nom: "Couché à l'heure, sans écran au lit", type: "case" },
  { id: "blocs", nom: "Blocs de médecine (50 min)", type: "nombre" },
  { id: "sport", nom: "Salle / sport", type: "case" },
  { id: "priere", nom: "Prière", type: "case" },
  { id: "creatine", nom: "Créatine", type: "case" },
  { id: "business", nom: "Business (1 h max)", type: "case" },
  { id: "famille", nom: "Appel à la famille", type: "case" },
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
    (this.valeurs[jour] ??= {})[h.id] = h.type === "nombre" ? Math.max(0, Math.round(Number(valeur) || 0)) : valeur !== false && valeur !== 0;
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

  private async ecrireFichier(jourCible: string): Promise<Reponse> {
    try {
      fs.mkdirSync(path.dirname(this.json), { recursive: true });
      fs.writeFileSync(this.json, JSON.stringify(this.valeurs, null, 2) + "\n");
      fs.mkdirSync(path.dirname(this.o.fichier), { recursive: true });
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

/** 1 → A, 27 → AA. */
function colonne(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
