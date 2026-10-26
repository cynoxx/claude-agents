// La bouche de Max telle que la config la demande : Piper si installé (ou imposé), sinon `say`.
import os from "node:os";
import path from "node:path";
import type { BureauConfig } from "../config.ts";
import { Bouche } from "./bouche.ts";
import { Piper, cheminsPiper, piperInstalle } from "./piper.ts";

export function creerBouche(config: BureauConfig): Bouche {
  const v = config.voix;
  const avecPiper = v.moteur === "piper" || (v.moteur === "auto" && piperInstalle(config.dossierDonnees, v.voixPiper));
  const c = cheminsPiper(config.dossierDonnees, v.voixPiper);
  return new Bouche({
    bin: v.say,
    voix: v.voixMac,
    debit: v.debit,
    ...(avecPiper
      ? {
          piper: {
            moteur: new Piper({ python: c.python, modele: c.modele, vitesse: v.vitessePiper }),
            lecteur: "afplay",
            dossier: path.join(os.tmpdir(), "bureau-voix"),
            nom: v.voixPiper,
          },
        }
      : {}),
  });
}
