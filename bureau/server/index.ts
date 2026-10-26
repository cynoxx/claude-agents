// `npm start` (ou le script lancé par « Dis Siri, Max au rapport ») : démarre le Bureau, réveille Max et ouvre le navigateur.
import { execFile } from "node:child_process";
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
import { Planning } from "./max/planning.ts";
import { TriMails } from "./max/tri-mails.ts";
import { TrieurAuto } from "./max/trieur.ts";
import { Sport } from "./max/sport.ts";
import { Musique } from "./max/musique.ts";
import { Reveil } from "./max/reveil.ts";
import { creerTwilio, preparateurReveil } from "./max/reveil-montage.ts";
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
const coach = new Coach({ dossier: config.dossierMissions, dossierDonnees: config.dossierDonnees, limites: config.tempsParJour });
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
// L'emploi du temps du jour et le tri des mails
const planning = new Planning({ dossier: config.dossierMissions, dossierDonnees: config.dossierDonnees });
const triMails = new TriMails();
// le tri automatique à l'arrivée (un claude sans outils, en JSON) et le sport
const trieur = new TrieurAuto({
  lister: (n) => mac.listerMails(n, true),
  tri: triMails,
  bin,
  modele: config.modeles.robots,
  dossier: config.dossierMissions,
  timeoutMs: 3 * 60_000,
  profil,
});
const sport = new Sport({ dossier: config.dossierMissions });
// ta musique : l'intro au lancement de Max, et le fond de l'appel du réveil
const musique = new Musique({
  source: config.musique.fichier,
  recherche: config.musique.recherche,
  recherchePar: process.platform === "darwin" ? (nom) => new Promise((r) => execFile("mdfind", ["-name", nom], { timeout: 15_000 }, (_e, out) => r(String(out).split("\n").filter(Boolean)))) : undefined,
  dossier: path.join(config.dossierDonnees, "musique"),
  ffmpeg: config.voix.ffmpeg,
  lecteur: process.platform === "darwin" ? "afplay" : null,
});
// le réveil : Max t'appelle sur ton téléphone (Twilio), sa voix sur ta musique
const twilio = creerTwilio(config);
const reveil = new Reveil({
  dossierDonnees: config.dossierDonnees,
  telephone: config.reveil.telephone,
  appelleur: twilio,
  heureDefaut: config.reveil.heure,
  rappelMinutes: config.reveil.rappelMinutes,
  essais: config.reveil.essais,
  garderEveille: process.platform === "darwin",
  preparer: preparateurReveil({ config, twilio, bouche, musique, sport, profil, prenom: () => verrou.vue().prenom }),
});
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
  planning,
  sport,
  ...(config.musique.intro ? { intro: () => musique.jouerIntro() } : {}),
  reveil,
});
// réveillé par l'appel, ou il parle à Max : plus de rappels ; Max le saura à son prochain message
assistant.on("parole", () => reveil.confirmer());
reveil.on("reveille", (r: { parole: boolean }) => !r.parole && assistant.informer("Il vient d'être réveillé par ton appel de ce matin (il a décroché et écouté)."));
reveil.on("echec", () => assistant.informer(`Il n'a répondu à aucun des ${config.reveil.essais} appels du réveil ce matin.`));
// il arrive (réveil avec accueil) : ses mails sont triés pendant que Max le salue
assistant.on("arrivee", () => {
  if (process.platform === "darwin") void trieur.lancer();
});
trieur.on("trie", (resume: string) => assistant.informer(`Ses mails non lus ont été triés automatiquement et s'affichent dans une fenêtre sur ton écran. Résumé : ${resume}`));
const musiqueTrouvee = await musique.chercher();
console.log(musique.disponible ? `🎵 Musique de Max : ${musiqueTrouvee && musiqueTrouvee !== config.musique.fichier ? `trouvée (${musiqueTrouvee}) et rangée dans ${config.musique.fichier}` : config.musique.fichier}` : `⚠️  Pas de musique de Max (aucun mp3 « ${config.musique.recherche} » trouvé) : mets-le dans ${config.musique.fichier}`);
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
  planning,
  triMails,
  trieur,
  sport,
  musique,
  reveil,
  modelesVisage: path.join(racine, "node_modules", "@vladmandic", "face-api", "model"),
  mediapipe: { wasm: path.join(racine, "node_modules", "@mediapipe", "tasks-vision", "wasm"), dossierModele: path.join(config.dossierDonnees, "modeles") },
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
  reveil.demarrer();
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
  planning.fermer();
  reveil.fermer();
  jarvis.arreter();
  conseillers.arreterTout();
  manager.arreter();
  setTimeout(() => process.exit(0), 1500).unref();
  manager.attendreFin().then(() => process.exit(0));
};
process.on("SIGINT", fermer);
process.on("SIGTERM", fermer);
