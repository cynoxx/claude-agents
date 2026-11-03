// Assemble le réveil depuis la config : Twilio, et la préparation du message (texte du jour, voix de Max, musique).
// Utilisé par le Bureau et par `npm run appel` (l'appel d'essai).
import path from "node:path";
import type { BureauConfig } from "../config.ts";
import { seance } from "../../shared/sport.ts";
import { echeances } from "./coach.ts";
import { preparerAppel, texteReveil } from "./message-reveil.ts";
import type { Musique } from "./musique.ts";
import type { Sport } from "./sport.ts";
import { Twilio } from "./twilio.ts";

export function creerTwilio(config: BureauConfig): Twilio | null {
  const t = config.reveil.twilio;
  return t.compte && t.jeton && t.numero ? new Twilio(t, { dossierDonnees: config.dossierDonnees }) : null;
}

/** La préparation de l'appel d'une heure donnée : le TwiML (voix de Max sur ta musique, sinon texte lu). */
export function preparateurReveil(o: {
  config: BureauConfig;
  twilio: Twilio | null;
  bouche: { enregistrer(texte: string, fichier: string): Promise<boolean> };
  musique: Musique;
  sport: Sport;
  profil: () => string;
  prenom: () => string;
}): (heure: Date) => Promise<string> {
  return (heure) => {
    const texte = texteReveil({
      prenom: o.prenom(),
      heure,
      echeance: echeances(o.profil(), heure)[0] ?? null,
      seance: seance(o.sport.vue(heure).prevue)?.nom ?? null,
    });
    return preparerAppel({
      texte,
      voixTwilio: o.config.reveil.voixTwilio,
      dossier: path.join(o.config.dossierDonnees, "reveil"),
      outils: {
        enregistrer: (t, f) => o.bouche.enregistrer(t, f),
        mixer: (v, d, sortie) => o.musique.mixerReveil(v, d, sortie),
        deposer: (f) => {
          if (!o.twilio) throw new Error("Twilio n'est pas configuré");
          return o.twilio.deposerAudio(f);
        },
      },
    });
  };
}
