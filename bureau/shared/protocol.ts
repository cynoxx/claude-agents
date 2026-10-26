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
}

export interface EtatBureau {
  claude: { ok: boolean; version?: string; erreur?: string };
  mission: MissionVue | null;
  assistant?: AssistantVue;
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
  | { type: "erreur"; message: string };

export type ClientMessage =
  | { type: "lancer"; texte: string }
  | { type: "arreter" }
  | { type: "reprendre" }
  | { type: "ouvrir-dossier"; nom?: string }
  | { type: "parler-max"; texte: string }
  | { type: "reveil" }
  | { type: "veille" }
  | { type: "taire" };
