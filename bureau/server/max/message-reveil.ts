// Le message de l'appel du réveil : ce que Max dit (sa voix, sur ta musique), préparé 10 minutes avant l'appel.
// Si quelque chose manque (voix, musique, dépôt chez Twilio), l'appel lit le texte avec une voix de Twilio.
import fs from "node:fs";
import path from "node:path";
import { twimlReveil } from "./twilio.ts";

export const RELANCE_REVEIL = "Allez, debout ! Si tu raccroches trop vite, je te rappelle dans cinq minutes.";

const nombre = (n: number) => String(n);

/** Ce que Max te dit au réveil : l'heure, ton échéance, ta séance du jour, et de quoi te lever. */
export function texteReveil(o: { prenom?: string; heure: Date; echeance?: { nom: string; jours: number } | null; seance?: string | null }): string {
  const h = o.heure.getHours();
  const m = o.heure.getMinutes();
  const lignes = [
    `Debout${o.prenom ? ` ${o.prenom}` : ""} ! C'est Max. Il est ${nombre(h)} heure${h > 1 ? "s" : ""}${m ? ` ${nombre(m)}` : ""}.`,
  ];
  if (o.echeance) lignes.push(o.echeance.jours === 0 ? `C'est aujourd'hui : ${o.echeance.nom}. Tu es prêt.` : `Plus que ${nombre(o.echeance.jours)} jours avant ${o.echeance.nom}. Chaque matin compte.`);
  if (o.seance) lignes.push(o.seance === "Repos" ? "Aujourd'hui, c'est repos côté sport." : `Aujourd'hui, séance ${o.seance}.`);
  lignes.push("Pieds par terre, ouvre les volets et bois un grand verre d'eau. Je t'attends sur le Mac pour lancer la journée.");
  return lignes.join(" ");
}

/** La durée d'un fichier WAV (en secondes), lue dans son en-tête ; 0 si illisible. */
export function dureeWav(fichier: string): number {
  try {
    const b = fs.readFileSync(fichier);
    if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return 0;
    let octetsParSeconde = 0;
    for (let i = 12; i + 8 <= b.length; ) {
      const id = b.toString("ascii", i, i + 4);
      const taille = b.readUInt32LE(i + 4);
      if (id === "fmt ") octetsParSeconde = b.readUInt32LE(i + 16);
      // un WAV écrit en flux peut annoncer une taille de données nulle ou fausse : on prend ce qui reste
      if (id === "data") return octetsParSeconde ? Math.min(taille || Infinity, b.length - i - 8) / octetsParSeconde : 0;
      i += 8 + taille + (taille % 2);
    }
  } catch {
    // fichier absent
  }
  return 0;
}

export interface OutilsMessage {
  /** La voix de Max dans un fichier WAV (false si impossible). */
  enregistrer(texte: string, fichier: string): Promise<boolean>;
  /** La voix sur la musique, en MP3 (null sans musique). */
  mixer(voix: string, duree: number, sortie: string): Promise<string | null>;
  /** Dépose le MP3 chez Twilio et renvoie son adresse. */
  deposer(fichier: string): Promise<string>;
}

/** Prépare le TwiML de l'appel : la voix de Max sur ta musique si tout marche, sinon le texte lu par Twilio. */
export async function preparerAppel(o: { texte: string; voixTwilio: string; dossier: string; outils: OutilsMessage }): Promise<string> {
  let audio: string | null = null;
  try {
    fs.mkdirSync(o.dossier, { recursive: true });
    const wav = path.join(o.dossier, "reveil-voix.wav");
    if (await o.outils.enregistrer(o.texte, wav)) {
      const mp3 = await o.outils.mixer(wav, dureeWav(wav), path.join(o.dossier, "reveil.mp3"));
      if (mp3) audio = await o.outils.deposer(mp3);
    }
  } catch {
    audio = null;
  }
  return twimlReveil({ audio, texte: o.texte, voix: o.voixTwilio, relance: RELANCE_REVEIL });
}
