// `npm run voix-xtts` : installe XTTS v2, une voix neuronale très naturelle qui tourne sur le Mac (gratuite, sans
// internet une fois installée). Python 3.10 ou plus → un environnement isolé → torch et coqui-tts (environ 2,5 Go)
// → ton accord sur la licence du modèle → le modèle (environ 1,8 Go) → tu écoutes les voix graves et tu choisis.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, loadConfig } from "./config.ts";
import { enregistrerLocuteurXtts } from "./voix/choix-voix.ts";
import { LOCUTEURS_GRAVES, Xtts, cheminsXtts } from "./voix/xtts.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dossierConfig = process.env.BUREAU_CONFIG_DIR ?? racine;
const config = loadConfig(dossierConfig);
const c = cheminsXtts(config.dossierDonnees);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const PHRASE = "Bonsoir. Ici Max. Tous les systèmes sont en ligne, et ta séance de ce soir est prête. Je t'écoute.";

function lancer(bin: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "inherit", "inherit"], env });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(bin)} ${args[0] ?? ""} a échoué (code ${code})`))));
  });
}

const versionPython = (bin: string) =>
  new Promise<[number, number] | null>((resolve) =>
    execFile(bin, ["-c", "import sys; print(sys.version_info[0], sys.version_info[1])"], (e, out) => {
      const [a, b] = String(out).trim().split(" ").map(Number);
      resolve(e || !a ? null : [a, b]);
    }),
  );

const jouer = (f: string) => new Promise<void>((r) => execFile("afplay", [f], () => r()));

async function main() {
  console.log("🗣  La voix XTTS de Max (neuronale, sur ton Mac, gratuite)\n");

  // 1. Python 3.10 à 3.14 (3.12 et 3.11 d'abord : ce sont les plus sûres pour torch)
  let python = process.env.PYTHON ?? "";
  const candidats = python
    ? [python]
    : ["python3.12", "python3.11", "python3.13", "python3.10", "/opt/homebrew/bin/python3.12", "/opt/homebrew/bin/python3.11", "/opt/homebrew/bin/python3", "python3", "/usr/local/bin/python3"];
  python = "";
  for (const candidat of candidats) {
    const v = await versionPython(candidat);
    if (v && v[0] === 3 && v[1] >= 10 && v[1] <= 14) {
      python = candidat;
      console.log(`✔ Python ${v.join(".")} (${candidat})`);
      break;
    }
  }
  if (!python) {
    console.error("✘ Il faut Python 3.10 à 3.14. Installe-le avec : brew install python@3.12, puis relance npm run voix-xtts.");
    process.exit(1);
  }

  // 2. la licence du modèle : c'est à toi de l'accepter
  if (!fs.existsSync(c.accord)) {
    console.log("\nLe modèle XTTS v2 est distribué sous la licence Coqui Public Model License (CPML) :");
    console.log("  usage personnel et non commercial seulement. Texte : https://coqui.ai/cpml");
    const r = (await rl.question("Tu acceptes cette licence pour ton usage perso ? (o/n) : ")).trim().toLowerCase();
    if (!r.startsWith("o")) {
      console.log("Pas d'installation. Max garde sa voix actuelle.");
      process.exit(0);
    }
  }

  // 3. l'environnement Python et les bibliothèques (torch reste avant 2.9 : après, il réclame torchcodec)
  fs.mkdirSync(c.racine, { recursive: true });
  if (!fs.existsSync(c.python)) {
    console.log("… Création de l'environnement Python de la voix");
    await lancer(python, ["-m", "venv", path.join(c.racine, "venv")]);
  }
  console.log("… Installation de torch et coqui-tts (environ 2,5 Go : compte 5 à 15 minutes)");
  await lancer(c.python, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--upgrade", "pip"]);
  await lancer(c.python, ["-m", "pip", "install", "--disable-pip-version-check", "torch>=2.2,<2.9", "torchaudio>=2.2,<2.9", "coqui-tts>=0.27,<0.29"]);
  fs.writeFileSync(c.accord, new Date().toISOString() + "\n");

  // 4. le modèle (téléchargé une fois, gardé par coqui-tts)
  console.log("\n… Téléchargement du modèle XTTS v2 (environ 1,8 Go, une seule fois)");
  await lancer(c.python, ["-c", "from TTS.api import TTS; TTS('tts_models/multilingual/multi-dataset/xtts_v2')"], { ...process.env, COQUI_TOS_AGREED: "1" });
  fs.writeFileSync(c.pret, new Date().toISOString() + "\n");

  // 5. l'écoute des voix graves
  console.log("\n… Je réveille la voix (jusqu'à une minute la première fois)");
  const moteur = new Xtts(config.dossierDonnees, config.voix.xtts);
  await moteur.demarrer(600_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "max-xtts-"));
  const fichiers: string[] = [];
  console.log("\nLes voix d'homme graves de XTTS, avec une phrase de Max (monte le son) :\n");
  for (const [i, l] of LOCUTEURS_GRAVES.entries()) {
    const f = path.join(tmp, `${i}.wav`);
    const t0 = Date.now();
    try {
      await moteur.synthetiser(PHRASE, f, { locuteur: l });
    } catch {
      continue;
    }
    fichiers[i] = f;
    console.log(`  ${i + 1}. ${l}  (préparée en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await jouer(f);
  }
  if (!fichiers.some(Boolean)) {
    console.error("✘ Aucune voix n'a pu être préparée. Le Bureau gardera la voix intégrée par défaut ; dis-le à Claude.");
    moteur.arreter();
    process.exit(1);
  }
  for (;;) {
    const r = (await rl.question("\nTon choix : tape son numéro (« e3 » pour réécouter la 3, « q » pour quitter) : ")).trim().toLowerCase();
    if (r === "q") break;
    const e = r.match(/^e\s*(\d)$/);
    if (e) {
      const f = fichiers[Number(e[1]) - 1];
      if (f) await jouer(f);
      continue;
    }
    const i = Number(r) - 1;
    if (!fichiers[i]) continue;
    enregistrerLocuteurXtts(path.join(dossierConfig, CONFIG_FILE), LOCUTEURS_GRAVES[i]);
    console.log(`\n✔ Max parlera avec la voix « ${LOCUTEURS_GRAVES[i]} ».`);
    console.log("  Pour l'entendre : npm run arreter, puis « Dis Siri, Max au rapport ».");
    console.log("  Plus vite ou plus lent : \"voix\": { \"xtts\": { \"vitesse\": 1.1 } } dans bureau.config.json.");
    break;
  }
  moteur.arreter();
  rl.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(`\n✘ ${(e as Error).message}`);
  console.error("  Max garde sa voix actuelle en attendant. Tu peux relancer npm run voix-xtts.");
  process.exit(1);
});
