// La voix XTTS v2 de Max : une voix neuronale très naturelle qui tourne sur le Mac, sans internet ni abonnement
// (`npm run voix-xtts`). Même mécanique que Piper : un processus Python allumé en continu, une phrase à la fois.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Piper } from "./piper.ts";

export const SCRIPT_XTTS = path.join(path.dirname(fileURLToPath(import.meta.url)), "xtts-serveur.py");

export interface XttsConfig {
  /** La voix intégrée à XTTS (choisie à l'oreille par `npm run voix-xtts`). */
  locuteur: string;
  /** 0,8 à 1,2. */
  vitesse: number;
  /** « cpu » (le plus sûr) ou « mps » (la puce graphique des Mac Apple, parfois plus rapide). */
  appareil: "auto" | "cpu" | "mps";
}

/** Les voix d'homme graves de XTTS à faire écouter d'abord. */
export const LOCUTEURS_GRAVES = ["Damien Black", "Viktor Menelaos", "Baldur Sanjin", "Torcull Diarmuid", "Craig Gutsy", "Viktor Eka", "Ludvig Milivoj", "Aaron Dreschner"];

/** Où vit XTTS : `<dossierDonnees>/xtts/venv` (Python), et la trace de l'accord sur la licence du modèle. */
export function cheminsXtts(dossierDonnees: string) {
  const racine = path.join(dossierDonnees, "xtts");
  return { racine, python: path.join(racine, "venv", "bin", "python"), accord: path.join(racine, "licence-acceptee"), pret: path.join(racine, "pret") };
}

/** Installé, licence acceptée et modèle téléchargé. */
export const xttsInstalle = (dossierDonnees: string) => {
  const c = cheminsXtts(dossierDonnees);
  return fs.existsSync(c.python) && fs.existsSync(c.accord) && fs.existsSync(c.pret);
};

/** Le processus XTTS. Le modèle met jusqu'à une minute à se charger : on lui laisse le temps. */
export class Xtts extends Piper {
  constructor(dossierDonnees: string, x: XttsConfig, commande?: { bin: string; args: string[] }) {
    const c = cheminsXtts(dossierDonnees);
    super({
      python: c.python,
      modele: "",
      vitesse: x.vitesse,
      commande: commande ?? { bin: c.python, args: [SCRIPT_XTTS, x.locuteur, String(x.vitesse), x.appareil, ...(fs.existsSync(c.accord) ? ["accord"] : [])] },
    });
  }

  override demarrer(delaiMs = 180_000): Promise<void> {
    return super.demarrer(delaiMs);
  }
}
