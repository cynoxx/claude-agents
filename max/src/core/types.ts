// Modèle de données de Max. Toutes les entités partagent des métadonnées
// stables (id, version, dates) pour permettre migration, fusion et restauration.

export type ID = string;
/** Date locale sans heure, "YYYY-MM-DD" (échéances sans heure). */
export type LocalDate = string;
/** Heure locale "HH:mm". */
export type LocalTime = string;
/** Instant ISO 8601 avec décalage, ex. "2026-11-19T14:00:00.000+01:00". */
export type Instant = string;

export type Origin = 'user' | 'import' | 'seed' | 'engine' | 'ics';

export interface Meta {
  id: ID;
  createdAt: Instant;
  updatedAt: Instant;
  /** Incrémentée à chaque écriture ; sert à détecter les conflits d'annulation et d'import. */
  version: number;
  /** Suppression douce : une suppression ne réapparaît pas après un import. */
  deletedAt?: Instant;
  origin: Origin;
  /** Provenance lisible : « saisi le 19/11 », « export Max 18/11/2026 », « agenda ENT »… */
  source?: string;
}

// ---------- Capture ----------
export type CaptureStatus = 'new' | 'parsed' | 'needs_input' | 'partial' | 'done' | 'failed' | 'dismissed';
export interface Capture extends Meta {
  text: string;
  status: CaptureStatus;
  /** Résultat d'interprétation (grammaire versionnée). */
  parse?: ParseResult;
  /** Index d'intention → ids créés (idempotence : on n'applique jamais deux fois). */
  applied: Record<number, ID[]>;
  error?: string;
}

// ---------- Domaines / projets ----------
export type AreaStatus = 'active' | 'paused' | 'archived' | 'to_confirm' | 'history';
export interface Area extends Meta {
  name: string;
  status: AreaStatus;
  /** Budget de temps actif par jour (min), facultatif. */
  dailyBudgetMin?: number;
  color?: string;
  notes?: string;
}

export type ProjectKind = 'general' | 'subject' | 'brand' | 'application' | 'book' | 'shop';
export type ApplicationStatus = 'piste' | 'contactee' | 'a_relancer' | 'entretien' | 'cloturee';
export interface DatedNote { id: ID; date: LocalDate; text: string; source?: string }
export interface Project extends Meta {
  name: string;
  areaId?: ID;
  kind: ProjectKind;
  status: AreaStatus;
  nextAction?: string;
  targetDate?: LocalDate;
  targetConfirmed?: boolean;
  notes: DatedNote[];
  links?: { label: string; url: string }[];
  // Candidature
  company?: string;
  contact?: string;
  applicationStatus?: ApplicationStatus;
  followUpDate?: LocalDate;
  // Budgets business (préférences éditables)
  plannedSpendEur?: number;
  declaredToolCostEur?: number;
}

// ---------- Tâches ----------
export type TaskStatus = 'inbox' | 'open' | 'in_progress' | 'done' | 'cancelled' | 'archived';
export type LearnState = 'a_decouvrir' | 'a_pratiquer' | 'a_revoir' | 'acquis';
export interface Step { id: ID; title: string; done: boolean; estimateMin?: number }
export interface WorkSession { start: Instant; end?: Instant; minutes?: number; note?: string }

export interface Task extends Meta {
  title: string;
  status: TaskStatus;
  projectId?: ID;
  areaId?: ID;
  /** Échéance (date limite) — distincte du créneau planifié. */
  dueDate?: LocalDate;
  dueTime?: LocalTime;
  deadlineId?: ID;
  nextStep?: string;
  /** Estimation totale et source : une durée donnée par l'utilisateur prime sur le moteur. */
  estimateMin?: number;
  estimateSource?: 'user' | 'engine' | 'default';
  /** Reste déclaré explicitement (« compte 35 minutes »). */
  remainingMin?: number;
  spentMin: number;
  /** 0 = normal, 1 = haute, 2 = très haute (manuel). */
  priority: number;
  /** Bloc continu imposé : pas de découpage. */
  continuous?: boolean;
  /** Durée minimale utile d'une séance (min). */
  minChunkMin?: number;
  steps: Step[];
  dependsOn: ID[];
  /** Action courte qui débloque d'autres choses (vérifier une heure, une info). */
  unblocks?: boolean;
  learnState?: LearnState;
  kind?: 'task' | 'chapter' | 'prep' | 'admin' | 'video' | 'followup';
  notes?: string;
  captureId?: ID;
  sessions: WorkSession[];
  completedAt?: Instant;
  /** Nombre de fois où la tâche a été retirée du plan (revue de semaine). */
  deferCount?: number;
}

// ---------- Échéances ----------
export type DeadlineKind = 'controle' | 'tp' | 'rendu' | 'rattrapage' | 'admin' | 'business' | 'rdv' | 'autre';
export type DeadlineStatus = 'to_confirm' | 'announced' | 'to_fill' | 'done' | 'cancelled' | 'history';
export interface Deadline extends Meta {
  kind: DeadlineKind;
  title: string;
  subjectId?: ID; // projet de type matière
  projectId?: ID;
  date: LocalDate;
  time?: LocalTime;
  durationMin?: number;
  tz: string;
  location?: string;
  chapters?: string;
  importance: 'normale' | 'haute';
  status: DeadlineStatus;
  /** Date confirmée ? (l'heure a son propre indicateur : time absent = inconnue) */
  dateConfirmed: boolean;
  result?: string;
}

// ---------- Agenda ----------
export type BlockKind = 'fixed' | 'planned' | 'external' | 'protected';
export type BlockCategory =
  | 'cours' | 'tp' | 'controle' | 'trajet' | 'sport' | 'famille' | 'perso' | 'prive' | 'spirituel'
  | 'sommeil' | 'travail' | 'repos' | 'rdv' | 'autre';
export type BlockStatus = 'proposed' | 'accepted' | 'done' | 'missed' | 'cancelled';
export interface Block extends Meta {
  title: string;
  start: Instant;
  end: Instant;
  tz: string;
  kind: BlockKind;
  category: BlockCategory;
  /** locked : jamais déplacé par le moteur. flexible : peut bouger. */
  protection: 'locked' | 'flexible';
  status: BlockStatus;
  taskId?: ID;
  deadlineId?: ID;
  recurrenceId?: ID;
  externalUid?: string;
  location?: string;
  /** Temps privé : seul l'horaire compte pour le moteur. */
  private?: boolean;
  /** Fin réelle si le bloc a débordé. */
  actualEnd?: Instant;
  /** Minutes de la tâche couvertes par ce bloc (blocs planifiés). */
  plannedMin?: number;
  /** Titre affiché pour une étape (« Retrouver le chapitre et refaire une question »). */
  stepTitle?: string;
  needsBuffer?: boolean;
}

export interface RecurrenceException { date: LocalDate; action: 'skip' | 'move'; start?: LocalTime; end?: LocalTime; dateTo?: LocalDate }
export interface Recurrence extends Meta {
  title: string;
  category: BlockCategory;
  kind: 'fixed' | 'protected';
  protection: 'locked' | 'flexible';
  /** 1 = lundi … 7 = dimanche */
  weekdays: number[];
  startTime: LocalTime;
  endTime: LocalTime;
  tz: string;
  from: LocalDate;
  until?: LocalDate;
  exceptions: RecurrenceException[];
  location?: string;
  private?: boolean;
  externalUid?: string;
}

// ---------- Contenus ----------
export type VideoWorkState = 'idee' | 'script' | 'tournage' | 'montage' | 'pret' | 'a_retoucher';
export type PlatformState = 'non_prevu' | 'prevu' | 'programme' | 'publie';
export type Platform = 'tiktok' | 'youtube' | 'shorts' | 'instagram';
export interface Metric { id: ID; date: LocalDate; platform: Platform; views?: number; note?: string; source: string; daysAfterPublish?: number }
export interface Video extends Meta {
  title: string;
  projectId?: ID;
  format?: string;
  workState: VideoWorkState;
  platforms: Partial<Record<Platform, { state: PlatformState; date?: LocalDate; url?: string; source?: string }>>;
  nextStep?: string;
  fileLink?: string;
  batchLabel?: string;
  hookVariant?: string;
  metrics: Metric[];
  costEur?: number;
}

// ---------- Journaux personnels (privés) ----------
export type LogKind = 'sleep' | 'caffeine' | 'energy';
export interface LogEntry extends Meta {
  kind: LogKind;
  /** Jour de rattachement (nuit = jour du réveil). */
  date: LocalDate;
  bedAt?: Instant;
  wakeAt?: Instant;
  /** Durée de sommeil réelle si connue (≠ temps au lit). */
  sleepMin?: number;
  quality?: 'bien' | 'moyen' | 'mal';
  at?: Instant;
  product?: string;
  /** mg de caféine uniquement si dosage indiqué. */
  caffeineMg?: number;
  quantity?: string; // « 25 cl », « inconnue »
  energy?: 'basse' | 'normale';
  note?: string;
}

// ---------- Préférences ----------
export interface Prefs {
  id: 'prefs';
  version: number;
  updatedAt: Instant;
  tz: string;
  sleep: { bed: LocalTime; wake: LocalTime; protect: boolean; confirmed: boolean };
  bufferMin: number;
  minUsefulMin: number;
  defaultChunkMin: number;
  maxChunkMin: number;
  /** Budget de temps business par jour (min) — à confirmer. */
  businessDailyMin?: number;
  businessConfirmed?: boolean;
  promoMonthlyEur?: number;
  productionCreditsMonthlyEur?: number;
  /** Jour + niveau d'énergie déclaré. */
  energy?: { date: LocalDate; level: 'basse' | 'normale' };
  /** Disponibilité déclarée jusqu'à (pour aujourd'hui). */
  availableUntil?: { date: LocalDate; time: LocalTime };
  /** Départ prévu aujourd'hui. */
  departure?: { date: LocalDate; time: LocalTime; label?: string };
  travel: { label: string; minutes?: number }[];
  quietHours: { from: LocalTime; to: LocalTime };
  onboardingDone: boolean;
  lastOpenAt?: Instant;
  assistantEnabled: boolean;
  remindersEnabled: boolean;
  dismissedQuestions: string[];
  maxPriorities: number;
  lastExportAt?: Instant;
  icsLastImport?: { at: Instant; label: string; count: number };
}

// ---------- Lots et annulation ----------
export type StoreName =
  | 'captures' | 'areas' | 'projects' | 'tasks' | 'deadlines' | 'blocks' | 'recurrences'
  | 'videos' | 'logs' | 'prefs' | 'replans';
export const DATA_STORES: StoreName[] = [
  'captures', 'areas', 'projects', 'tasks', 'deadlines', 'blocks', 'recurrences', 'videos', 'logs', 'prefs', 'replans',
];

export interface Op {
  store: StoreName;
  id: ID;
  before: any | null; // null = n'existait pas
  after: any | null; // null = supprimé physiquement (rare : on préfère deletedAt)
}
export interface Batch {
  id: ID;
  at: Instant;
  label: string;
  ops: Op[];
  undoneAt?: Instant;
  kind: 'action' | 'replan' | 'import' | 'capture' | 'undo' | 'system';
}

// ---------- Recalage ----------
export interface ReplanFacts {
  /** Bloc qui déborde : id + nouvelle fin locale. */
  overrun?: { blockId: ID; until: LocalTime };
  availableUntil?: LocalTime;
  minutesLeft?: number;
  cancelledBlockIds?: ID[];
  energy?: 'basse' | 'normale';
  /** Tâches épinglées à une heure précise. */
  pins?: { taskId: ID; start: LocalTime; minutes?: number }[];
  /** Tâches à retirer d'aujourd'hui. */
  removeTaskIds?: ID[];
  /** « À la place du montage, garde-moi 30 min pour l'électricité » */
  prefer?: { taskId: ID; minutes: number; insteadOfTaskId?: ID }[];
}

export interface Replan extends Meta {
  facts: ReplanFacts;
  status: 'preview' | 'applied' | 'discarded' | 'undone';
  batchId?: ID;
  summary: string[];
  fingerprint: string;
}

// ---------- Interprétation ----------
export type IntentType =
  | 'create_task' | 'create_deadline' | 'create_event' | 'move' | 'log_sleep' | 'log_caffeine'
  | 'progress' | 'energy' | 'replan' | 'query_before_departure' | 'repeat_block' | 'unknown';
export interface Ambiguity { field: string; question: string; options?: { label: string; value: any }[] }
export interface Intent {
  type: IntentType;
  /** Fragment de texte couvert. */
  text: string;
  fields: Record<string, any>;
  ambiguities: Ambiguity[];
  /** true si l'action est interne, courante et réversible : appliquée directement avec « Annuler ». */
  autoApply: boolean;
  label: string;
}
export interface ParseResult { grammarVersion: string; intents: Intent[]; parsedAt: Instant; by: 'local' | 'assistant' }
