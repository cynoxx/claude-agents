import type { Plateforme } from "../shared/protocol.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSEILLERS_DEFAUT, type ConseillerDef } from "./max/conseillers.ts";
import type { FenetreConfig } from "./fenetre.ts";
import type { ElevenLabsConfig } from "./voix/elevenlabs.ts";
import type { XttsConfig } from "./voix/xtts.ts";

export interface Projet {
  nom: string;
  chemin: string;
}

export interface VoixConfig {
  active: boolean;
  /**
   * Qui écoute : « page » (la reconnaissance vocale de Chrome, dans la fenêtre de Max : rapide, texte en direct) ou
   * « mac » (le micro capturé par ffmpeg puis transcrit par Whisper, tout sur le Mac, plus lent).
   */
  ecoute: "page" | "mac";
  /** Le silence qui marque la fin de ta phrase, en millisecondes (plus long : il te laisse finir). */
  pauseFinMs: number;
  ffmpeg: string;
  whisper: string;
  say: string;
  /** Chemin du modèle Whisper ; par défaut dans `dossierDonnees/modeles`. */
  modele: string | null;
  /** Micro au format avfoundation (ex. ":1") ; null = choisi automatiquement. */
  micro: string | null;
  /**
   * « auto » : ElevenLabs si une voix est choisie (`npm run voix-humaine`), sinon XTTS s'il est installé
   * (`npm run voix-xtts`), sinon Piper s'il est installé
   * (`npm run voix`), sinon `say` ; ou imposer l'un d'eux.
   */
  moteur: "auto" | "elevenlabs" | "xtts" | "piper" | "say";
  /** La voix neuronale locale XTTS (`npm run voix-xtts`). */
  xtts: XttsConfig;
  /** La voix humaine de Max (ElevenLabs, dans le nuage). */
  elevenlabs: ElevenLabsConfig;
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
  /** Annoncer à voix haute chaque créneau de l'emploi du temps (false : il s'affiche seulement). */
  annoncesCreneaux: boolean;
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
  /**
   * Max Ultime (le mode obscur) : la durée de la session de concentration, et des raccourcis de l'app Raccourcis à
   * lancer en entrant et en sortant (par exemple activer puis couper la Concentration « Ne pas déranger »).
   */
  obscur: { minutes: number; raccourciEntree: string | null; raccourciSortie: string | null };
  /**
   * Le cerveau de Max en conversation : « claude » (par défaut), ou « local » = une IA sur ton Mac via un serveur
   * compatible OpenAI (Ollama : http://localhost:11434/v1, LM Studio : http://localhost:1234/v1, AnythingLLM…).
   */
  cerveau: { moteur: "claude" | "local"; url: string; modele: string; cle: string; outils: boolean };
  /** Le compagnon (npm run compagnon) : un deuxième assistant pour parler, avec l'IA locale (LM Studio par défaut). */
  compagnon: { nom: string; port: number; url: string; modele: string; cle: string; pauseFinMs: number };
  /** Trois claquements de mains pour allumer Max (npm run claque) : la sensibilité (0 à 1, plus bas = plus sensible). */
  claque: { sensibilite: number };
  /** Tes outils : Notion et Super Productivity (liens directs), et le fichier Excel du suivi d'habitudes. */
  liens: { notion: string; superProductivity: string; habitudes: string };
  /** Le Studio vidéo : un dossier (iCloud Drive, pour y accéder depuis l'iPhone) et tes comptes. */
  studio: StudioConfig;
}

export interface CompteStudio {
  id: string;
  nom: string;
  /** « voix » : tu déposes ta voix, le Studio monte la vidéo ; « clips » : tu déposes des vidéos prêtes. */
  type: "voix" | "clips";
  /** L'heure de publication de chaque plateforme (HH:MM), une vidéo par jour. */
  horaires: Partial<Record<Plateforme, string>>;
  /** La légende : {titre} et {phrase} (la première phrase que tu dis). */
  legende: string;
  bandeau?: string;
  appel?: string;
  couleur?: string;
}

export interface StudioConfig {
  /** null : pas de Studio. */
  dossier: string | null;
  /** Rappeler à voix haute l'heure de publier. */
  rappels: boolean;
  comptes: CompteStudio[];
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
  // la conversation en Sonnet : des réponses en 2 à 3 secondes au lieu de 6 à 10 (« opus » dans bureau.config.json pour revenir)
  modeles: { chef: "opus", robots: "sonnet", conversation: "sonnet" },
  limites: { robots: 5, etapes: 3, minutesParRobot: 20 },
  voix: {
    active: true,
    ecoute: "page",
    pauseFinMs: 1200,
    ffmpeg: "ffmpeg",
    whisper: "whisper-cli",
    say: "say",
    modele: null,
    micro: null,
    moteur: "auto",
    elevenlabs: { cle: "", voix: null, nomVoix: null, modele: "eleven_multilingual_v2", stabilite: 0.45, similarite: 0.8, style: 0.2, vitesse: 1 },
    xtts: { locuteur: "Damien Black", vitesse: 1, appareil: "cpu" },
    voixPiper: "fr_FR-tom-medium",
    vitessePiper: 1,
    voixMac: null,
    debit: 175,
    motCle: "max",
    phraseSiri: "Max au rapport",
    suiteSecondes: 30,
    annoncesCreneaux: false,
    veilleMinutes: 30,
  },
  conseillers: CONSEILLERS_DEFAUT,
  mac: { ville: null, musique: "auto", dossierCaptures: null },
  visage: { actif: true },
  tempsParJour: { business: 60 },
  objectifsParJour: { etudes: 360 },
  musique: { fichier: "~/Documents/Bureau/musique/max.mp3", intro: true, recherche: "bella.?ciao" },
  fenetre: { mode: "app", navigateur: null },
  obscur: { minutes: 50, raccourciEntree: null, raccourciSortie: null },
  cerveau: { moteur: "claude", url: "http://localhost:11434/v1", modele: "qwen2.5:7b", cle: "", outils: true },
  compagnon: { nom: "Tokyo", port: 4848, url: "http://127.0.0.1:1234/v1", modele: "auto", cle: "", pauseFinMs: 1300 },
  claque: { sensibilite: 0.12 },
  liens: { notion: "", superProductivity: "", habitudes: "~/Documents/Bureau/Suivi habitudes.xlsx" },
  studio: {
    dossier: "~/Library/Mobile Documents/com~apple~CloudDocs/Max Studio",
    rappels: true,
    comptes: [
      {
        id: "asclepium",
        nom: "Asclepium",
        type: "voix",
        horaires: { tiktok: "19:30", youtube: "16:30", instagram: "21:00" },
        legende: "{titre} — {phrase}\n\nLe livre complet : lien en bio.\n#medecine #pass #las #etudiantenmedecine #motivation #asclepium",
        bandeau: "48 lois pour réussir en médecine",
        appel: "Le livre complet : lien en bio",
        couleur: "#FFD23F",
      },
      { id: "fruit-tv", nom: "Fruit TV", type: "clips", horaires: { tiktok: "18:00" }, legende: "{titre}\n#fruittv #clip #pourtoi" },
    ],
  },
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
    voix: { ...DEFAULT_CONFIG.voix, ...user.voix, elevenlabs: { ...DEFAULT_CONFIG.voix.elevenlabs, ...user.voix?.elevenlabs }, xtts: { ...DEFAULT_CONFIG.voix.xtts, ...user.voix?.xtts } },
    mac: { ...DEFAULT_CONFIG.mac, ...user.mac },
    visage: { ...DEFAULT_CONFIG.visage, ...user.visage },
    tempsParJour: { ...DEFAULT_CONFIG.tempsParJour, ...user.tempsParJour },
    objectifsParJour: { ...DEFAULT_CONFIG.objectifsParJour, ...user.objectifsParJour },
    musique: { ...DEFAULT_CONFIG.musique, ...user.musique },
    reveil: { ...DEFAULT_CONFIG.reveil, ...user.reveil, twilio: { ...DEFAULT_CONFIG.reveil.twilio, ...user.reveil?.twilio } },
    fenetre: { ...DEFAULT_CONFIG.fenetre, ...user.fenetre },
    obscur: { ...DEFAULT_CONFIG.obscur, ...user.obscur },
    cerveau: { ...DEFAULT_CONFIG.cerveau, ...user.cerveau },
    compagnon: { ...DEFAULT_CONFIG.compagnon, ...user.compagnon },
    claque: { ...DEFAULT_CONFIG.claque, ...user.claque },
    liens: { ...DEFAULT_CONFIG.liens, ...user.liens },
    studio: { ...DEFAULT_CONFIG.studio, ...user.studio, comptes: Array.isArray(user.studio?.comptes) ? user.studio.comptes : DEFAULT_CONFIG.studio.comptes },
    conseillers: Array.isArray(user.conseillers) && user.conseillers.length ? user.conseillers.map(completerConseiller) : DEFAULT_CONFIG.conseillers,
  };
  if (c.mac.dossierCaptures) c.mac.dossierCaptures = expandHome(c.mac.dossierCaptures);
  c.musique.fichier = expandHome(c.musique.fichier);
  if (c.studio.dossier) c.studio.dossier = expandHome(c.studio.dossier);
  c.liens.habitudes = expandHome(c.liens.habitudes);
  c.voix.modele = c.voix.modele ? expandHome(c.voix.modele) : path.join(c.dossierDonnees, "modeles", MODELE_WHISPER);
  return c;
}
