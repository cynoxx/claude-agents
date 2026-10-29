// `npm run compagnon` : lance le compagnon (Lumen), le deuxième assistant, fait pour parler, avec l'IA locale du Mac
// (LM Studio par défaut). Sa propre fenêtre, sa propre mémoire, à part de Max.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { loadConfig } from "../config.ts";
import { ouvrirFenetre } from "../fenetre.ts";
import { choisirModele } from "../ia-locale.ts";
import { redacteurLocal } from "../max/automatismes-actions.ts";
import { CerveauLocal } from "../max/cerveau-local.ts";
import { lireProfil } from "../max/coach.ts";
import { creerBouche } from "../voix/voix-config.ts";
import { Compagnon, consigneCompagnon, Souvenirs } from "./compagnon.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const c = config.compagnon;
const webDir = path.join(racine, "web", "dist");

/** Le modèle à utiliser : celui de la config, ou le meilleur chargé dans LM Studio / Ollama. */
async function trouverModele(): Promise<string> {
  if (c.modele && c.modele !== "auto") return c.modele;
  try {
    const r = await fetch(`${c.url.replace(/\/$/, "")}/models`, { headers: c.cle ? { authorization: `Bearer ${c.cle}` } : {}, signal: AbortSignal.timeout(4000) });
    const ids = ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [];
    return choisirModele(ids) ?? "local-model";
  } catch {
    console.log(`⚠️  L'IA locale ne répond pas (${c.url}) : lance LM Studio et son serveur (onglet Developer › Start Server).`);
    return "local-model";
  }
}

const modele = await trouverModele();
const bouche = creerBouche(config);
void bouche.preparerEnArrierePlan((d) => console.log(`${d.ok ? "🔊" : "⚠️ "} ${d.detail}`)).then((d) => console.log(`🔊 ${d.detail}`));
const souvenirs = new Souvenirs(path.join(config.dossierMissions, "compagnon", "souvenirs.md"));
const rediger = redacteurLocal({ url: c.url, modele, cle: c.cle });

const compagnon = new Compagnon({
  nom: c.nom,
  bouche,
  souvenirs,
  pauseFinMs: c.pauseFinMs,
  creerCerveau: (consigne) => new CerveauLocal({ url: c.url, modele, cle: c.cle, consigne, outils: null }),
  consigne: () => consigneCompagnon({ nom: c.nom, souvenirs: souvenirs.lire(), profil: lireProfil(config.dossierMissions), maintenant: new Date() }),
  resumer: async (conversation) => {
    const t = await rediger(
      `Voici une conversation entre un étudiant et son compagnon. Écris de 0 à 3 choses durables à retenir sur lui pour les prochaines conversations (ce qu'il vit, ce qui compte pour lui, ce qu'il a prévu), une par ligne, chacune commençant par « - ». Si rien ne mérite d'être retenu, n'écris rien.\n\n${conversation.slice(-8000)}`,
    );
    return (t ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").split("\n").filter((l) => l.trim().startsWith("-"));
  },
});

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const serveur = http.createServer((req, res) => {
  const chemin = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const f = path.resolve(webDir, chemin === "/" ? "compagnon.html" : "." + chemin);
  if (!f.startsWith(webDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404).end("Introuvable");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "cache-control": "no-store" });
  fs.createReadStream(f).pipe(res);
});

const wss = new WebSocketServer({ server: serveur, path: "/ws" });
const envoyer = (ws: WebSocket) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type: "etat", etat: compagnon.vue() }));
compagnon.on("etat", () => wss.clients.forEach(envoyer));
wss.on("connection", (ws, req) => {
  // seulement depuis ce Mac
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress ?? "")) return ws.close();
  envoyer(ws);
  ws.on("message", (b) => {
    let m: { type?: string; texte?: unknown; probleme?: unknown; oui?: unknown };
    try {
      m = JSON.parse(String(b));
    } catch {
      return;
    }
    if (m.type === "entendu") compagnon.entendre(String(m.texte ?? ""));
    else if (m.type === "ecrire") compagnon.ecrire(String(m.texte ?? ""));
    else if (m.type === "taire") compagnon.taire();
    else if (m.type === "pause") compagnon.pause(m.oui === true);
    else if (m.type === "micro") compagnon.signalerMicro(m.probleme ? String(m.probleme).slice(0, 300) : null);
  });
});

serveur.listen(c.port, "127.0.0.1", () => {
  console.log(`\n✨ ${c.nom} est là : http://localhost:${c.port}  (IA locale : ${modele})`);
  console.log(`   Souvenirs : ${path.join(config.dossierMissions, "compagnon", "souvenirs.md")}`);
  if (!process.env.BUREAU_NO_OPEN) ouvrirFenetre(`http://localhost:${c.port}`, { config: config.fenetre, dossierDonnees: path.join(config.dossierDonnees, "compagnon") });
});

const fermer = async () => {
  await compagnon.finirConversation().catch(() => {});
  compagnon.arreter();
  bouche.arreter();
  process.exit(0);
};
process.on("SIGINT", () => void fermer());
process.on("SIGTERM", () => void fermer());
