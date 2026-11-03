// `npm run voix-reference -- ~/Downloads/voix.mp3` : donne à Max une voix française de référence que XTTS imite (fini
// l'accent anglais des voix intégrées). Un extrait propre de 10 à 30 secondes, une seule personne, sans musique :
// ta voix, celle d'un proche d'accord, ou une voix que tu as le droit d'utiliser. Le fichier est converti (ffmpeg),
// rangé dans les données de Max (jamais dans git), puis Max te dit une phrase avec.
// `npm run voix-reference -- aucune` : revient aux voix intégrées.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { Xtts, cheminsXtts, xttsInstalle } from "./voix/xtts.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const c = cheminsXtts(config.dossierDonnees);
const source = process.argv[2];

const executer = (bin: string, args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(bin, args, (e, _o, err) => (e ? reject(new Error(String(err).trim().split("\n").at(-1) || e.message)) : resolve())));

async function main() {
  if (!source) {
    console.log("Usage : npm run voix-reference -- chemin/vers/un-extrait.mp3   (10 à 30 s, une voix seule, sans musique)");
    console.log("        npm run voix-reference -- aucune                        (revenir aux voix intégrées)");
    process.exit(1);
  }
  if (source === "aucune") {
    fs.rmSync(c.reference, { force: true });
    console.log("✔ Voix de référence retirée. Relance Max : npm run arreter, puis rouvre-le.");
    return;
  }
  const entree = source.replace(/^~(?=\/)/, os.homedir());
  if (!fs.existsSync(entree)) throw new Error(`Fichier introuvable : ${entree}`);
  fs.mkdirSync(c.racine, { recursive: true });
  // mono 22 kHz, silences du début retirés, 30 s au plus, volume égalisé
  const tmp = `${c.reference}.tmp.wav`;
  await executer("ffmpeg", ["-y", "-loglevel", "error", "-i", entree, "-ac", "1", "-ar", "22050", "-af", "silenceremove=start_periods=1:start_threshold=-45dB,highpass=f=70,loudnorm=I=-18:TP=-2", "-t", "30", tmp]);
  fs.renameSync(tmp, c.reference);
  console.log(`✔ Voix de référence prête (${c.reference})`);
  if (!xttsInstalle(config.dossierDonnees)) {
    console.log("  XTTS n'est pas encore installé : lance npm run voix-xtts, Max prendra cette voix tout seul.");
    return;
  }
  console.log("… Max essaie sa nouvelle voix (le modèle se charge : jusqu'à une minute)");
  const x = new Xtts(config.dossierDonnees, { ...config.voix.xtts, reference: c.reference });
  await x.demarrer();
  const f = path.join(os.tmpdir(), "max-essai-reference.wav");
  await x.synthetiser("Bonsoir. Ici Max. Tous les systèmes sont en ligne. Ta quête du jour t'attend : trois blocs, et on y va.", f);
  x.arreter();
  await executer("afplay", [f]).catch(() => {});
  console.log("✔ C'est sa voix maintenant. Relance Max : npm run arreter, puis rouvre-le (claque trois fois, ou Siri).");
}

main().catch((e) => {
  console.error(`✘ ${(e as Error).message}`);
  process.exit(1);
});
