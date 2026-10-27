import { Gestes } from "./gestes.ts";
import Phaser from "phaser";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { HAUTEUR, LARGEUR, OfficeScene } from "./office-scene.ts";
import { Conversation } from "./conversation.ts";
import { Jarvis } from "./jarvis.ts";
import { EcranVerrou } from "./verrou.ts";
import { Hud } from "./hud.ts";
import { QG, brancherAutreSeance } from "./poles.ts";
import { Intro } from "./intro.ts";
import "@fontsource/pixelify-sans/400.css";
import "@fontsource/pixelify-sans/700.css";
import "@fontsource/press-start-2p/400.css";
import { Interface } from "./ui.ts";
import "./style.css";

let ws: WebSocket | null = null;
let attente = 1000;

const envoyer = (m: ClientMessage) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else ui.toast("Pas de connexion au Bureau. Vérifie que « npm start » tourne toujours.");
};

const ui = new Interface(envoyer);
const scene = new OfficeScene({ onClic: (id) => ui.clicPersonnage(id) });
const conversation = new Conversation(envoyer);
const jarvis = new Jarvis(envoyer);
const verrou = new EcranVerrou(envoyer);
const hud = new Hud();
const qg = new QG(envoyer);
const intro = new Intro();
brancherAutreSeance(envoyer);

// les polices pixel sont chargées avant le jeu, pour que les textes du bureau les utilisent
Promise.all(['16px "Pixelify Sans"', '8px "Press Start 2P"'].map((f) => document.fonts.load(f).catch(() => []))).finally(() => new Phaser.Game({
  type: Phaser.AUTO,
  parent: "jeu",
  width: LARGEUR,
  height: HAUTEUR,
  pixelArt: true,
  backgroundColor: "#1b1b2f",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
  scene,
  banner: false,
}));

// Une seule fenêtre de Max à la fois : la plus récente garde la main, les autres se ferment (ou, si le navigateur
// refuse de les fermer, passent sur une page « Max est ouvert ailleurs », qui libère la caméra).
const NEE = Date.now();
function ceder(): void {
  window.close();
  setTimeout(() => location.replace("/ailleurs.html"), 300);
}

const gestes = new Gestes((m) => ws?.send(JSON.stringify(m)));

function connecter(): void {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => {
    attente = 1000;
    document.getElementById("connexion")!.hidden = true;
    ws?.send(JSON.stringify({ type: "fenetre", nee: NEE }));
  };
  ws.onmessage = (e) => {
    const msg: ServerMessage = JSON.parse(e.data);
    if (msg.type === "etat") {
      verrou.rendre(msg.etat.verrou, !!msg.etat.reveil?.enCours && msg.etat.reveil.mode !== "appel");
      ui.rendre(msg.etat);
      hud.rendre(msg.etat.assistant?.coach);
      jarvis.rendre(msg.etat);
      gestes.rendre(msg.etat);
      qg.rendre(msg.etat);
      intro.rendre(msg.etat);
      conversation.rendre(msg.etat.assistant);
      scene.sync(msg.etat.mission, msg.etat.assistant);
      scene.syncConseillers(msg.etat.conseillers);
    } else if (msg.type === "visage") {
      verrou.recevoir(msg);
    } else if (msg.type === "fenetre") {
      if (msg.nee > NEE) ceder();
    } else if (document.body.dataset.verrou !== "oui") {
      ui.toast(msg.message);
    }
  };
  ws.onclose = () => {
    document.getElementById("connexion")!.hidden = false;
    setTimeout(connecter, attente);
    attente = Math.min(attente * 2, 5000);
  };
}
connecter();
