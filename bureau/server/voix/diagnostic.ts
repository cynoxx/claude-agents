// Prépare l'oreille de Max, ou explique ce qui manque pour qu'elle marche.
import { execFile } from "node:child_process";
import fs from "node:fs";
import type { Dispo } from "../../shared/protocol.ts";
import type { BureauConfig } from "../config.ts";
import { choisirMicro } from "./micro.ts";
import { Oreille, argsFfmpegMicro } from "./oreille.ts";
import { transcrire } from "./whisper.ts";

/** Lance une commande ; renvoie sa sortie (stdout + stderr), ou null si le programme n'existe pas. */
function sortie(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) =>
    execFile(bin, args, { timeout: 15_000 }, (e, stdout, stderr) => {
      if ((e as NodeJS.ErrnoException | null)?.code === "ENOENT") return resolve(null);
      resolve(`${stdout}\n${stderr}`);
    }),
  );
}

/** La liste des micros vue par ffmpeg (elle s'affiche sur stderr). */
export function listeFfmpeg(ffmpeg: string): Promise<string | null> {
  return sortie(ffmpeg, ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);
}

export async function preparerOreille(config: BureauConfig): Promise<{ oreille: Oreille | null; dispo: Dispo }> {
  const v = config.voix;
  const sans = (detail: string) => ({ oreille: null, dispo: { ok: false, detail } });
  if (!v.active) return sans("Micro désactivé (voix.active dans bureau.config.json). Tu peux écrire à Max.");
  if (process.platform !== "darwin" && !v.micro) return sans("Le micro de Max ne marche que sur Mac. Tu peux écrire à Max.");
  if ((await sortie(v.ffmpeg, ["-version"])) === null) return sans("ffmpeg introuvable : installe-le avec « brew install ffmpeg », puis relance le Bureau.");
  if ((await sortie(v.whisper, ["--help"])) === null) return sans("whisper-cli introuvable : installe-le avec « brew install whisper-cpp », puis relance le Bureau.");
  const modele = v.modele!;
  if (!fs.existsSync(modele)) return sans("Modèle Whisper absent : lance « npm run modele » (environ 550 Mo), puis relance le Bureau.");

  const micro = v.micro ?? choisirMicro((await listeFfmpeg(v.ffmpeg)) ?? "");
  if (!micro) return sans("Aucun micro trouvé. Branche un micro ou vérifie les réglages Son du Mac.");

  const oreille = new Oreille({
    commande: { bin: v.ffmpeg, args: argsFfmpegMicro(micro) },
    // choisi automatiquement : on le recherche à chaque démarrage (son numéro bouge quand l'iPhone est à côté)
    ...(v.micro
      ? {}
      : {
          resoudre: async () => {
            const m = choisirMicro((await listeFfmpeg(v.ffmpeg)) ?? "");
            return m ? { bin: v.ffmpeg, args: argsFfmpegMicro(m) } : null;
          },
        }),
    transcrire: (wav) => transcrire({ bin: v.whisper, modele }, wav),
  });
  return { oreille, dispo: { ok: true, detail: `Micro : ${micro}` } };
}
