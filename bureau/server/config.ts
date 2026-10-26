import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSEILLERS_DEFAUT, type ConseillerDef } from "./max/conseillers.ts";
import type { FenetreConfig } from "./fenetre.ts";

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
  /** « auto » : la voix Piper si elle est installée (`npm run voix`), sinon `say` ; ou imposer l'un des deux. */
  moteur: "auto" | "piper" | "say";
  /** La voix Piper (un nom de rhasspy/piper-voices). */
  voixPiper: string;
  /** Vitesse de la voix Piper (1 = normale, 1.1 = un peu plus rapide). */
  vitessePiper: number;
  /** Nom d'une voix de `say -v ?` ; null = meilleure voix française installée. */
  voixMac: string | null;
  /** Vitesse de `say`, en mots par minute. */
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
  mac: MacConfig;
  /** La reconnaissance du visage : active dès qu'un visage est enregistré (false = jamais de verrou). */
  visage: { actif: boolean };
  /** Minutes par jour au plus, par pôle (0 = pas de limite) : Max prévient quand une session les dépasse. */
  tempsParJour: Record<string, number>;
  /** Objectif de minutes par jour, par pôle (affiché comme une barre à remplir). */
  objectifsParJour: Record<string, number>;
  /** Ta musique (MP3) : l'intro quand Max se lance, et le fond de l'appel du réveil. */
  musique: { fichier: string; intro: boolean; /** Mot du nom de ton mp3, pour que le Bureau le retrouve tout seul (Téléchargements, Musique…). */ recherche: string };
  /** Le réveil : Max t'appelle sur ton téléphone (par Twilio). */
  reveil: ReveilConfig;
  /** Où s'ouvre Max : une fenêtre à part (mode app de Chrome, Brave, Edge…) ou ton navigateur. */
  fenetre: FenetreConfig;
}

export interface ReveilConfig {
  /** « mac » : Max te réveille sur le Mac (gratuit) ; « appel » : il t'appelle (Twilio) ; « les-deux » : le Mac, puis l'appel. */
  mode: "mac" | "appel" | "les-deux";
  /** Ton numéro, au format international (+33612345678) ; null = pas de réveil par appel. */
  telephone: string | null;
  /** L'heure habituelle ; Max la change avec toi le soir. */
  heure: string;
  rappelMinutes: number;
  essais: number;
  /** La voix Twilio de secours (si la voix de Max n'a pas pu être préparée). */
  voixTwilio: string;
  twilio: { compte: string; jeton: string; numero: string; cle: string };
}

export interface MacConfig {
  /** La ville de la météo ; null = devinée. */
  ville: string | null;
  musique: "auto" | "spotify" | "musique";
  /** Où ranger les captures d'écran ; null = le Bureau du Mac. */
  dossierCaptures: string | null;
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
    moteur: "auto",
    voixPiper: "fr_FR-tom-medium",
    vitessePiper: 1,
    voixMac: null,
    debit: 175,
    motCle: "max",
    phraseSiri: "Max au rapport",
    suiteSecondes: 10,
    veilleMinutes: 30,
  },
  conseillers: CONSEILLERS_DEFAUT,
  mac: { ville: null, musique: "auto", dossierCaptures: null },
  visage: { actif: true },
  tempsParJour: { business: 60 },
  objectifsParJour: { etudes: 360 },
  musique: { fichier: "~/Documents/Bureau/musique/max.mp3", intro: true, recherche: "real.?gone" },
  fenetre: { mode: "app", navigateur: null },
  reveil: { mode: "mac", telephone: null, heure: "07:00", rappelMinutes: 5, essais: 4, voixTwilio: "Polly.Remi-Neural", twilio: { compte: "", jeton: "", numero: "", cle: "" } },
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
    mac: { ...DEFAULT_CONFIG.mac, ...user.mac },
    visage: { ...DEFAULT_CONFIG.visage, ...user.visage },
    tempsParJour: { ...DEFAULT_CONFIG.tempsParJour, ...user.tempsParJour },
    objectifsParJour: { ...DEFAULT_CONFIG.objectifsParJour, ...user.objectifsParJour },
    musique: { ...DEFAULT_CONFIG.musique, ...user.musique },
    reveil: { ...DEFAULT_CONFIG.reveil, ...user.reveil, twilio: { ...DEFAULT_CONFIG.reveil.twilio, ...user.reveil?.twilio } },
    fenetre: { ...DEFAULT_CONFIG.fenetre, ...user.fenetre },
    conseillers: Array.isArray(user.conseillers) && user.conseillers.length ? user.conseillers.map(completerConseiller) : DEFAULT_CONFIG.conseillers,
  };
  if (c.mac.dossierCaptures) c.mac.dossierCaptures = expandHome(c.mac.dossierCaptures);
  c.musique.fichier = expandHome(c.musique.fichier);
  c.voix.modele = c.voix.modele ? expandHome(c.voix.modele) : path.join(c.dossierDonnees, "modeles", MODELE_WHISPER);
  return c;
}
