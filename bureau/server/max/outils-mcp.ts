// Serveur MCP « bureau » : les outils de Max. Lancé par Claude Code (cerveau de Max), il appelle l'API du Bureau
// sur 127.0.0.1 avec le jeton lu dans BUREAU_JETON_FICHIER.
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BUREAU = process.env.BUREAU_URL ?? "http://127.0.0.1:4747";

const jeton = () => {
  try {
    return fs.readFileSync(process.env.BUREAU_JETON_FICHIER ?? "", "utf8").trim();
  } catch {
    return "";
  }
};

async function appeler(methode: "GET" | "POST", chemin: string, corps?: object) {
  let texte: string;
  let ok: boolean;
  try {
    const r = await fetch(BUREAU + chemin, {
      method: methode,
      headers: { "x-bureau-jeton": jeton(), "content-type": "application/json" },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const j = (await r.json().catch(() => null)) as { ok: boolean; texte: string } | null;
    ok = !!j?.ok;
    texte = j?.texte ?? `Réponse inattendue du Bureau (${r.status}).`;
  } catch (e) {
    ok = false;
    texte = `Le Bureau ne répond pas : ${(e as Error).message}`;
  }
  return { content: [{ type: "text" as const, text: texte }], isError: !ok };
}

const serveur = new McpServer({ name: "bureau", version: "1.0.0" });

serveur.registerTool(
  "lancer_mission",
  {
    description: "Lance une mission pour l'équipe de robots du Bureau (recherche, comparaison, rédaction, analyse, code…). Une seule mission à la fois.",
    inputSchema: { texte: z.string().min(1).describe("La consigne complète et précise de la mission : objectif, contexte, forme du résultat attendu") },
  },
  async ({ texte }) => appeler("POST", "/api/outils/lancer", { texte }),
);
serveur.registerTool("etat_bureau", { description: "Où en est la mission en cours et ce que fait chaque robot." }, async () => appeler("GET", "/api/outils/etat"));
serveur.registerTool("arreter_mission", { description: "Arrête la mission en cours." }, async () => appeler("POST", "/api/outils/arreter"));
serveur.registerTool("reprendre_mission", { description: "Reprend une mission mise en pause (quota atteint)." }, async () => appeler("POST", "/api/outils/reprendre"));
serveur.registerTool(
  "lire_resultat",
  {
    description: "Lit le résultat (RESULTAT.md) de la mission en cours, ou d'une mission passée si on donne son nom (voir historique_missions).",
    inputSchema: { nom: z.string().optional().describe("Nom de dossier d'une mission passée") },
  },
  async ({ nom }) => appeler("GET", `/api/outils/resultat${nom ? `?nom=${encodeURIComponent(nom)}` : ""}`),
);
serveur.registerTool("historique_missions", { description: "Les missions passées, les plus récentes d'abord." }, async () => appeler("GET", "/api/outils/historique"));
serveur.registerTool(
  "memoriser",
  {
    description: "Écrit une note durable dans ton carnet sur l'utilisateur (prénom, projets, goûts, habitudes). Une note courte par fait.",
    inputSchema: { note: z.string().min(1).describe("Le fait à retenir, en une phrase courte") },
  },
  async ({ note }) => appeler("POST", "/api/outils/memoriser", { note }),
);
serveur.registerTool(
  "oublier",
  {
    description: "Retire du carnet les notes qui contiennent ce texte.",
    inputSchema: { texte: z.string().min(1).describe("Un mot ou un morceau de phrase présent dans les notes à retirer") },
  },
  async ({ texte }) => appeler("POST", "/api/outils/oublier", { texte }),
);
serveur.registerTool(
  "mettre_en_veille",
  { description: "Met Max en veille (micro coupé) après la phrase en cours. À utiliser quand l'utilisateur te dit de te mettre en veille ou au revoir." },
  async () => appeler("POST", "/api/outils/veille"),
);

await serveur.connect(new StdioServerTransport());
