// `npm start` (ou le script lancé par « Dis Siri, Max au rapport ») : démarre le Bureau, réveille Max et ouvre le navigateur.
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
import { Coach, lireProfil } from "./max/coach.ts";
import { Conseillers } from "./max/conseillers.ts";
import { InfosJarvis } from "./max/infos-jarvis.ts";
import { Mac } from "./max/mac.ts";
import { Verrou } from "./max/verrou.ts";
import { Visage } from "./max/visage.ts";
import { ecrireConfigMcp } from "./max/mcp-config.ts";
import { MissionManager } from "./mission.ts";
import { listMissions, markInterrupted } from "./storage.ts";
import { creerBouche } from "./voix/voix-config.ts";
import { preparerOreille } from "./voix/diagnostic.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const bin = process.env.CLAUDE_BIN ?? "claude";
fs.mkdirSync(config.dossierMissions, { recursive: true });

const interrompues = markInterrupted(config.dossierMissions);
if (interrompues) console.log(`${interrompues} mission(s) coupée(s) au dernier arrêt, marquée(s) « interrompue ».`);

const manager = new MissionManager(config, bin, { ok: false, erreur: "vérification en cours…" });

// Max : jeton pour ses outils, oreille (micro + Whisper), bouche (Piper ou say), cerveau (claude en continu)
const jeton = creerJeton(config.dossierDonnees);
const mcpConfig = ecrireConfigMcp({ racine, port: config.port, dossierDonnees: config.dossierDonnees });
const bouche = creerBouche(config);
const [{ oreille, dispo: dispoOreille }, dispoBouche] = await Promise.all([preparerOreille(config), bouche.preparer()]);
// Le coach (minuteur, journal de travail, rappels) et les conseillers (un par domaine de la vie)
const coach = new Coach({ dossier: config.dossierMissions, dossierDonnees: config.dossierDonnees });
const profil = () => lireProfil(config.dossierMissions);
const conseillers = new Conseillers({
  defs: config.conseillers,
  bin,
  modele: config.modeles.robots,
  dossier: config.dossierMissions,
  timeoutMs: 4 * 60_000,
  profil,
  contexte: () => coach.contexte(),
});
// La télécommande du Mac et les panneaux de l'écran Jarvis (météo, agenda du jour)
const mac = new Mac({
  actif: process.platform === "darwin",
  musique: config.mac.musique,
  ville: config.mac.ville,
  ...(config.mac.dossierCaptures ? { dossierCaptures: config.mac.dossierCaptures } : {}),
});
const jarvis = new InfosJarvis(mac);
// Le verrou par le visage : fermé au démarrage si un visage est enregistré
const verrou = new Verrou({ visage: new Visage(config.dossierDonnees), actif: config.visage.actif });
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
  coach,
  profil,
  conseillers: () => conseillers.liste(),
  horodater: true,
  phraseSiri: config.voix.phraseSiri,
  verrou,
});
console.log(`${dispoOreille.ok ? "🎙 " : "⚠️ "} ${dispoOreille.detail}`);
console.log(`${dispoBouche.ok ? "🔊" : "⚠️ "} ${dispoBouche.detail}`);

const server = createBureauServer({
  config,
  manager,
  webDir: path.join(racine, "web", "dist"),
  jeton,
  assistant,
  coach,
  conseillers,
  mac,
  jarvis,
  verrou,
  modelesVisage: path.join(racine, "node_modules", "@vladmandic", "face-api", "model"),
});

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

const fichierPid = path.join(config.dossierDonnees, "serveur.pid");

server.listen(config.port, "127.0.0.1", async () => {
  fs.writeFileSync(fichierPid, String(process.pid));
  const url = `http://localhost:${config.port}`;
  console.log(`\n🏢 Le Bureau est ouvert : ${url}`);
  console.log(`📁 Missions rangées dans : ${config.dossierMissions}`);
  console.log("Laisse cette fenêtre ouverte. Ctrl+C pour fermer le Bureau.\n");
  if (!process.env.BUREAU_NO_OPEN) ouvrirDansFinder(url);
  jarvis.demarrer();
  if (verrou.verrouille) {
    verrou.demander();
    console.log("🔒 Max est verrouillé : regarde la caméra pour le déverrouiller.");
  }
  if ((await claudePret) && !process.env.BUREAU_SANS_REVEIL) assistant.reveiller();
});

const fermer = () => {
  console.log("\nFermeture du Bureau…");
  fs.rmSync(fichierPid, { force: true });
  assistant.veille();
  bouche.arreter();
  coach.fermer();
  jarvis.arreter();
  conseillers.arreterTout();
  manager.arreter();
  setTimeout(() => process.exit(0), 1500).unref();
  manager.attendreFin().then(() => process.exit(0));
};
process.on("SIGINT", fermer);
process.on("SIGTERM", fermer);
