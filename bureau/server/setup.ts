// `npm run setup` : crée bureau.config.json et vérifie tout ce dont le Bureau et Max ont besoin.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig } from "./config.ts";
import { checkClaude } from "./claude-check.ts";
import { Bouche } from "./voix/bouche.ts";
import { preparerOreille } from "./voix/diagnostic.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fichier = path.join(racine, CONFIG_FILE);

if (fs.existsSync(fichier)) {
  console.log(`✔ ${CONFIG_FILE} existe déjà, je n'y touche pas.`);
} else {
  const modele = {
    ...DEFAULT_CONFIG,
    projets: [
      { nom: "Cynox Fitness", chemin: "~/Code/Cynox-Fitness" },
      { nom: "Lifforge", chemin: "~/Code/lifforge" },
    ],
  };
  fs.writeFileSync(fichier, JSON.stringify(modele, null, 2) + "\n");
  console.log(`✔ ${CONFIG_FILE} créé.`);
  console.log("  → Ouvre-le et corrige les chemins de tes projets (« projets ») pour que le Codeur puisse y travailler.");
}

const config = loadConfig(racine);
let toutVaBien = true;

const claude = await checkClaude(process.env.CLAUDE_BIN ?? "claude");
if (claude.ok) console.log(`✔ Claude Code est prêt (${claude.version}).`);
else {
  console.log(`✘ ${claude.erreur}`);
  toutVaBien = false;
}

const { dispo: oreille } = await preparerOreille(config);
console.log(`${oreille.ok ? "✔ Oreille de Max :" : "✘ Oreille de Max :"} ${oreille.detail}`);
const bouche = await new Bouche({ bin: config.voix.say, voix: config.voix.voixMac, debit: config.voix.debit }).preparer();
console.log(`${bouche.ok ? "✔ Voix de Max :" : "✘ Voix de Max :"} ${bouche.detail}`);

console.log(`\nPour « Dis Siri, réveille Max », le raccourci doit exécuter :\n  /bin/bash "${path.join(racine, "scripts", "reveiller-max.sh")}"\n(pas-à-pas dans le README, section « Dis Siri, réveille Max »).`);

if (toutVaBien) console.log(`\nTout est prêt${oreille.ok ? "" : " (Max t'entendra quand l'oreille sera réglée ; en attendant tu peux lui écrire)"} ! Lance le Bureau avec : npm start`);
else process.exitCode = 1;
