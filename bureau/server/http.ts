import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, EtatBureau, Plateforme, ServerMessage, TempsPole } from "../shared/protocol.ts";
import type { BureauConfig } from "./config.ts";
import type { MissionManager } from "./mission.ts";
import type { Coach } from "./max/coach.ts";
import type { Conseillers } from "./max/conseillers.ts";
import type { InfosJarvis } from "./max/infos-jarvis.ts";
import type { Mac } from "./max/mac.ts";
import type { Verrou } from "./max/verrou.ts";
import type { Planning } from "./max/planning.ts";
import type { TriMails } from "./max/tri-mails.ts";
import type { TrieurAuto } from "./max/trieur.ts";
import type { Sport } from "./max/sport.ts";
import type { Vie } from "./max/vie.ts";
import type { Studio } from "./studio/studio.ts";
import { ARTEFACTS } from "../shared/artefacts.ts";
import type { OreillePage } from "./voix/oreille-page.ts";
import type { Musique } from "./max/musique.ts";
import type { Reveil } from "./max/reveil.ts";
import { estRouteMax, routesMax, type AssistantApi } from "./routes-max.ts";
import { listMissions } from "./storage.ts";
import { lireIdees } from "./max/coach.ts";
import { assurerModeleMain } from "./max/modele-main.ts";

export type { AssistantApi } from "./routes-max.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".csv": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

/** Ouvre un dossier dans le Finder (macOS) ou le gestionnaire de fichiers. */
export function ouvrirDansFinder(p: string): void {
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [p], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
}

/** Chemin `racine/relatif`, ou null s'il sort de la racine. */
function dedans(racine: string, relatif: string): string | null {
  const p = path.resolve(racine, relatif);
  return p === racine || p.startsWith(racine + path.sep) ? p : null;
}

export function createBureauServer(o: {
  config: BureauConfig;
  manager: MissionManager;
  webDir: string;
  ouvrir?: (p: string) => void;
  /** Ouvre la page de Max (sa fenêtre), quand le raccourci Siri le demande. */
  ouvrirPage?: () => string;
  /** Jeton exigé par les routes qui agissent (réveil, outils de Max). Sans jeton, elles sont refusées. */
  jeton?: string;
  assistant?: AssistantApi;
  coach?: Coach;
  conseillers?: Conseillers;
  mac?: Mac;
  jarvis?: InfosJarvis;
  verrou?: Verrou;
  planning?: Planning;
  triMails?: TriMails;
  trieur?: TrieurAuto;
  sport?: Sport;
  vie?: Vie;
  studio?: Studio;
  /** L'oreille dans la page (reconnaissance vocale de Chrome), quand c'est elle qui écoute. */
  oreillePage?: OreillePage;
  musique?: Musique;
  reveil?: Reveil;
  /** Le dossier des modèles de reconnaissance du visage (face-api), servis à la page. */
  modelesVisage?: string;
  /** La détection de la main (corps 3D) : les fichiers WebAssembly de MediaPipe et le dossier du modèle. */
  mediapipe?: { wasm: string; dossierModele: string; urlModele?: string };
}): http.Server {
  const root = path.resolve(o.config.dossierMissions);
  const ouvrir = o.ouvrir ?? ouvrirDansFinder;
  const traiterMax = routesMax(o);

  const envoyerFichier = (res: http.ServerResponse, fichier: string) => {
    if (!fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) return fin(res, 404, "Introuvable");
    res.writeHead(200, { "content-type": TYPES[path.extname(fichier).toLowerCase()] ?? "text/plain; charset=utf-8" });
    fs.createReadStream(fichier).pipe(res);
  };
  const fin = (res: http.ServerResponse, code: number, texte: string) => {
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
    res.end(texte);
  };

  // Seule la page du Bureau, servie sur localhost, peut parler au serveur : un autre site ouvert
  // dans le navigateur ne doit pas pouvoir lancer de mission (WebSocket inter-sites, DNS rebinding).
  const hoteAutorise = (host: string | undefined) => {
    const port = (server.address() as { port?: number } | null)?.port;
    return !!host && (host === `localhost:${port}` || host === `127.0.0.1:${port}`);
  };

  const server = http.createServer((req, res) => {
    if (!hoteAutorise(req.headers.host)) return fin(res, 403, "Accès refusé");
    const url = new URL(req.url ?? "/", "http://localhost");
    let chemin: string;
    try {
      chemin = decodeURIComponent(url.pathname);
    } catch {
      return fin(res, 400, "Adresse invalide");
    }

    // les modèles de face-api (pour l'écran verrouillé : servis même verrouillé)
    const modele = chemin.match(/^\/modeles-visage\/([a-z0-9_.-]+\.(?:json|bin))$/);
    if (modele) {
      if (!o.modelesVisage) return fin(res, 404, "Introuvable");
      const f = path.join(o.modelesVisage, modele[1]);
      if (!fs.existsSync(f)) return fin(res, 404, "Introuvable");
      res.writeHead(200, { "content-type": modele[1].endsWith(".json") ? "application/json" : "application/octet-stream", "cache-control": "max-age=86400" });
      return fs.createReadStream(f).pipe(res);
    }

    // MediaPipe Hands (pour tourner le corps 3D avec la main) : les fichiers WebAssembly, et le modèle
    const mp = chemin.match(/^\/mediapipe\/(vision_wasm_(?:nosimd_|module_)?internal\.(?:js|wasm)|hand_landmarker\.task)$/);
    if (mp) {
      if (!o.mediapipe) return fin(res, 404, "Introuvable");
      if (o.verrou?.verrouille) return fin(res, 423, "Max est verrouillé");
      const nom = mp[1];
      const type = nom.endsWith(".wasm") ? "application/wasm" : nom.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/octet-stream";
      const servir = (f: string) => {
        res.writeHead(200, { "content-type": type, "cache-control": "max-age=86400" });
        fs.createReadStream(f).pipe(res);
      };
      if (nom !== "hand_landmarker.task") {
        const f = path.join(o.mediapipe.wasm, nom);
        return fs.existsSync(f) ? servir(f) : fin(res, 404, "Introuvable");
      }
      assurerModeleMain(o.mediapipe.dossierModele, o.mediapipe.urlModele).then(servir, (e: Error) => fin(res, 502, e.message));
      return;
    }

    if (estRouteMax(chemin)) {
      traiterMax(req, res, chemin, url).catch(() => fin(res, 500, "Erreur interne"));
      return;
    }

    if (chemin.startsWith("/api/") && o.verrou?.verrouille) return fin(res, 423, "Max est verrouillé");

    if (chemin === "/api/missions") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(listMissions(root)));
    }

    const m = chemin.match(/^\/api\/missions\/([^/]+)\/(resultat|fichier)$/);
    if (m || chemin.startsWith("/api/missions/")) {
      if (!m) return fin(res, 400, "Adresse invalide");
      const dir = dedans(root, m[1]);
      if (!dir || path.dirname(dir) !== root) return fin(res, 400, "Mission invalide");
      if (m[2] === "resultat") return envoyerFichier(res, path.join(dir, "RESULTAT.md"));
      const fichier = dedans(dir, url.searchParams.get("chemin") ?? "");
      if (!fichier) return fin(res, 400, "Chemin invalide");
      return envoyerFichier(res, fichier);
    }

    const fichier = dedans(path.resolve(o.webDir), chemin === "/" ? "index.html" : "." + chemin);
    if (!fichier) return fin(res, 404, "Introuvable");
    envoyerFichier(res, fichier);
  });

  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ req, origin }: { req: http.IncomingMessage; origin?: string }, accepter: (ok: boolean, code?: number) => void) =>
      accepter(hoteAutorise(req.headers.host) && (!origin || origin === `http://${req.headers.host}`), 403),
  });
  // le WebSocketServer relaie les erreurs du serveur HTTP (ex. port pris) : c'est `server.on("error")` qui les traite
  wss.on("error", () => {});
  const envoyer = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  /** Le temps passé par pôle (un pôle = un conseiller) et les dernières notes de son agent. */
  const poles = (): TempsPole[] | undefined => {
    if (!o.conseillers || !o.coach) return undefined;
    const temps = o.coach.temps();
    return o.conseillers.defs.map((d) => {
      const t = temps.get(d.id);
      return {
        id: d.id,
        aujourdhui: t?.aujourdhui ?? 0,
        semaine: t?.semaine ?? 0,
        jours: t?.jours ?? [0, 0, 0, 0, 0, 0, 0],
        limite: t?.limite ?? null,
        objectif: o.config.objectifsParJour?.[d.id] || null,
        notes: o.conseillers!.notes(d.id),
      };
    });
  };
  // verrouillé, la page ne reçoit rien de personnel : ni conversation, ni mission, ni agenda, ni conseillers
  const etatComplet = (): EtatBureau => {
    const verrou = o.verrou?.vue();
    if (verrou?.verrouille) {
      const a = o.assistant?.vue();
      return {
        claude: o.manager.snapshot().claude,
        mission: null,
        verrou,
        jarvis: { meteo: o.jarvis?.vue().meteo ?? null, agenda: null },
        // le réveil sonne : l'écran verrouillé le dit (sans rien de personnel)
        ...(o.reveil ? { reveil: o.reveil.vue() } : {}),
        ...(a ? { assistant: { etat: "veille", phrase: a.phrase, messages: [], oreille: a.oreille, bouche: a.bouche, cerveau: a.cerveau, vue: "jarvis", ...(a.ecoute ? { ecoute: a.ecoute } : {}) } } : {}),
      };
    }
    return {
      ...o.manager.snapshot(),
      assistant: o.assistant?.vue(),
      conseillers: o.conseillers?.vue(),
      jarvis: o.jarvis?.vue(),
      verrou,
      ...(o.planning ? { planning: o.planning.vue() } : {}),
      ...(o.triMails ? { mails: o.triMails.vue() } : {}),
      ...(o.sport ? { sport: o.sport.vue() } : {}),
      ...(o.vie ? { vie: o.vie.vue() } : {}),
      ...(o.studio ? { studio: o.studio.vue() } : {}),
      ...(o.coach && o.conseillers ? { poles: poles(), idees: lireIdees(root).slice(-8) } : {}),
      ...(intro ? { intro } : {}),
      ...(o.musique ? { musique: o.musique.disponible } : {}),
      ...(o.reveil ? { reveil: o.reveil.vue() } : {}),
    };
  };
  let intro = 0;
  const surIntro = (t: number) => {
    intro = t;
    diffuser();
  };
  o.musique?.on("intro", surIntro);
  const diffuser = () => {
    const etat = etatComplet();
    for (const ws of wss.clients) envoyer(ws, { type: "etat", etat });
  };
  o.manager.on("etat", diffuser);
  o.assistant?.on("etat", diffuser);
  o.conseillers?.on("etat", diffuser);
  o.jarvis?.on("etat", diffuser);
  o.verrou?.on("etat", diffuser);
  o.planning?.on("etat", diffuser);
  o.triMails?.on("etat", diffuser);
  o.sport?.on("etat", diffuser);
  o.vie?.on("etat", diffuser);
  o.studio?.on("etat", diffuser);
  o.reveil?.on("etat", diffuser);
  server.on("close", () => {
    o.reveil?.off("etat", diffuser);
    o.musique?.off("intro", surIntro);
    o.sport?.off("etat", diffuser);
    o.vie?.off("etat", diffuser);
    o.studio?.off("etat", diffuser);
    o.planning?.off("etat", diffuser);
    o.triMails?.off("etat", diffuser);
    o.verrou?.off("etat", diffuser);
    o.jarvis?.off("etat", diffuser);
    o.manager.off("etat", diffuser);
    o.assistant?.off("etat", diffuser);
    o.conseillers?.off("etat", diffuser);
    wss.close();
  });

  wss.on("connection", (ws) => {
    envoyer(ws, { type: "etat", etat: etatComplet() });
    ws.on("message", async (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return envoyer(ws, { type: "erreur", message: "Message incompréhensible." });
      }
      // une seule fenêtre de Max : la nouvelle page le dit aux autres, qui lui cèdent la place (même verrouillé)
      if (msg.type === "fenetre") {
        const nee = Number(msg.nee);
        if (Number.isFinite(nee)) for (const c of wss.clients) if (c !== ws) envoyer(c, { type: "fenetre", nee });
        return;
      }
      let r: { ok: boolean; erreur?: string } = { ok: true };
      const v = o.verrou;
      if (msg.type === "visage-verifier" || msg.type === "visage-enregistrer" || msg.type === "visage-effacer" || msg.type === "verrouiller") {
        if (!v) return envoyer(ws, { type: "visage", ok: false, texte: "La reconnaissance du visage n'est pas disponible." });
        if (msg.type === "verrouiller") {
          o.assistant?.veille();
          v.verrouiller();
          return;
        }
        const rv =
          msg.type === "visage-verifier"
            ? v.tenter(msg.descripteur, msg.vivant === true)
            : msg.type === "visage-enregistrer"
              ? v.enregistrer(Array.isArray(msg.descripteurs) ? msg.descripteurs : [], String(msg.prenom ?? ""))
              : v.effacer();
        return envoyer(ws, { type: "visage", ok: rv.ok, texte: rv.texte });
      }
      // l'oreille de la page marche aussi verrouillé : « Max » lance la reconnaissance du visage
      if (msg.type === "entendu") return void o.oreillePage?.recevoir(String(msg.texte ?? ""));
      if (msg.type === "micro") return void o.oreillePage?.signaler(msg.probleme ? String(msg.probleme).slice(0, 300) : null);
      if (v?.verrouille) return envoyer(ws, { type: "erreur", message: "🔒 Max est verrouillé : regarde la caméra pour le déverrouiller." });
      switch (msg.type) {
        case "lancer":
          r = o.manager.lancer(String(msg.texte ?? ""));
          break;
        case "arreter":
          o.manager.arreter();
          break;
        case "reprendre":
          r = o.manager.reprendre();
          break;
        case "ouvrir-dossier": {
          const nom = msg.nom ?? o.manager.snapshot().mission?.nom;
          const dir = nom ? dedans(root, path.basename(nom)) : root;
          fs.mkdirSync(root, { recursive: true });
          ouvrir(dir && fs.existsSync(dir) ? dir : root);
          break;
        }
        case "parler-max":
        case "reveil":
        case "veille":
        case "taire": {
          const a = o.assistant;
          if (!a) {
            r = { ok: false, erreur: "Max n'est pas disponible." };
            break;
          }
          if (msg.type === "parler-max") a.ecrire(String(msg.texte ?? ""));
          else if (msg.type === "reveil") a.reveiller();
          else if (msg.type === "veille") a.veille();
          else a.taire();
          break;
        }
        case "session":
        case "fin-session": {
          if (!o.coach) {
            r = { ok: false, erreur: "Le coach n'est pas disponible." };
            break;
          }
          const pole = String(msg.type === "session" ? (msg.pole ?? "") : "");
          const poleOk = !pole || !o.conseillers || o.conseillers.defs.some((d) => d.id === pole);
          const rc = !poleOk
            ? { ok: false, texte: "Pôle inconnu." }
            : msg.type === "session"
              ? o.coach.demarrerSession(String(msg.sujet ?? ""), Number(msg.minutes ?? 25), pole || undefined)
              : o.coach.arreterSession();
          r = rc.ok ? { ok: true } : { ok: false, erreur: rc.texte };
          if (rc.ok) o.assistant?.informer?.(`Depuis la page : ${rc.texte}`);
          break;
        }
        case "vue":
          if (msg.vue === "jarvis" || msg.vue === "bureau") o.assistant?.allerA?.(msg.vue);
          break;
        case "obscur":
          o.assistant?.modeObscur?.(msg.actif === true, true);
          break;
        case "pole": {
          const p = msg.pole === null ? null : String(msg.pole ?? "");
          if (p !== null && !o.conseillers?.defs.some((d) => d.id === p)) {
            r = { ok: false, erreur: "Pôle inconnu." };
            break;
          }
          o.assistant?.ouvrirPole?.(p, msg.focus === "corps" ? "corps" : null);
          break;
        }
        case "seance":
        case "semaine-sport": {
          if (!o.sport) {
            r = { ok: false, erreur: "Le suivi du sport n'est pas disponible." };
            break;
          }
          const rs = msg.type === "seance" ? o.sport.noter(String(msg.seance ?? ""), { jour: msg.jour ? String(msg.jour) : undefined }) : o.sport.changerSemaine([{ jour: Number(msg.jour), seance: String(msg.seance ?? "") }]);
          r = rs.ok ? { ok: true } : { ok: false, erreur: rs.texte };
          if (rs.ok) o.assistant?.informer?.(`Depuis la page : ${rs.texte}`);
          break;
        }
        case "artefact": {
          const art = ARTEFACTS.find((x) => x.id === msg.id);
          if (!art || !o.mac) {
            r = { ok: false, erreur: "Cet artefact ne peut pas s'ouvrir ici." };
            break;
          }
          const ra = await o.mac.ouvrirSite(art.url);
          r = ra.ok ? { ok: true } : { ok: false, erreur: ra.texte };
          break;
        }
        case "journal": {
          if (!o.vie) {
            r = { ok: false, erreur: "Le journal n'est pas disponible." };
            break;
          }
          const rj = o.vie.ecrire(String(msg.texte ?? ""));
          r = rj.ok ? { ok: true } : { ok: false, erreur: rj.texte };
          if (rj.ok) o.assistant?.informer?.(`Depuis la page, il a écrit dans son journal : « ${String(msg.texte).slice(0, 300)} »`);
          break;
        }
        case "publier":
        case "publiee": {
          const st = o.studio;
          const pf = String(msg.plateforme ?? "");
          if (!st || !["tiktok", "youtube", "instagram"].includes(pf)) {
            r = { ok: false, erreur: "Le Studio n'est pas disponible." };
            break;
          }
          const rp = msg.type === "publier" ? await st.publier(String(msg.video ?? ""), pf as Plateforme) : st.marquerPubliee(String(msg.video ?? ""), pf as Plateforme);
          r = rp.ok ? { ok: true } : { ok: false, erreur: rp.texte };
          if (rp.ok) o.assistant?.informer?.(`Depuis la page : ${rp.texte}`);
          break;
        }
        case "alarme": {
          const rv = o.reveil;
          if (!rv) {
            r = { ok: false, erreur: "Le réveil n'est pas disponible." };
            break;
          }
          if (msg.action === "confirmer") {
            rv.confirmer();
            break;
          }
          const ra = msg.action === "annuler" ? rv.annulerProchain() : msg.action === "essayer" ? await rv.essayer() : rv.regler(String(msg.heure ?? ""));
          r = ra.ok ? { ok: true } : { ok: false, erreur: ra.texte };
          if (ra.ok) o.assistant?.informer?.(`Depuis la page : ${ra.texte}`);
          break;
        }
        case "trier-mails":
          if (!o.trieur) {
            r = { ok: false, erreur: "Le tri des mails n'est pas disponible." };
            break;
          }
          void o.trieur.lancer(true).then((t) => !t.ok && envoyer(ws, { type: "erreur", message: t.texte }));
          break;
        default:
          r = { ok: false, erreur: "Message incompréhensible." };
      }
      if (!r.ok) envoyer(ws, { type: "erreur", message: r.erreur ?? "Erreur" });
    });
  });

  return server;
}
