// Types partagés entre le serveur et la page du bureau.

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
  /** L'écran affiché : Jarvis (la sphère) ou le bureau pixel art. */
  vue?: VueEcran;
}

export type VueEcran = "jarvis" | "bureau";

/** Les petits panneaux de l'écran Jarvis. */
export interface JarvisVue {
  meteo: string | null;
  agenda: { heure: string; titre: string }[] | null;
}

/** Le coach : minuteur en cours, travail du jour, prochaine échéance. */
export interface CoachVue {
  minuteur: { type: "travail" | "pause"; sujet: string; fin: string } | null;
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
  categories: { id: CategorieMails; nom: string; emoji: string; mails: { id: number; de: string; sujet: string; lu: boolean }[] }[];
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
  | { type: "visage"; ok: boolean; texte: string };

export type ClientMessage =
  | { type: "lancer"; texte: string }
  | { type: "arreter" }
  | { type: "reprendre" }
  | { type: "ouvrir-dossier"; nom?: string }
  | { type: "parler-max"; texte: string }
  | { type: "reveil" }
  | { type: "veille" }
  | { type: "taire" }
  | { type: "session"; minutes?: number; sujet?: string }
  | { type: "fin-session" }
  | { type: "vue"; vue: VueEcran }
  | { type: "visage-verifier"; descripteur: number[]; vivant: boolean }
  | { type: "visage-enregistrer"; descripteurs: number[][]; prenom: string }
  | { type: "visage-effacer" }
  | { type: "verrouiller" };
