// La bouche de Max telle que la config la demande : la voix humaine ElevenLabs si une voix est choisie, sinon XTTS
// s'il est installé (les deux avec Piper puis `say` en secours), sinon Piper s'il est installé (ou imposé), sinon
// `say`.
import os from "node:os";
import path from "node:path";
import type { BureauConfig } from "../config.ts";
import { Bouche, type PiperLike } from "./bouche.ts";
import { AvecSecours, ElevenLabs, SayVersFichier, cleElevenLabs } from "./elevenlabs.ts";
import { Piper, cheminsPiper, piperInstalle } from "./piper.ts";
import { Xtts, xttsInstalle } from "./xtts.ts";

/** Quel moteur la config demande-t-elle ? */
export function moteurVoix(config: BureauConfig): "elevenlabs" | "xtts" | "piper" | "say" {
  const v = config.voix;
  if (v.moteur !== "auto") return v.moteur;
  if (cleElevenLabs(v.elevenlabs) && v.elevenlabs.voix) return "elevenlabs";
  if (xttsInstalle(config.dossierDonnees)) return "xtts";
  return piperInstalle(config.dossierDonnees, v.voixPiper) ? "piper" : "say";
}

const milliers = (n: number) => n.toLocaleString("fr-FR");

export function creerBouche(config: BureauConfig, journal: (m: string) => void = console.log): Bouche {
  const v = config.voix;
  const moteur = moteurVoix(config);
  const c = cheminsPiper(config.dossierDonnees, v.voixPiper);
  const piper = () => new Piper({ python: c.python, modele: c.modele, vitesse: v.vitessePiper });
  const base = { bin: v.say, voix: v.voixMac, debit: v.debit };
  const dossier = path.join(os.tmpdir(), "bureau-voix");
  if (moteur === "elevenlabs") {
    const el = new ElevenLabs(v.elevenlabs, { dossierCache: path.join(config.dossierDonnees, "voix-cache") });
    const secours: PiperLike[] = [...(piperInstalle(config.dossierDonnees, v.voixPiper) ? [piper()] : []), new SayVersFichier(base)];
    const avec = new AvecSecours(el, secours, { journal });
    return new Bouche({
      ...base,
      piper: {
        moteur: avec,
        lecteur: "afplay",
        dossier,
        nom: el.nom,
        ton: (obscur) => el.changerTon(obscur),
        decrire: () => {
          if (avec.panne) return `Voix : secours (ElevenLabs indisponible : ${avec.panne})`;
          const q = el.quota;
          const reste = q && q.limite ? ` · ${milliers(Math.max(0, q.limite - q.utilises))} caractères restants ce mois-ci` : "";
          return `Voix : ${el.nom} (ElevenLabs)${reste}`;
        },
      },
    });
  }
  if (moteur === "xtts") {
    const secours: PiperLike[] = [...(piperInstalle(config.dossierDonnees, v.voixPiper) ? [piper()] : []), new SayVersFichier(base)];
    // XTTS tourne sur le Mac : une phrase ratée ne l'écarte pas, seule cette phrase passe au secours
    const avec = new AvecSecours(new Xtts(config.dossierDonnees, v.xtts), secours, { journal, pauseMs: 0 });
    return new Bouche({
      ...base,
      piper: {
        moteur: avec,
        lecteur: "afplay",
        dossier,
        nom: v.xtts.locuteur,
        cache: path.join(config.dossierDonnees, "voix-cache", "phrases"),
        decrire: () => (avec.panne ? `Voix : secours (XTTS indisponible : ${avec.panne})` : `Voix : ${v.xtts.locuteur} (XTTS, sur ton Mac)`),
      },
    });
  }
  return new Bouche({
    ...base,
    ...(moteur === "piper" ? { piper: { moteur: piper(), lecteur: "afplay", dossier, nom: v.voixPiper } } : {}),
  });
}
