// `npm start` (ou le script lancé par « Dis Siri, Max au rapport ») : démarre le Bureau, réveille Max et ouvre le navigateur.
import { execFile } from "node:child_process";
import type { Dispo } from "../shared/protocol.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { checkClaude } from "./claude-check.ts";
import { createBureauServer } from "./http.ts";
import { ouvrirFenetre } from "./fenetre.ts";
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
import { Vie } from "./max/vie.ts";
import { Studio } from "./studio/studio.ts";
import { Musique } from "./max/musique.ts";
import { Reveil } from "./max/reveil.ts";
import { creerTwilio, preparateurReveil } from "./max/reveil-montage.ts";
import { ReveilMac, type SonnerieMac } from "./max/reveil-mac.ts";
import { texteReveil } from "./max/message-reveil.ts";
import { echeances } from "./max/coach.ts";
import { seance } from "../shared/sport.ts";
import { Visage } from "./max/visage.ts";
import { ecrireConfigMcp } from "./max/mcp-config.ts";
import { MissionManager } from "./mission.ts";
import { listMissions, markInterrupted } from "./storage.ts";
import { creerBouche } from "./voix/voix-config.ts";
import { preparerOreille } from "./voix/diagnostic.ts";
import { OreillePage } from "./voix/oreille-page.ts";

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
// la voix lente (XTTS) se charge en arrière-plan : le Bureau démarre tout de suite
let surVoixPrete: (d: Dispo) => void = () => {};
// l'oreille : la reconnaissance vocale de la page (par défaut), ou le micro du Mac capturé par ffmpeg + Whisper
const oreillePage = config.voix.ecoute === "page" ? new OreillePage() : null;
const [{ oreille, dispo: dispoOreille }, dispoBouche] = await Promise.all([
  oreillePage
    ? Promise.resolve({ oreille: oreillePage, dispo: { ok: true, detail: "Micro : la fenêtre de Max écoute (reconnaissance vocale de Chrome)" } })
    : preparerOreille(config),
  bouche.preparerEnArrierePlan((d) => surVoixPrete(d)),
]);
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
const vie = new Vie({ dossier: config.dossierMissions });
// le Studio vidéo, dans iCloud Drive (s'il est activé sur ce Mac)
const dossierStudio = config.studio.dossier;
const studio =
  dossierStudio && fs.existsSync(path.dirname(dossierStudio))
    ? new Studio({ config: { ...config.studio, dossier: dossierStudio }, ffmpeg: config.voix.ffmpeg, whisper: { bin: config.voix.whisper, modele: config.voix.modele! }, dossierEtat: config.dossierMissions })
    : null;
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
  mode: config.reveil.mode,
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
  annoncesCreneaux: config.voix.annoncesCreneaux,
  veilleMs: config.voix.veilleMinutes * 60_000,
  dispos: { oreille: dispoOreille, bouche: dispoBouche },
  ecoute: { mode: config.voix.ecoute, pauseFinMs: config.voix.pauseFinMs },
  coach,
  profil,
  conseillers: () => conseillers.liste(),
  horodater: true,
  phraseSiri: config.voix.phraseSiri,
  verrou,
  planning,
  sport,
  vie,
  ...(studio ? { studio } : {}),
  ...(config.musique.intro ? { intro: () => musique.jouerIntro() } : {}),
  reveil,
});
// la page de Max, dans sa propre fenêtre (mode app de Chrome & co) ou dans le navigateur
const ouvrirMax = () => ouvrirFenetre(`http://localhost:${config.port}`, { config: config.fenetre, dossierDonnees: config.dossierDonnees });
// le réveil sur le Mac : sa voix sur ta musique, de plus en plus fort
if (studio) {
  studio.on("prete", (t: string) => assistant.signaler(t));
  if (config.studio.rappels) studio.on("rappel", (t: string) => assistant.rappeler(t));
  studio.demarrer();
  console.log(`🎬 Studio : ${dossierStudio}`);
}
surVoixPrete = (d) => {
  assistant.majDispoBouche(d);
  console.log(`${d.ok ? "🔊" : "⚠️ "} ${d.detail}`);
};
const reveilMac = new ReveilMac({
  mac,
  musique,
  bouche,
  premierMessage: (heure) =>
    texteReveil({ prenom: verrou.vue().prenom, heure, echeance: echeances(profil(), heure)[0] ?? null, seance: seance(sport.vue(heure).prevue)?.nom ?? null }),
  verrou,
  ecouter: () => assistant.reveiller(false),
  ouvrirPage: () => ouvrirMax(),
  journal: (m) => console.log(m),
  prenom: () => verrou.vue().prenom,
});
reveil.on("sonne", (s: SonnerieMac) => void reveilMac.sonner(s));
reveil.on("reveille", () => void reveilMac.arreter());
reveil.on("echec", () => void reveilMac.arreter());
// réveillé : il parle à Max, ou il se laisse reconnaître par la caméra ; plus de rappels
assistant.on("parole", () => reveil.confirmer());
verrou.on("deverrouille", () => reveil.confirmer());
reveil.on("reveille", (r: { parole: boolean }) => !r.parole && assistant.informer("Il vient d'être réveillé par ton appel de ce matin (il a décroché et écouté)."));
reveil.on("echec", () => assistant.informer(`Il n'a répondu à aucun des ${config.reveil.essais} appels du réveil ce matin.`));
// il arrive (réveil avec accueil) : ses mails sont triés pendant que Max le salue
assistant.on("arrivee", () => {
  // en mode obscur, pas de mails qui s'affichent : concentration
  if (process.platform === "darwin" && !assistant.vue().obscur) void trieur.lancer();
});
// Max Ultime : la voix se fait plus sombre, et une session de concentration démarre (si rien ne tourne déjà)
assistant.on("obscur", (actif: boolean) => {
  bouche.ton(actif);
  if (actif && !coach.vue().minuteur) coach.demarrerSession("Mode obscur", config.obscur.minutes, "etudes");
  const raccourci = actif ? config.obscur.raccourciEntree : config.obscur.raccourciSortie;
  if (raccourci && process.platform === "darwin") execFile("shortcuts", ["run", raccourci], () => {});
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
  vie,
  ...(studio ? { studio } : {}),
  ...(oreillePage ? { oreillePage } : {}),
  musique,
  reveil,
  ouvrirPage: ouvrirMax,
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
  if (!process.env.BUREAU_NO_OPEN) console.log(`🪟 Max s'ouvre ${ouvrirMax() === "navigateur" ? "dans ton navigateur" : "dans sa propre fenêtre"}.`);
  jarvis.demarrer();
  reveil.demarrer();
  // l'oreille est ouverte en permanence : « Max » le réveille, ou lance le scan du visage s'il est verrouillé
  assistant.ecouterEnPermanence();
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
  studio?.arreter();
  conseillers.arreterTout();
  manager.arreter();
  setTimeout(() => process.exit(0), 1500).unref();
  manager.attendreFin().then(() => process.exit(0));
};
process.on("SIGINT", fermer);
process.on("SIGTERM", fermer);
