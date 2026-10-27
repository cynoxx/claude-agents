// Types partagés entre le serveur et la page du bureau.

import type { MuscleId, SeanceId } from "./sport.ts";

export type RoleId = "chercheur" | "codeur" | "designer" | "redacteur" | "analyste";

export type Phase =
  | "planification"
  | "travail"
  | "relecture"
  | "termine"
  | "pause"
  | "echec"
  | "arrete";

export type RobotStatut = "attente" | "travail" | "fini" | "quota" | "erreur" | "arrete";

export interface ActionVue {
  heure: string; // ISO
  texte: string;
}

export interface RobotVue {
  id: string; // ex. "chercheur-1"
  role: RoleId;
  nom: string; // ex. "Chercheur 1"
  tache: string;
  etape: number; // 0-based
  statut: RobotStatut;
  bulle: string;
  actions: ActionVue[];
  erreur?: string;
  rapport?: string; // chemin relatif au dossier de mission
}

export interface MaxVue {
  bulle: string;
  actions: ActionVue[];
}

export interface MissionVue {
  nom: string; // nom du dossier
  texte: string;
  titre: string;
  phase: Phase;
  etape: number;
  totalEtapes: number;
  debut: string; // ISO
  fin?: string;
  max: MaxVue;
  robots: RobotVue[];
  resultat?: string; // Markdown de RESULTAT.md
  branche?: string;
  erreur?: string;
}

export interface MissionResume {
  nom: string;
  titre: string;
  statut: EtatFichier["statut"];
  debut: string;
}

/** Max en conversation : 😴 veille · 👂 écoute · 💭 réfléchit · 🗣 parle. */
export type EtatMax = "veille" | "ecoute" | "reflechit" | "parle";

export interface MessageConversation {
  de: "toi" | "max" | "bureau";
  texte: string;
  heure: string; // ISO
}

/** Un organe de Max (oreille, bouche, cerveau) : marche-t-il, et sinon pourquoi. */
export interface Dispo {
  ok: boolean;
  detail?: string;
}

export interface AssistantVue {
  etat: EtatMax;
  /** La phrase que Max est en train de prononcer (sa bulle dans la scène). */
  phrase: string;
  messages: MessageConversation[];
  oreille: Dispo;
  bouche: Dispo;
  cerveau: Dispo;
  coach?: CoachVue;
  /** L'écran affiché (avec la fiche du pôle ouverte, s'il y en a une) : Jarvis (la sphère) ou le bureau pixel art. */
  vue?: VueEcran;
  /** La fiche de pôle ouverte sur l'écran de Max (« sante »…), ou null. */
  pole?: string | null;
  /** La dernière phrase entendue par le micro (adressée à Max ou non) : la preuve qu'il entend. */
  entendu?: { texte: string; heure: number; pourMax: boolean } | null;
  /** Max Ultime (le mode obscur) : depuis quand, ou null. */
  obscur?: number | null;
  /** Ce que la fiche doit montrer en premier (« corps » pour la fiche Sport). */
  focus?: string | null;
}

export type VueEcran = "jarvis" | "bureau";

/** Les petits panneaux de l'écran Jarvis. */
export interface JarvisVue {
  meteo: string | null;
  agenda: { heure: string; titre: string }[] | null;
}

/** Le coach : minuteur en cours, travail du jour, prochaine échéance. */
export interface CoachVue {
  minuteur: { type: "travail" | "pause"; sujet: string; fin: string; pole?: string } | null;
  /** Minutes de travail notées aujourd'hui. */
  aujourdhui: number;
  /** Minutes de travail notées depuis le début (l'XP du joueur). */
  total: number;
  /** Jours d'affilée avec au moins une session. */
  serie: number;
  echeance: { nom: string; jours: number } | null;
}

/** Un conseiller : un robot par domaine de la vie, assis à son bureau, que Max consulte. */
export interface ConseillerVue {
  id: string;
  nom: string;
  emoji: string;
  couleur: string;
  domaine: string;
  description: string;
  statut: "libre" | "reflechit";
  bulle: string;
  question?: string;
  reponse?: string;
  heure?: string; // ISO, dernière question
}

/** Le verrou par reconnaissance du visage. */
export interface VerrouVue {
  /** La reconnaissance est activée dans la config. */
  actif: boolean;
  /** Un visage est enregistré. */
  enregistre: boolean;
  verrouille: boolean;
  prenom: string;
  /** Moment (ms) de la dernière demande de réveil (Siri) : la page allume alors la caméra. */
  demande: number;
}

export type TypeCreneau = "travail" | "cours" | "pause" | "repas" | "sport" | "perso" | "sommeil" | "autre";

/** Un créneau de l'emploi du temps du jour (heures « HH:MM »). */
export interface Creneau {
  debut: string;
  fin: string;
  titre: string;
  type: TypeCreneau;
}

export interface PlanningVue {
  jour: string;
  creneaux: Creneau[];
  /** Indice du créneau en cours, ou -1. */
  enCours: number;
  /** Déjà ajouté au Calendrier. */
  calendrier: boolean;
}

export type CategorieMails = "a_traiter" | "etudes" | "business" | "perso" | "pubs";

/** Les mails triés par Max, affichés sur son écran. */
export interface MailsVue {
  heure: string; // ISO
  resume: string;
  /** Trié automatiquement à l'arrivée : la page ouvre la fenêtre des mails. */
  auto?: boolean;
  categories: { id: CategorieMails; nom: string; emoji: string; mails: { id: number; de: string; sujet: string; lu: boolean }[] }[];
}

export type Plateforme = "tiktok" | "youtube" | "instagram";

/** Une vidéo du Studio : montée (ou en montage), prévue un jour, publiée plateforme par plateforme. */
export interface VideoStudio {
  id: string;
  compte: string;
  titre: string;
  statut: "montage" | "prete" | "erreur";
  erreur?: string;
  /** Le chemin de la vidéo prête. */
  fichier?: string;
  legende?: string;
  duree?: number;
  /** Le jour prévu pour la publier (AAAA-MM-JJ). */
  jour?: string;
  /** Plateforme → jour où elle a été publiée. */
  publiee: Partial<Record<Plateforme, string>>;
  creee: string;
}

export interface StudioVue {
  dossier: string;
  comptes: { id: string; nom: string; type: "voix" | "clips"; horaires: Partial<Record<Plateforme, string>> }[];
  videos: VideoStudio[];
  /** Les prochaines publications prévues, dans l'ordre. */
  prochaines: { id: string; titre: string; compte: string; plateforme: Plateforme; quand: string }[];
}

export type DomaineVie = "etudes" | "sante" | "business" | "apps" | "vie" | "esprit";

/** Un projet de sa vie, rangé par domaine et catégorie, avec la prochaine chose à faire. */
export interface ProjetVie {
  id: string;
  nom: string;
  domaine: DomaineVie;
  categorie: string;
  objectif?: string;
  prochaineAction?: string;
  /** AAAA-MM-JJ */
  echeance?: string;
  statut: "actif" | "pause" | "fini";
  /** Jour de la dernière mise à jour (AAAA-MM-JJ). */
  maj: string;
}

export interface JourJournal {
  jour: string;
  notes: { heure: string; texte: string }[];
  bilan?: string;
  /** 1 à 5 */
  humeur?: number;
}

/** Sa vie : les domaines et leurs catégories, les projets, le focus du jour et le journal. */
export interface VieVue {
  domaines: { id: DomaineVie; nom: string; emoji: string; categories: string[] }[];
  projets: ProjetVie[];
  focus: ProjetVie[];
  journal: JourJournal | null;
  recents: JourJournal[];
}

/** Le sport : la semaine type (jours fixes), la séance du jour et les muscles travaillés ces 14 derniers jours. */
export interface SportVue {
  /** Séance prévue chaque jour, lundi d'abord. */
  semaine: SeanceId[];
  jour: string; // AAAA-MM-JJ
  prevue: SeanceId;
  faite: SeanceId | null;
  /** Cette semaine, du lundi au dimanche. */
  cetteSemaine: { jour: string; prevue: SeanceId; faite: SeanceId | null }[];
  muscles: { id: MuscleId; fois: number; derniere: string | null; intensite: number }[];
  /** Séances faites ces 30 derniers jours (repos non compris). */
  seances30: number;
}

/** Le temps passé sur un pôle (minutes de sessions), et la limite du jour s'il y en a une. */
export interface TempsPole {
  id: string;
  aujourdhui: number;
  semaine: number;
  /** Minutes des 7 derniers jours, du plus ancien à aujourd'hui. */
  jours: number[];
  limite: number | null;
  /** Objectif du jour en minutes (6 h d'études), ou null. */
  objectif: number | null;
  /** Les dernières notes du carnet de l'agent du pôle. */
  notes: string[];
}

/** Le réveil par appel. */
export interface ReveilVue {
  /** Le réveil est prêt (sur le Mac, ou par appel avec ton numéro et Twilio). */
  configure: boolean;
  /** Max te réveille sur le Mac, par appel, ou les deux. */
  mode: "mac" | "appel" | "les-deux";
  /** L'heure habituelle (« 07:00 »). */
  heure: string;
  /** Le prochain appel (ISO), ou null. */
  prochain: string | null;
  /** Un réveil est en cours (il rappelle tant que tu n'as pas répondu). */
  enCours: boolean;
}

export interface EtatBureau {
  claude: { ok: boolean; version?: string; erreur?: string };
  mission: MissionVue | null;
  assistant?: AssistantVue;
  conseillers?: ConseillerVue[];
  jarvis?: JarvisVue;
  verrou?: VerrouVue;
  planning?: PlanningVue | null;
  mails?: MailsVue | null;
  sport?: SportVue;
  vie?: VieVue;
  studio?: StudioVue;
  poles?: TempsPole[];
  /** Les dernières idées mises au parking. */
  idees?: string[];
  /** Moment (ms) du dernier lancement de Max : la page joue alors l'animation d'intro. */
  intro?: number;
  /** Sa musique (intro et réveil) est trouvée sur le Mac. */
  musique?: boolean;
  reveil?: ReveilVue;
}

export interface EtatFichier {
  statut: "en-cours" | "terminee" | "en-pause" | "echouee" | "arretee" | "interrompue";
  titre: string;
  texte: string;
  debut: string;
  fin?: string;
  branche?: string;
}

export type ServerMessage =
  | { type: "etat"; etat: EtatBureau }
  | { type: "erreur"; message: string }
  | { type: "visage"; ok: boolean; texte: string }
  /** Une page de Max plus récente s'est ouverte (`nee` = son heure d'ouverture) : les plus anciennes lui cèdent la place. */
  | { type: "fenetre"; nee: number };

export type ClientMessage =
  | { type: "lancer"; texte: string }
  | { type: "arreter" }
  | { type: "reprendre" }
  | { type: "ouvrir-dossier"; nom?: string }
  | { type: "parler-max"; texte: string }
  | { type: "reveil" }
  | { type: "veille" }
  | { type: "taire" }
  | { type: "session"; minutes?: number; sujet?: string; pole?: string }
  | { type: "pole"; pole: string | null; focus?: string | null }
  | { type: "seance"; seance: string; jour?: string }
  | { type: "semaine-sport"; jour: number; seance: string }
  | { type: "trier-mails" }
  | { type: "alarme"; action: "regler" | "annuler" | "essayer" | "confirmer"; heure?: string }
  | { type: "fin-session" }
  | { type: "vue"; vue: VueEcran }
  | { type: "visage-verifier"; descripteur: number[]; vivant: boolean }
  | { type: "visage-enregistrer"; descripteurs: number[][]; prenom: string }
  | { type: "visage-effacer" }
  | { type: "verrouiller" }
  | { type: "fenetre"; nee: number }
  | { type: "obscur"; actif: boolean }
  | { type: "journal"; texte: string }
  | { type: "publier"; video: string; plateforme: Plateforme }
  | { type: "publiee"; video: string; plateforme: Plateforme };
