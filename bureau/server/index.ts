// `npm start` (ou le script « réveille Max ») : démarre le Bureau, réveille Max et ouvre le navigateur.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { checkClaude } from "./claude-check.ts";
import { createBureauServer, ouvrirDansFinder } from "./http.ts";
import { creerJeton } from "./jeton.ts";
import { Assistant } from "./max/assistant.ts";
import { lireCarnet } from "./max/carnet.ts";
import { Cerveau } from "./max/cerveau.ts";
import { ecrireConfigMcp } from "./max/mcp-config.ts";
import { MissionManager } from "./mission.ts";
import { listMissions, markInterrupted } from "./storage.ts";
import { Bouche } from "./voix/bouche.ts";
import { preparerOreille } from "./voix/diagnostic.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(racine);
const bin = process.env.CLAUDE_BIN ?? "claude";
fs.mkdirSync(config.dossierMissions, { recursive: true });

const interrompues = markInterrupted(config.dossierMissions);
if (interrompues) console.log(`${interrompues} mission(s) coupée(s) au dernier arrêt, marquée(s) « interrompue ».`);

const manager = new MissionManager(config, bin, { ok: false, erreur: "vérification en cours…" });

// Max : jeton pour ses outils, oreille (micro + Whisper), bouche (say), cerveau (claude en continu)
const jeton = creerJeton(config.dossierDonnees);
const mcpConfig = ecrireConfigMcp({ racine, port: config.port, dossierDonnees: config.dossierDonnees });
const bouche = new Bouche({ bin: config.voix.say, voix: config.voix.voixMac, debit: config.voix.debit });
const [{ oreille, dispo: dispoOreille }, dispoBouche] = await Promise.all([preparerOreille(config), bouche.preparer()]);
const assistant = new Assistant({
  oreille,
  bouche,
  creerCerveau: (consigne) => new Cerveau({ bin, modele: config.modeles.conversation, consigne, mcpConfig, cwd: config.dossierMissions }),
  manager,
  carnet: () => lireCarnet(config.dossierMissions),
  missions: () => listMissions(config.dossierMissions),
  motCle: config.voix.motCle,
  suiteMs: config.voix.suiteSecondes * 1000,
  veilleMs: config.voix.veilleMinutes * 60_000,
  dispos: { oreille: dispoOreille, bouche: dispoBouche },
});
console.log(`${dispoOreille.ok ? "🎙 " : "⚠️ "} ${dispoOreille.detail}`);
console.log(`${dispoBouche.ok ? "🔊" : "⚠️ "} ${dispoBouche.detail}`);

const server = createBureauServer({ config, manager, webDir: path.join(racine, "web", "dist"), jeton, assistant });

const claudePret = checkClaude(bin).then((etat) => {
  manager.setClaude(etat);
  console.log(etat.ok ? `✅ Claude Code prêt (${etat.version})` : `⚠️  ${etat.erreur}`);
  return etat.ok;
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Le port ${config.port} est déjà utilisé : le Bureau est peut-être déjà ouvert. Sinon, change « port » dans bureau.config.json.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(config.port, "127.0.0.1", async () => {
  const url = `http://localhost:${config.port}`;
  console.log(`\n🏢 Le Bureau est ouvert : ${url}`);
  console.log(`📁 Missions rangées dans : ${config.dossierMissions}`);
  console.log("Laisse cette fenêtre ouverte. Ctrl+C pour fermer le Bureau.\n");
  if (!process.env.BUREAU_NO_OPEN) ouvrirDansFinder(url);
  if ((await claudePret) && !process.env.BUREAU_SANS_REVEIL) assistant.reveiller();
});

const fermer = () => {
  console.log("\nFermeture du Bureau…");
  assistant.veille();
  manager.arreter();
  setTimeout(() => process.exit(0), 1500).unref();
  manager.attendreFin().then(() => process.exit(0));
};
process.on("SIGINT", fermer);
process.on("SIGTERM", fermer);
