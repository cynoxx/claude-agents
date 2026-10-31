// `npm run micros` : liste les micros du Mac et montre celui que Max utilise.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { listeFfmpeg } from "./voix/diagnostic.ts";
import { choisirMicro, listerMicros } from "./voix/micro.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const sortie = await listeFfmpeg(config.voix.ffmpeg);
if (sortie === null) {
  console.log("✘ ffmpeg introuvable : installe-le avec « brew install ffmpeg ».");
  process.exit(1);
}
const micros = listerMicros(sortie);
if (!micros.length) {
  console.log("Aucun micro trouvé.");
  process.exit(1);
}
const choisi = config.voix.micro ?? choisirMicro(sortie);
console.log("Micros disponibles :");
for (const m of micros) console.log(`  ${`:${m.index}` === choisi ? "👉" : "  "} :${m.index}  ${m.nom}`);
console.log(`\nMax utilise ${choisi}${config.voix.micro ? " (imposé dans bureau.config.json)" : " (choisi automatiquement)"}.`);
console.log('Pour en imposer un autre, mets par exemple  "voix": { "micro": ":1" }  dans bureau.config.json.');
