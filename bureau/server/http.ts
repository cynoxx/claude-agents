import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "../shared/protocol.ts";
import type { BureauConfig } from "./config.ts";
import type { MissionManager } from "./mission.ts";
import { listMissions } from "./storage.ts";

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
}): http.Server {
  const root = path.resolve(o.config.dossierMissions);
  const ouvrir = o.ouvrir ?? ouvrirDansFinder;

  const envoyerFichier = (res: http.ServerResponse, fichier: string) => {
    if (!fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) return fin(res, 404, "Introuvable");
    res.writeHead(200, { "content-type": TYPES[path.extname(fichier).toLowerCase()] ?? "text/plain; charset=utf-8" });
    fs.createReadStream(fichier).pipe(res);
  };
  const fin = (res: http.ServerResponse, code: number, texte: string) => {
    res.writeHead(code, { "content-type": "text/plain; charset=utf-8" });
    res.end(texte);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let chemin: string;
    try {
      chemin = decodeURIComponent(url.pathname);
    } catch {
      return fin(res, 400, "Adresse invalide");
    }

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

  const wss = new WebSocketServer({ server, path: "/ws" });
  // le WebSocketServer relaie les erreurs du serveur HTTP (ex. port pris) : c'est `server.on("error")` qui les traite
  wss.on("error", () => {});
  const envoyer = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const diffuser = (etat: ReturnType<MissionManager["snapshot"]>) => {
    for (const ws of wss.clients) envoyer(ws, { type: "etat", etat });
  };
  o.manager.on("etat", diffuser);
  server.on("close", () => {
    o.manager.off("etat", diffuser);
    wss.close();
  });

  wss.on("connection", (ws) => {
    envoyer(ws, { type: "etat", etat: o.manager.snapshot() });
    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return envoyer(ws, { type: "erreur", message: "Message incompréhensible." });
      }
      let r: { ok: boolean; erreur?: string } = { ok: true };
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
        default:
          r = { ok: false, erreur: "Message incompréhensible." };
      }
      if (!r.ok) envoyer(ws, { type: "erreur", message: r.erreur ?? "Erreur" });
    });
  });

  return server;
}
