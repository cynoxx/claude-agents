import { Ecoute } from "./ecoute.ts";
import { PointeurMainPage } from "./pointeur.ts";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import { Conversation } from "./conversation.ts";
import { Jarvis } from "./jarvis.ts";
import { EcranVerrou } from "./verrou.ts";
import { Hud } from "./hud.ts";
import { QG, brancherAutreSeance } from "./poles.ts";
import { Ouverture } from "./presence/ouverture.ts";
import { Presence } from "./presence/presence.ts";
import { Salle } from "./presence/salle.ts";
import { EvenementsSysteme } from "./systeme-evenements.ts";
import { brancherAmbianceSysteme } from "./systeme-ambiance.ts";
import { silencerSons } from "./sons.ts";
// les lettres de Max, servies par le projet (elles marchent sans internet) : licence libre OFL
import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import { Interface } from "./ui.ts";
import "./style.css";
import "./presence/presence.css";

let ws: WebSocket | null = null;
let attente = 1000;

const envoyer = (m: ClientMessage) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else ui.toast("Pas de connexion au Bureau. Vérifie que « npm start » tourne toujours.");
};

const ui = new Interface(envoyer);
const conversation = new Conversation(envoyer);
const jarvis = new Jarvis(envoyer);
const verrou = new EcranVerrou(envoyer);
const hud = new Hud();
const qg = new QG(envoyer);
const intro = new Ouverture();
const presence = new Presence(envoyer);
const salle = new Salle(envoyer);
const systeme = new EvenementsSysteme();
brancherAmbianceSysteme();
brancherAutreSeance(envoyer);

// Le pixel art du bureau a laissé la place à la salle des pôles (presence/salle.ts) : le moteur de jeu n'est plus chargé.

// Une seule fenêtre de Max à la fois : la plus récente garde la main, les autres se ferment (ou, si le navigateur
// refuse de les fermer, passent sur une page « Max est ouvert ailleurs », qui libère la caméra).
const NEE = Date.now();
function ceder(): void {
  window.close();
  setTimeout(() => location.replace("/ailleurs.html"), 300);
}

// Le rôle de cette fenêtre : « jarvis » ou « bureau » quand Max s'ouvre sur deux écrans, sinon la fenêtre complète.
// La fenêtre du Bureau est muette : le micro, la caméra, l'intro et les notifications restent à la fenêtre de Jarvis
// (sinon tout se ferait deux fois : deux écoutes, deux popups).
const ECRAN = ((new URLSearchParams(location.search).get("ecran")) ?? "") as "" | "jarvis" | "bureau";
document.body.dataset.ecran = ECRAN;
if (ECRAN === "bureau") silencerSons();

if (ECRAN !== "bureau") new PointeurMainPage();
const ecoute = new Ecoute((m) => ws?.readyState === 1 && ws.send(JSON.stringify(m)));

function connecter(): void {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => {
    attente = 1000;
    document.getElementById("connexion")!.hidden = true;
    ws?.send(JSON.stringify({ type: "fenetre", nee: NEE, ...(ECRAN ? { ecran: ECRAN } : {}) }));
  };
  ws.onmessage = (e) => {
    const msg: ServerMessage = JSON.parse(e.data);
    if (msg.type === "etat") {
      if (ECRAN !== "bureau") verrou.rendre(msg.etat.verrou, !!msg.etat.reveil?.enCours && msg.etat.reveil.mode !== "appel");
      ui.rendre(msg.etat);
      hud.rendre(msg.etat.assistant?.coach);
      jarvis.rendre(msg.etat);
      presence.rendre(msg.etat);
      salle.rendre(msg.etat);
      if (ECRAN !== "bureau") ecoute.rendre(msg.etat);
      qg.rendre(msg.etat);
      if (ECRAN !== "bureau") {
        intro.rendre(msg.etat);
        systeme.rendre(msg.etat);
      }
      conversation.rendre(msg.etat.assistant);
    } else if (msg.type === "visage") {
      verrou.recevoir(msg);
    } else if (msg.type === "fenetre") {
      if (msg.nee > NEE && (msg.ecran ?? "") === ECRAN) ceder();
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
