// `npm run setup` : crée bureau.config.json et vérifie Claude Code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, DEFAULT_CONFIG } from "./config.ts";
import { checkClaude } from "./claude-check.ts";

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

const etat = await checkClaude(process.env.CLAUDE_BIN ?? "claude");
if (etat.ok) {
  console.log(`✔ Claude Code est prêt (${etat.version}).`);
  console.log("\nTout est prêt ! Lance le Bureau avec : npm start");
} else {
  console.log(`✘ ${etat.erreur}`);
  process.exitCode = 1;
}
