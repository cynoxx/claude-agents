import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSEILLERS_DEFAUT, type ConseillerDef } from "./max/conseillers.ts";

export interface Projet {
  nom: string;
  chemin: string;
}

export interface VoixConfig {
  active: boolean;
  ffmpeg: string;
  whisper: string;
  say: string;
  /** Chemin du modèle Whisper ; par défaut dans `dossierDonnees/modeles`. */
  modele: string | null;
  /** Micro au format avfoundation (ex. ":1") ; null = choisi automatiquement. */
  micro: string | null;
  /** Nom d'une voix de `say -v ?` ; null = meilleure voix française installée. */
  voixMac: string | null;
  debit: number;
  motCle: string;
  /** Le nom du raccourci Siri (« Dis Siri, <phrase> »), rappelé quand Max s'endort. */
  phraseSiri: string;
  suiteSecondes: number;
  veilleMinutes: number;
}

export interface BureauConfig {
  port: number;
  dossierMissions: string;
  /** Fichiers techniques (modèle Whisper, jeton) : hors de Documents, souvent synchronisé avec iCloud. */
  dossierDonnees: string;
  projets: Projet[];
  modeles: { chef: string; robots: string; conversation: string };
  limites: { robots: number; etapes: number; minutesParRobot: number };
  voix: VoixConfig;
  /** Un conseiller par domaine de la vie (remplace la liste par défaut si présent). */
  conseillers: ConseillerDef[];
}

export const CONFIG_FILE = "bureau.config.json";
export const MODELE_WHISPER = "ggml-large-v3-turbo-q5_0.bin";

export const DEFAULT_CONFIG: BureauConfig = {
  port: 4747,
  dossierMissions: "~/Documents/Bureau",
  dossierDonnees: "~/Library/Application Support/Bureau",
  projets: [],
  modeles: { chef: "opus", robots: "sonnet", conversation: "opus" },
  limites: { robots: 5, etapes: 3, minutesParRobot: 20 },
  voix: {
    active: true,
    ffmpeg: "ffmpeg",
    whisper: "whisper-cli",
    say: "say",
    modele: null,
    micro: null,
    voixMac: null,
    debit: 185,
    motCle: "max",
    phraseSiri: "Max au rapport",
    suiteSecondes: 10,
    veilleMinutes: 30,
  },
  conseillers: CONSEILLERS_DEFAUT,
};

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Un conseiller écrit à la main : on complète ce qui manque (un défaut du même id, sinon des valeurs neutres). */
function completerConseiller(c: Partial<ConseillerDef>, i: number): ConseillerDef {
  const base = CONSEILLERS_DEFAUT.find((d) => d.id === c.id);
  const id = String(c.id ?? base?.id ?? `conseiller-${i + 1}`);
  return {
    id,
    nom: c.nom ?? base?.nom ?? id,
    emoji: c.emoji ?? base?.emoji ?? "🤖",
    couleur: c.couleur ?? base?.couleur ?? ["#e05d5d", "#3fbfa8", "#d9a441", "#6c8cff", "#b07cc6", "#7fbf3f"][i % 6],
    domaine: c.domaine ?? base?.domaine ?? id,
    description: c.description ?? base?.description ?? c.domaine ?? id,
    consigne: c.consigne ?? base?.consigne ?? "",
  };
}

/** Lit `bureau.config.json` dans `dir` (s'il existe) et le fusionne avec les valeurs par défaut. */
export function loadConfig(dir: string): BureauConfig {
  const file = path.join(dir, CONFIG_FILE);
  let user: Partial<BureauConfig> = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`${CONFIG_FILE} n'est pas un JSON valide : ${(e as Error).message}`);
    }
  }
  const c: BureauConfig = {
    port: user.port ?? DEFAULT_CONFIG.port,
    dossierMissions: expandHome(user.dossierMissions ?? DEFAULT_CONFIG.dossierMissions),
    dossierDonnees: expandHome(user.dossierDonnees ?? DEFAULT_CONFIG.dossierDonnees),
    projets: (user.projets ?? DEFAULT_CONFIG.projets).map((p) => ({ nom: p.nom, chemin: expandHome(p.chemin) })),
    modeles: { ...DEFAULT_CONFIG.modeles, ...user.modeles },
    limites: { ...DEFAULT_CONFIG.limites, ...user.limites },
    voix: { ...DEFAULT_CONFIG.voix, ...user.voix },
    conseillers: Array.isArray(user.conseillers) && user.conseillers.length ? user.conseillers.map(completerConseiller) : DEFAULT_CONFIG.conseillers,
  };
  c.voix.modele = c.voix.modele ? expandHome(c.voix.modele) : path.join(c.dossierDonnees, "modeles", MODELE_WHISPER);
  return c;
}
