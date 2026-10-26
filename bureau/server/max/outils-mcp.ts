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

// --- coach : sessions de travail, bilan, échéances, idées, rappels ---

serveur.registerTool(
  "demarrer_session",
  {
    description: "Lance une session de travail minutée (le Bureau prévient à la fin et note le temps dans le journal). Une à la fois.",
    inputSchema: {
      sujet: z.string().describe("Ce qu'il va travailler, en quelques mots (ex. « Anatomie, chapitre 3 »)"),
      minutes: z.number().int().min(1).max(180).default(25).describe("Durée en minutes (25 par défaut)"),
    },
  },
  async ({ sujet, minutes }) => appeler("POST", "/api/outils/session", { sujet, minutes }),
);
serveur.registerTool(
  "demarrer_pause",
  {
    description: "Lance une pause minutée (non comptée comme travail) ; le Bureau prévient à la fin.",
    inputSchema: { minutes: z.number().int().min(1).max(60).default(5).describe("Durée en minutes (5 par défaut)") },
  },
  async ({ minutes }) => appeler("POST", "/api/outils/pause", { minutes }),
);
serveur.registerTool(
  "arreter_session",
  {
    description: "Arrête la session de travail (ou la pause) en cours ; le temps réellement fait est noté.",
    inputSchema: { note: z.string().optional().describe("Ce qu'il a fait pendant la session, s'il l'a dit") },
  },
  async ({ note }) => appeler("POST", "/api/outils/fin-session", { note }),
);
serveur.registerTool("bilan_travail", { description: "Le temps de travail noté : aujourd'hui, hier, les 7 derniers jours, la série de jours d'affilée." }, async () =>
  appeler("GET", "/api/outils/bilan"),
);
serveur.registerTool(
  "ajouter_echeance",
  {
    description: "Ajoute une échéance (examen, rendu, rendez-vous) dans le fichier moi.md ; le Bureau en fait le compte à rebours.",
    inputSchema: { date: z.string().describe("Date au format AAAA-MM-JJ"), nom: z.string().min(1).describe("Ce qui a lieu ce jour-là") },
  },
  async ({ date, nom }) => appeler("POST", "/api/outils/echeance", { date, nom }),
);
serveur.registerTool(
  "noter_idee",
  {
    description: "Met une idée au parking (idees.md) pour y revenir plus tard, sans s'y lancer maintenant.",
    inputSchema: { idee: z.string().min(1).describe("L'idée, en une ou deux phrases") },
  },
  async ({ idee }) => appeler("POST", "/api/outils/idee", { idee }),
);
serveur.registerTool("lire_idees", { description: "Les idées au parking." }, async () => appeler("GET", "/api/outils/idees"));
serveur.registerTool(
  "programmer_rappel",
  {
    description: "Programme un rappel que Max dira à voix haute au moment voulu (si le Bureau est ouvert). Donne dans_minutes OU heure.",
    inputSchema: {
      texte: z.string().min(1).describe("La phrase exacte à dire au moment du rappel, adressée à l'utilisateur (ex. « Il est 23 heures, au lit ! »)"),
      dans_minutes: z.number().int().min(1).optional().describe("Dans combien de minutes"),
      heure: z.string().optional().describe("Heure au format HH:MM (demain si elle est déjà passée)"),
    },
  },
  async ({ texte, dans_minutes, heure }) => appeler("POST", "/api/outils/rappel", { texte, dans_minutes, heure }),
);
serveur.registerTool("liste_rappels", { description: "Les rappels programmés." }, async () => appeler("GET", "/api/outils/rappels"));
serveur.registerTool(
  "annuler_rappel",
  { description: "Annule les rappels qui contiennent ce texte.", inputSchema: { texte: z.string().min(1).describe("Un mot du rappel à annuler") } },
  async ({ texte }) => appeler("POST", "/api/outils/annuler-rappel", { texte }),
);

// --- conseillers : un par domaine de la vie ---

serveur.registerTool(
  "consulter_conseiller",
  {
    description:
      "Pose une question à un conseiller du Bureau (etudes, sante, business, apps, vie…). Il réfléchit à son bureau (avec recherche web si besoin) et renvoie sa réponse, en une minute environ.",
    inputSchema: {
      conseiller: z.string().min(1).describe("L'identifiant du conseiller (voir ta consigne), ex. « etudes »"),
      question: z.string().min(1).describe("La question complète, avec le contexte utile"),
    },
  },
  async ({ conseiller, question }) => appeler("POST", "/api/outils/consulter", { conseiller, question }),
);
serveur.registerTool(
  "noter_pour_conseiller",
  {
    description: "Écrit une note durable dans le carnet d'un conseiller (un fait utile pour son domaine).",
    inputSchema: { conseiller: z.string().min(1).describe("L'identifiant du conseiller"), note: z.string().min(1).describe("Le fait à retenir") },
  },
  async ({ conseiller, note }) => appeler("POST", "/api/outils/noter-pour", { conseiller, note }),
);

await serveur.connect(new StdioServerTransport());
