// `npm run modele` : télécharge le modèle Whisper (~550 Mo) dans le dossier de données du Bureau.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { telechargerModele, URL_MODELE } from "./modele.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const destination = config.voix.modele!;
console.log(`Modèle Whisper → ${destination}`);
let dernier = -1;
try {
  const r = await telechargerModele(URL_MODELE, destination, (f) => {
    const pct = Math.floor(f * 100);
    if (pct !== dernier) {
      dernier = pct;
      process.stdout.write(`\r  Téléchargement : ${pct} %   `);
    }
  });
  console.log(r === "deja-la" ? "✔ Le modèle est déjà là." : "\n✔ Modèle téléchargé. Relance le Bureau pour que Max t'entende.");
} catch (e) {
  console.error(`\n✘ ${(e as Error).message} Vérifie ta connexion et relance « npm run modele ».`);
  process.exitCode = 1;
}
