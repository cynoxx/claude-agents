// Les routes de Max : santé (libre), réveil et outils (protégés par le jeton du Bureau).
import type { EventEmitter } from "node:events";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { AssistantVue } from "../shared/protocol.ts";
import type { BureauConfig } from "./config.ts";
import { jetonValide } from "./jeton.ts";
import { memoriser, oublier } from "./max/carnet.ts";
import { decrireEtat, decrireHistorique } from "./max/descriptions.ts";
import type { MissionManager } from "./mission.ts";
import { listMissions } from "./storage.ts";

/** Ce que le serveur HTTP attend de l'assistant vocal (émet `etat` quand sa vue change). */
export interface AssistantApi extends EventEmitter {
  vue(): AssistantVue;
  reveiller(): void;
  veille(): void;
  veilleApresParole(): void;
  taire(): void;
  ecrire(texte: string): void;
}

const MAX_RESULTAT = 8000;

function repondre(res: http.ServerResponse, code: number, corps: object): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corps));
}

async function lireCorps(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let brut = "";
  for await (const morceau of req) {
    brut += morceau;
    if (brut.length > 64 * 1024) throw new Error("trop long");
  }
  if (!brut) return {};
  const j = JSON.parse(brut);
  return j && typeof j === "object" ? j : {};
}

export const estRouteMax = (chemin: string) => chemin === "/api/sante" || chemin === "/api/reveil" || chemin.startsWith("/api/outils/");

export function routesMax(o: { config: BureauConfig; manager: MissionManager; jeton?: string; assistant?: AssistantApi }) {
  const root = path.resolve(o.config.dossierMissions);

  const resultat = (nom: string | null): { ok: boolean; texte: string } => {
    const dossier = nom ? path.join(root, path.basename(nom)) : null;
    const contenu = dossier
      ? fs.existsSync(path.join(dossier, "RESULTAT.md"))
        ? fs.readFileSync(path.join(dossier, "RESULTAT.md"), "utf8")
        : null
      : (o.manager.snapshot().mission?.resultat ?? null);
    if (!contenu) return { ok: false, texte: "Pas de résultat disponible pour cette mission." };
    return { ok: true, texte: contenu.length > MAX_RESULTAT ? contenu.slice(0, MAX_RESULTAT) + "\n(… la suite est dans le fichier RESULTAT.md)" : contenu };
  };

  return async (req: http.IncomingMessage, res: http.ServerResponse, chemin: string, url: URL): Promise<void> => {
    if (chemin === "/api/sante") return repondre(res, 200, { bureau: true });
    if (!jetonValide(o.jeton, req.headers["x-bureau-jeton"])) return repondre(res, 403, { ok: false, texte: "Accès refusé : jeton du Bureau invalide." });

    let corps: Record<string, unknown> = {};
    try {
      if (req.method === "POST") corps = await lireCorps(req);
    } catch {
      return repondre(res, 400, { ok: false, texte: "Requête illisible." });
    }
    const texte = (cle: string) => String(corps[cle] ?? "").trim();
    const m = o.manager;

    switch (`${req.method} ${chemin}`) {
      case "POST /api/reveil":
        if (!o.assistant) return repondre(res, 503, { ok: false, texte: "Max n'est pas disponible." });
        o.assistant.reveiller();
        return repondre(res, 200, { ok: true, texte: "Max est réveillé." });
      case "GET /api/outils/etat":
        return repondre(res, 200, { ok: true, texte: decrireEtat(m.snapshot().mission) });
      case "POST /api/outils/lancer": {
        const r = m.lancer(texte("texte"));
        return repondre(res, 200, r.ok ? { ok: true, texte: "Mission lancée : l'équipe se met au travail." } : { ok: false, texte: r.erreur });
      }
      case "POST /api/outils/arreter": {
        const phase = m.snapshot().mission?.phase;
        if (!phase || !["planification", "travail", "relecture", "pause"].includes(phase)) return repondre(res, 200, { ok: false, texte: "Aucune mission en cours." });
        m.arreter();
        return repondre(res, 200, { ok: true, texte: "Mission arrêtée." });
      }
      case "POST /api/outils/reprendre": {
        const r = m.reprendre();
        return repondre(res, 200, r.ok ? { ok: true, texte: "Mission reprise." } : { ok: false, texte: r.erreur });
      }
      case "GET /api/outils/resultat":
        return repondre(res, 200, resultat(url.searchParams.get("nom")));
      case "GET /api/outils/historique":
        return repondre(res, 200, { ok: true, texte: decrireHistorique(listMissions(root)) });
      case "POST /api/outils/memoriser":
        try {
          return repondre(res, 200, { ok: true, texte: `Noté dans le carnet : ${memoriser(root, texte("note"))}` });
        } catch (e) {
          return repondre(res, 200, { ok: false, texte: (e as Error).message });
        }
      case "POST /api/outils/oublier": {
        const n = oublier(root, texte("texte"));
        return repondre(res, 200, { ok: true, texte: `${n} note(s) retirée(s) du carnet.` });
      }
      case "POST /api/outils/veille":
        o.assistant?.veilleApresParole();
        return repondre(res, 200, { ok: true, texte: "Max se met en veille après sa phrase." });
      default:
        return repondre(res, 404, { ok: false, texte: "Outil inconnu." });
    }
  };
}
