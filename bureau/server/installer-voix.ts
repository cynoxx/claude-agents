// `npm run voix` : installe la voix neuronale Piper (locale, gratuite) et la voix française de Max.
// Python (3.9 ou plus) → un environnement isolé dans le dossier des données → piper-tts → le modèle de voix → essai.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { Piper, cheminsPiper } from "./voix/piper.ts";

const VERSION_PIPER = "1.8.0";
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const voix = process.argv[2] ?? config.voix.voixPiper;
const c = cheminsPiper(config.dossierDonnees, voix);

function lancer(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "inherit", "inherit"] });
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

async function main() {
  console.log(`🗣  Installation de la voix Piper « ${voix} » dans ${c.racine}\n`);

  let python = process.env.PYTHON ?? "";
  for (const candidat of python ? [python] : ["python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3"]) {
    const v = await versionPython(candidat);
    if (v && (v[0] > 3 || (v[0] === 3 && v[1] >= 9))) {
      python = candidat;
      console.log(`✔ Python ${v.join(".")} (${candidat})`);
      break;
    }
    python = "";
  }
  if (!python) {
    console.error("✘ Il faut Python 3.9 ou plus. Installe-le avec : brew install python, puis relance npm run voix.");
    process.exit(1);
  }

  fs.mkdirSync(c.racine, { recursive: true });
  if (!fs.existsSync(c.python)) {
    console.log("… Création de l'environnement Python de la voix");
    await lancer(python, ["-m", "venv", path.join(c.racine, "venv")]);
  }
  console.log(`… Installation de piper-tts ${VERSION_PIPER} (une minute environ)`);
  await lancer(c.python, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", `piper-tts==${VERSION_PIPER}`]);
  console.log(`… Téléchargement de la voix ${voix} (environ 60 Mo)`);
  await lancer(c.python, ["-m", "piper.download_voices", "--download-dir", c.voix, voix]);

  console.log("… Essai de la voix");
  const piper = new Piper({ python: c.python, modele: c.modele, vitesse: config.voix.vitessePiper });
  await piper.demarrer();
  const essai = path.join(os.tmpdir(), "bureau-essai-voix.wav");
  await piper.synthetiser("Bonjour ! Je suis Max. C'est ma nouvelle voix, j'espère qu'elle te plaît.", essai);
  piper.arreter();
  if (process.platform === "darwin") await lancer("afplay", [essai]).catch(() => {});
  fs.rmSync(essai, { force: true });

  console.log(`\n✔ La voix est prête. Relance le Bureau (npm run arreter, puis « Dis Siri, Max au rapport ») : Max parlera avec ${voix}.`);
  console.log("  Pour l'accélérer ou la ralentir : \"voix\": { \"vitessePiper\": 1.1 } dans bureau.config.json.");
}

main().catch((e) => {
  console.error(`\n✘ ${(e as Error).message}`);
  console.error("  Le Bureau garde la voix du Mac en attendant. Tu peux relancer npm run voix.");
  process.exit(1);
});
