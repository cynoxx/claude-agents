// `npm run setup` : crée bureau.config.json et vérifie tout ce dont le Bureau et Max ont besoin.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig } from "./config.ts";
import { FICHIER_PROFIL } from "./max/coach.ts";
import { checkClaude } from "./claude-check.ts";
import { creerBouche } from "./voix/voix-config.ts";
import { preparerOreille } from "./voix/diagnostic.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fichier = path.join(racine, CONFIG_FILE);

if (fs.existsSync(fichier)) {
  console.log(`✔ ${CONFIG_FILE} existe déjà, je n'y touche pas.`);
} else {
  // les conseillers restent ceux par défaut (et suivent les mises à jour) tant qu'on n'en écrit pas soi-même
  const { conseillers: _parDefaut, ...base } = DEFAULT_CONFIG;
  const modele = {
    ...base,
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

const profil = path.join(config.dossierMissions, FICHIER_PROFIL);
if (fs.existsSync(profil)) {
  console.log(`✔ ${profil} existe déjà, je n'y touche pas.`);
} else {
  fs.mkdirSync(config.dossierMissions, { recursive: true });
  fs.copyFileSync(path.join(racine, "modeles", "moi.md"), profil);
  console.log(`✔ ${profil} créé.`);
  console.log("  → Remplis-le : c'est ce que Max et ses conseillers savent de toi (priorité, objectifs, rythme, échéances).");
}

const claude = await checkClaude(process.env.CLAUDE_BIN ?? "claude");
if (claude.ok) console.log(`✔ Claude Code est prêt (${claude.version}).`);
else {
  console.log(`✘ ${claude.erreur}`);
  toutVaBien = false;
}

const { dispo: oreille } = await preparerOreille(config);
console.log(`${oreille.ok ? "✔ Oreille de Max :" : "✘ Oreille de Max :"} ${oreille.detail}`);
const b = creerBouche(config);
const bouche = await b.preparer();
b.arreter();
console.log(`${bouche.ok ? "✔ Voix de Max :" : "✘ Voix de Max :"} ${bouche.detail}`);
if (!bouche.detail?.includes("Piper")) console.log("  → Pour une voix bien plus naturelle (neuronale, locale) : npm run voix");

if (fs.existsSync(config.musique.fichier)) console.log(`✔ Musique de Max : ${config.musique.fichier}`);
else console.log(`– Pas de musique de Max (intro et fond du réveil) : mets ton MP3 ici → ${config.musique.fichier}`);
const tw = config.reveil.twilio;
if (config.reveil.telephone && tw.compte && tw.jeton && tw.numero) console.log(`✔ Réveil par appel : vers ${config.reveil.telephone} (essai : npm run appel).`);
else console.log("– Réveil par appel pas configuré : il faut ton numéro et un compte Twilio dans « reveil » (README, section « Le réveil »).");

console.log(
  `\nPour « Dis Siri, ${config.voix.phraseSiri} », le raccourci nommé « ${config.voix.phraseSiri} » doit exécuter :\n  /bin/bash "${path.join(racine, "scripts", "reveiller-max.sh")}"\n(pas-à-pas dans le README, section « Dis Siri, Max au rapport »).`,
);

if (toutVaBien) console.log(`\nTout est prêt${oreille.ok ? "" : " (Max t'entendra quand l'oreille sera réglée ; en attendant tu peux lui écrire)"} ! Lance le Bureau avec : npm start`);
else process.exitCode = 1;
