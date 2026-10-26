// L'empreinte du visage : quelques « descripteurs » (128 nombres calculés dans la page par face-api à partir de
// l'image de la caméra). Aucune photo n'est gardée ; le fichier est lisible par l'utilisateur seul.
import fs from "node:fs";
import path from "node:path";

const FICHIER = "visage.json";
const TAILLE = 128;
/** En dessous de cette distance, c'est la même personne (face-api conseille 0,6 ; on est plus strict). */
export const SEUIL = 0.5;

export const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
const valide = (d: unknown): d is number[] => Array.isArray(d) && d.length === TAILLE && d.every((x) => typeof x === "number" && Number.isFinite(x));

interface Fichier {
  prenom: string;
  descripteurs: number[][];
  date: string;
}

export class Visage {
  private donnees: Fichier | null;

  constructor(
    private dossier: string,
    private seuil = SEUIL,
  ) {
    try {
      const f = JSON.parse(fs.readFileSync(this.fichier, "utf8")) as Fichier;
      this.donnees = Array.isArray(f.descripteurs) && f.descripteurs.every(valide) && f.descripteurs.length ? f : null;
    } catch {
      this.donnees = null;
    }
  }

  private get fichier() {
    return path.join(this.dossier, FICHIER);
  }

  get enregistre(): boolean {
    return !!this.donnees;
  }

  get prenom(): string {
    return this.donnees?.prenom ?? "";
  }

  enregistrer(descripteurs: unknown[], prenom: string): void {
    if (!Array.isArray(descripteurs) || descripteurs.length < 3 || descripteurs.length > 10) throw new Error("Il faut entre 3 et 10 prises du visage.");
    if (!descripteurs.every(valide)) throw new Error(`Chaque prise doit compter ${TAILLE} nombres.`);
    this.donnees = { prenom: prenom.replace(/\s+/g, " ").trim().slice(0, 40), descripteurs, date: new Date().toISOString() };
    fs.mkdirSync(this.dossier, { recursive: true });
    fs.writeFileSync(this.fichier, JSON.stringify(this.donnees), { mode: 0o600 });
    fs.chmodSync(this.fichier, 0o600);
  }

  /** La plus petite distance entre ce visage et l'empreinte, et si c'est assez proche. */
  comparer(d: unknown): { ok: boolean; distance: number } {
    if (!this.donnees || !valide(d)) return { ok: false, distance: Infinity };
    const min = Math.min(...this.donnees.descripteurs.map((x) => distance(x, d)));
    return { ok: min < this.seuil, distance: min };
  }

  effacer(): void {
    this.donnees = null;
    fs.rmSync(this.fichier, { force: true });
  }
}
