import type { RoleId } from "../shared/protocol.ts";

export interface RoleDef {
  nom: string;
  emoji: string;
  couleur: string;
  outils: string[];
  instructions: string;
}

const COMMUN = `Tu fais partie de l'équipe du Bureau, dirigée par Max. Tu travailles seul, sans poser de question : personne ne peut te répondre pendant la mission.
Réponds et écris en français.
Ton dossier de travail est indiqué dans la consigne. N'écris aucun fichier en dehors de ce dossier.
À la fin, écris ton rapport dans le fichier rapport.md de ton dossier : ce que tu as fait, ce que tu as trouvé, et une section « Sources » (liens ou fichiers consultés).
Termine par une phrase courte qui résume ton travail.`;

export const ROLES: Record<RoleId, RoleDef> = {
  chercheur: {
    nom: "Chercheur",
    emoji: "🔎",
    couleur: "#4f9dde",
    outils: ["WebSearch", "WebFetch", "Read", "Write", "Edit", "Glob", "Grep"],
    instructions: `${COMMUN}
Ton métier : chercheur. Tu trouves des informations fiables et récentes sur le web. Tu recoupes chaque chiffre important (prix, dates, montants) avec au moins deux sources quand c'est possible, et tu indiques clairement ce qui n'a pas pu être vérifié. Chaque fait de ton rapport renvoie à sa source.`,
  },
  codeur: {
    nom: "Codeur",
    emoji: "💻",
    couleur: "#5cbf60",
    outils: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    instructions: `${COMMUN}
Ton métier : codeur. Tu modifies le code du projet dans le dossier courant, qui est une branche Git dédiée à la mission : tu peux y travailler librement. Lis le code existant avant de le changer et respecte son style. Lance les tests et le build du projet s'ils existent. Quand tu as fini, fais un commit Git de tes changements avec un message clair. Ne fais jamais de git push. Ton rapport liste les fichiers modifiés et comment vérifier le résultat.`,
  },
  designer: {
    nom: "Designer",
    emoji: "🎨",
    couleur: "#d96bc8",
    outils: ["Read", "Write", "Edit", "Glob", "Grep", "WebFetch"],
    instructions: `${COMMUN}
Ton métier : designer. Tu proposes des maquettes concrètes : fichiers HTML autonomes (CSS inclus) ou SVG que l'on peut ouvrir dans un navigateur, palettes de couleurs, parcours utilisateur. Ton rapport explique tes choix et liste les fichiers à ouvrir.`,
  },
  redacteur: {
    nom: "Rédacteur",
    emoji: "✍️",
    couleur: "#e8a33d",
    outils: ["Read", "Write", "Edit", "Glob", "Grep"],
    instructions: `${COMMUN}
Ton métier : rédacteur. Tu écris des textes prêts à l'emploi (posts, mails, articles, scripts), clairs et vivants, adaptés au public visé. Mets chaque texte final dans un fichier .md de ton dossier et résume-les dans ton rapport.`,
  },
  analyste: {
    nom: "Analyste",
    emoji: "📊",
    couleur: "#9b7be0",
    outils: ["Read", "Write", "Edit", "Glob", "Grep", "Bash"],
    instructions: `${COMMUN}
Ton métier : analyste. Tu compares, calcules et structures : tableaux, fichiers CSV, classements, recommandations argumentées. Vérifie tes calculs (tu peux utiliser Bash pour calculer). Indique d'où vient chaque chiffre et signale les données manquantes ou douteuses.`,
  },
};

/** Règles de refus pour les robots qui ont Bash (passées via --settings, car elles contiennent des espaces). */
export const DENY_RULES = ["Bash(git push:*)", "Bash(rm -rf:*)", "Bash(sudo:*)"];

const MAX_PLAN_TOOLS = ["Read", "Glob", "Grep"];
const MAX_REVIEW_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit"];

const addDirs = (dirs: string[]) => dirs.flatMap((d) => ["--add-dir", d]);

export function robotArgs(opts: {
  role: RoleId;
  prompt: string;
  model: string;
  extraDirs: string[];
  resumeSessionId?: string;
}): string[] {
  const role = ROLES[opts.role];
  const outils = role.outils.join(",");
  const args = [
    "-p", opts.prompt,
    "--model", opts.model,
    "--output-format", "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--permission-mode", "acceptEdits",
    "--tools", outils,
    "--allowedTools", outils,
    "--append-system-prompt", role.instructions,
    ...addDirs(opts.extraDirs),
  ];
  if (role.outils.includes("Bash")) args.push("--settings", JSON.stringify({ permissions: { deny: DENY_RULES } }));
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}

export function planArgs(opts: { prompt: string; model: string; schema: object; extraDirs: string[] }): string[] {
  const outils = MAX_PLAN_TOOLS.join(",");
  return [
    "-p", opts.prompt,
    "--model", opts.model,
    "--output-format", "json",
    "--json-schema", JSON.stringify(opts.schema),
    "--strict-mcp-config",
    "--permission-mode", "default",
    "--tools", outils,
    "--allowedTools", outils,
    ...addDirs(opts.extraDirs),
  ];
}

export function reviewArgs(opts: { prompt: string; model: string; resumeSessionId?: string }): string[] {
  const outils = MAX_REVIEW_TOOLS.join(",");
  const args = [
    "-p", opts.prompt,
    "--model", opts.model,
    "--output-format", "stream-json",
    "--verbose",
    "--strict-mcp-config",
    "--permission-mode", "acceptEdits",
    "--tools", outils,
    "--allowedTools", outils,
  ];
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}
