// `npm run appel` : un appel d'essai du réveil, tout de suite, pour vérifier ton numéro, Twilio, la voix et la musique.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { lireProfil } from "./max/coach.ts";
import { Musique } from "./max/musique.ts";
import { creerTwilio, preparateurReveil } from "./max/reveil-montage.ts";
import { Sport } from "./max/sport.ts";
import { STATUTS_FINAUX } from "./max/twilio.ts";
import { estReveille } from "./max/reveil.ts";
import { creerBouche } from "./voix/voix-config.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const twilio = creerTwilio(config);
if (!config.reveil.telephone || !twilio) {
  console.log("✘ Le réveil par appel n'est pas configuré : mets ton numéro et ton compte Twilio dans « reveil » de bureau.config.json (voir le README, section « Le réveil »).");
  process.exit(1);
}
const bouche = creerBouche(config);
console.log("… préparation de la voix de Max");
await bouche.preparer();
const musique = new Musique({ source: config.musique.fichier, recherche: config.musique.recherche, dossier: path.join(config.dossierDonnees, "musique"), ffmpeg: config.voix.ffmpeg, lecteur: null });
await musique.chercher();
console.log(musique.disponible ? `✔ Musique : ${config.musique.fichier}` : `⚠️  Pas de musique (${config.musique.fichier} introuvable) : l'appel sera lu par une voix Twilio.`);
const preparer = preparateurReveil({ config, twilio, bouche, musique, sport: new Sport({ dossier: config.dossierMissions }), profil: () => lireProfil(config.dossierMissions), prenom: () => "" });
console.log("… préparation du message (voix + musique, envoi chez Twilio)");
const twiml = await preparer(new Date());
bouche.arreter();
console.log(twiml.includes("<Play>") ? "✔ Message prêt : la voix de Max sur ta musique." : "⚠️  Message lu par une voix Twilio (la voix de Max ou la musique n'a pas pu être préparée).");
try {
  const sid = await twilio.appeler(config.reveil.telephone, twiml);
  console.log(`📞 Appel en cours vers ${config.reveil.telephone}… décroche !`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const e = await twilio.etat(sid);
    if (STATUTS_FINAUX.has(e.statut)) {
      console.log(`Fin de l'appel : ${e.statut}, ${e.duree} s${e.reponduPar ? `, répondu par : ${e.reponduPar}` : ""}.`);
      console.log(estReveille(e) ? "✔ Le Bureau t'aurait considéré réveillé." : "→ Le Bureau t'aurait rappelé dans 5 minutes (pas décroché, messagerie, ou raccroché avant 20 s).");
      break;
    }
  }
} catch (e) {
  console.log(`✘ ${(e as Error).message}`);
  process.exit(1);
}
