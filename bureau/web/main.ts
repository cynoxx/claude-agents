import Phaser from "phaser";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { HAUTEUR, LARGEUR, OfficeScene } from "./office-scene.ts";
import { Conversation } from "./conversation.ts";
import { Jarvis } from "./jarvis.ts";
import { EcranVerrou } from "./verrou.ts";
import { Hud } from "./hud.ts";
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

function connecter(): void {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => {
    attente = 1000;
    document.getElementById("connexion")!.hidden = true;
  };
  ws.onmessage = (e) => {
    const msg: ServerMessage = JSON.parse(e.data);
    if (msg.type === "etat") {
      verrou.rendre(msg.etat.verrou);
      ui.rendre(msg.etat);
      hud.rendre(msg.etat.assistant?.coach);
      jarvis.rendre(msg.etat);
      conversation.rendre(msg.etat.assistant);
      scene.sync(msg.etat.mission, msg.etat.assistant);
      scene.syncConseillers(msg.etat.conseillers);
    } else if (msg.type === "visage") {
      verrou.recevoir(msg);
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
