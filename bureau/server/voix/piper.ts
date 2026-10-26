// Le client de la voix Piper : un processus Python allumé en continu (le modèle se charge en 2 secondes, une
// seule fois), à qui on demande de transformer chaque phrase en fichier WAV.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LineSplitter } from "../event-translator.ts";

export const SCRIPT_PIPER = path.join(path.dirname(fileURLToPath(import.meta.url)), "piper-serveur.py");
export const VOIX_PIPER_DEFAUT = "fr_FR-tom-medium";

/** Où vit Piper sur le Mac : `<dossierDonnees>/piper/venv` (Python) et `<dossierDonnees>/piper/voix` (modèles). */
export function cheminsPiper(dossierDonnees: string, voix: string) {
  const racine = path.join(dossierDonnees, "piper");
  return {
    racine,
    python: path.join(racine, "venv", "bin", "python"),
    voix: path.join(racine, "voix"),
    modele: path.join(racine, "voix", `${voix}.onnx`),
  };
}

export const piperInstalle = (dossierDonnees: string, voix: string) => {
  const c = cheminsPiper(dossierDonnees, voix);
  return fs.existsSync(c.python) && fs.existsSync(c.modele) && fs.existsSync(`${c.modele}.json`);
};

export interface OptionsPiper {
  python: string;
  modele: string;
  vitesse: number;
  /** Pour les tests : un autre programme que `python piper-serveur.py`. */
  commande?: { bin: string; args: string[] };
}

export class Piper {
  private processus?: ChildProcess;
  private attente = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private prochainId = 1;

  constructor(private o: OptionsPiper) {}

  get actif(): boolean {
    return !!this.processus && this.processus.exitCode === null;
  }

  /** Lance le processus et attend qu'il ait chargé la voix. */
  demarrer(delaiMs = 60_000): Promise<void> {
    if (this.actif) return Promise.resolve();
    const c = this.o.commande ?? { bin: this.o.python, args: [SCRIPT_PIPER, this.o.modele, String(this.o.vitesse)] };
    return new Promise((resolve, reject) => {
      let pret = false;
      let stderr = "";
      const p = spawn(c.bin, c.args, { stdio: ["pipe", "pipe", "pipe"] });
      this.processus = p;
      const minuterie = setTimeout(() => {
        if (!pret) {
          p.kill();
          reject(new Error("Piper ne démarre pas (délai dépassé)."));
        }
      }, delaiMs);
      const lignes = new LineSplitter();
      p.stdout!.setEncoding("utf8");
      p.stdout!.on("data", (morceau: string) => {
        for (const l of lignes.push(morceau)) {
          let m: { pret?: boolean; id?: number; ok?: boolean; erreur?: string };
          try {
            m = JSON.parse(l);
          } catch {
            continue;
          }
          if (m.pret && !pret) {
            pret = true;
            clearTimeout(minuterie);
            resolve();
          } else if (typeof m.id === "number") {
            const a = this.attente.get(m.id);
            this.attente.delete(m.id);
            if (m.ok) a?.resolve();
            else a?.reject(new Error(m.erreur ?? "synthèse ratée"));
          }
        }
      });
      p.stderr!.setEncoding("utf8");
      p.stderr!.on("data", (d: string) => (stderr = (stderr + d).slice(-2000)));
      p.on("error", (e) => {
        clearTimeout(minuterie);
        reject(e);
      });
      p.on("close", () => {
        clearTimeout(minuterie);
        for (const a of this.attente.values()) a.reject(new Error("Piper s'est arrêté."));
        this.attente.clear();
        if (!pret) reject(new Error(stderr.trim().split("\n").at(-1) || "Piper s'est arrêté au démarrage."));
      });
    });
  }

  /** Écrit la phrase dite par la voix dans `fichier` (WAV). */
  synthetiser(texte: string, fichier: string): Promise<void> {
    if (!this.actif) return Promise.reject(new Error("Piper n'est pas démarré."));
    const id = this.prochainId++;
    return new Promise((resolve, reject) => {
      this.attente.set(id, { resolve, reject });
      this.processus!.stdin!.write(JSON.stringify({ id, texte, fichier }) + "\n");
    });
  }

  arreter(): void {
    this.processus?.kill();
    this.processus = undefined;
  }
}
