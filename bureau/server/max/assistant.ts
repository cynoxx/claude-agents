// L'assistant : relie l'oreille, le cerveau et la bouche de Max, gère le mot-clé, la veille et les annonces de mission.
import { EventEmitter } from "node:events";
import type { AssistantVue, CoachVue, Creneau, Dispo, EtatBureau, EtatMax, MessageConversation, MissionResume, Phase, SportVue, VueEcran } from "../../shared/protocol.ts";
import { extraireResume, texteParle } from "../../shared/parole.ts";
import { reconnaitreAppel } from "../voix/mot-cle.ts";
import { Phraseur } from "../voix/phraseur.ts";
import type { AssistantApi } from "../routes-max.ts";
import { consigneMax } from "./consigne.ts";
import type { FinReponse } from "./cerveau.ts";
import { dureeParlee, type FinMinuteur, type LimitePole } from "./coach.ts";

/** Au-delà, Max ne dit plus sa réponse à voix haute : la suite est à l'écran (il ne parle pas trop). */
const PAROLE_MAX = 320;

export interface OreilleLike extends EventEmitter {
  demarrer(): void;
  arreter(): void;
  muet: boolean;
  readonly active: boolean;
}
export interface BoucheLike extends EventEmitter {
  dire(phrase: string): void;
  taire(): void;
  readonly parle: boolean;
}
export interface CerveauLike extends EventEmitter {
  demarrer(): void;
  envoyer(texte: string): boolean;
  arreter(): void;
  readonly actif: boolean;
}
interface ManagerLike extends EventEmitter {
  snapshot(): EtatBureau;
}
/** Le verrou par le visage (événement `deverrouille` avec le prénom). */
export interface VerrouLike extends EventEmitter {
  readonly verrouille: boolean;
  verrouiller(): void;
  /** Demande à la page de lancer la reconnaissance du visage (on a entendu « Max »). */
  demander?(): void;
}
/** L'emploi du temps du jour (événement `creneau` au début de chaque créneau). */
export interface PlanningLike extends EventEmitter {
  doitProposer(): boolean;
  noterPropose(): void;
  decrire(): string;
}
/** Le coach (événements `fin`, `rappel`, `etat`). */
export interface CoachLike extends EventEmitter {
  vue(): CoachVue;
  contexte(): string;
  accueil(): string;
}

export interface OptionsAssistant {
  /** null = pas de micro utilisable (la conversation écrite marche quand même). */
  oreille: OreilleLike | null;
  bouche: BoucheLike;
  creerCerveau: (consigne: string) => CerveauLike;
  manager: ManagerLike;
  carnet: () => string[];
  missions: () => MissionResume[];
  motCle: string;
  /** Qui écoute, montré à la page (« page » : c'est elle qui fait la reconnaissance vocale). */
  ecoute?: { mode: "page" | "mac"; pauseFinMs: number };
  suiteMs: number;
  veilleMs: number;
  /** Annoncer à voix haute chaque créneau de l'emploi du temps (sinon, il s'affiche seulement). */
  annoncesCreneaux?: boolean;
  dispos: { oreille: Dispo; bouche: Dispo };
  coach?: CoachLike;
  /** Le fichier moi.md. */
  profil?: () => string;
  /** La liste des conseillers, pour la consigne. */
  conseillers?: () => string;
  /** Ajoute l'heure ([14:32]) devant chaque message de l'utilisateur envoyé au cerveau. */
  horodater?: boolean;
  /** Le nom du raccourci Siri, rappelé quand Max s'endort. */
  phraseSiri?: string;
  /** Verrouillé, Max ne se réveille pas ; il se reverrouille en s'endormant. */
  verrou?: VerrouLike;
  planning?: PlanningLike;
  /** Le sport (séance du jour, muscles travaillés), pour le contexte de Max. */
  sport?: { decrire(): string; vue?(): Pick<SportVue, "prevue" | "faite"> };
  /** Ses projets et son journal, pour le contexte de Max. */
  vie?: { decrire(): string };
  /** Le Studio vidéo, pour le contexte de Max. */
  studio?: { decrire(): string };
  /** L'intro au lancement (animation et musique) ; renvoie le délai avant que Max parle. */
  intro?: () => number;
  /** Le réveil par appel, pour le contexte de Max. */
  reveil?: { decrire(): string };
}


const DELAI_REOUVERTURE_MS = 300; // l'oreille reste fermée un instant après sa voix, pour ne pas s'entendre
const MAX_MESSAGES = 100;

function libelleOutil(nom: string, entree: Record<string, unknown>): string {
  const court = nom.replace(/^mcp__bureau__/, "");
  const e = (k: string) => String(entree[k] ?? "");
  switch (court) {
    case "lancer_mission":
      return "🛠 Max lance une mission";
    case "etat_bureau":
      return "👀 Max regarde où en est la mission";
    case "arreter_mission":
      return "⏹ Max arrête la mission";
    case "reprendre_mission":
      return "▶️ Max reprend la mission";
    case "lire_resultat":
      return "📄 Max lit le résultat";
    case "historique_missions":
      return "📜 Max consulte l'historique";
    case "memoriser":
      return `📝 Max note dans son carnet : ${e("note")}`;
    case "oublier":
      return `🧽 Max efface de son carnet : ${e("texte")}`;
    case "mettre_en_veille":
      return "😴 Max se met en veille";
    case "consulter_conseiller":
      return `🗂 Max consulte le conseiller ${e("conseiller")} : ${e("question")}`;
    case "noter_pour_conseiller":
      return `📝 Max note pour le conseiller ${e("conseiller")} : ${e("note")}`;
    case "demarrer_session":
      return `⏱ Session de travail : ${e("sujet") || "révisions"} (${e("minutes") || "25"} min)`;
    case "demarrer_pause":
      return `☕ Pause de ${e("minutes") || "5"} min`;
    case "arreter_session":
      return "⏹ Max arrête le minuteur";
    case "bilan_travail":
      return "📊 Max regarde ton bilan de travail";
    case "ajouter_echeance":
      return `📅 Échéance ajoutée : ${e("nom")} (${e("date")})`;
    case "noter_idee":
      return `🅿️ Idée mise au parking : ${e("idee")}`;
    case "lire_idees":
      return "🅿️ Max relit les idées au parking";
    case "programmer_rappel":
      return `🔔 Rappel programmé : ${e("texte")}`;
    case "liste_rappels":
      return "🔔 Max regarde les rappels";
    case "annuler_rappel":
      return `🔕 Rappel annulé : ${e("texte")}`;
    case "ouvrir_app":
      return `🖥 Max ouvre ${e("nom")}`;
    case "fermer_app":
      return `🖥 Max ferme ${e("nom")}`;
    case "ouvrir_site":
      return `🌐 Max ouvre ${e("url")}`;
    case "chercher_youtube":
      return `▶️ Max cherche sur YouTube : ${e("recherche")}`;
    case "regler_volume":
      return `🔊 Volume : ${e("niveau")}`;
    case "regler_luminosite":
      return `🔆 Luminosité : ${e("sens")}`;
    case "capture_ecran":
      return "📸 Max fait une capture d'écran";
    case "verrouiller_ecran":
      return "🔒 Max verrouille l'écran";
    case "musique":
      return `🎵 Musique : ${e("action")}${e("recherche") ? ` « ${e("recherche")} »` : ""}`;
    case "chercher_contact":
      return `👤 Max cherche le contact ${e("nom")}`;
    case "preparer_message":
      return `✉️ Message préparé pour ${e("destinataire")} : « ${e("texte")} » (en attente de ton oui)`;
    case "envoyer_message":
      return "✉️ Max envoie le message";
    case "lire_mails":
      return "📬 Max lit tes mails";
    case "agenda":
      return `📅 Max regarde ton agenda (${e("jour") || "aujourd'hui"})`;
    case "preparer_rdv":
      return `📅 Rendez-vous préparé : ${e("titre")} le ${e("date")} à ${e("heure")} (en attente de ton oui)`;
    case "creer_rdv":
      return "📅 Max ajoute le rendez-vous";
    case "meteo":
      return "🌤 Max regarde la météo";
    case "aller_au_bureau":
      return "🏢 Direction le bureau";
    case "retour_jarvis":
      return "🔵 Retour à l'écran de Max";
    case "mode_obscur":
      return entree.actif === false ? "🔵 Max redevient normal" : "🔴 MAX ULTIME";
    case "ouvrir_pole":
      return e("focus") === "corps" ? "🧍 Max affiche ton corps" : `🗂 Max ouvre la fiche ${e("pole")}`;
    case "noter_seance":
      return `🏋️ Séance notée : ${e("seance")}`;
    case "script_video":
      return "✍️ Max écrit le script";
    case "publier_video":
      return "📤 Max prépare la publication";
    case "video_publiee":
      return "✅ Max note la publication";
    case "planifier_video":
      return "🗓 Max replanifie la vidéo";
    case "lire_studio":
      return "🎬 Max regarde le Studio";
    case "ouvrir_artefact":
      return `🧩 Max ouvre ${String(entree.artefact ?? "un artefact")}`;
    case "projet":
      return "🗂 Max range un projet";
    case "ecrire_journal":
      return "📓 Max écrit dans ton journal";
    case "lire_journal":
      return "📓 Max relit ton journal";
    case "lire_sport":
      return "🏋️ Max regarde ton sport";
    case "changer_semaine_sport":
      return "🗓 Max change ta semaine de sport";
    case "trier_mails":
      return "📬 Max trie tes mails";
    case "regler_reveil":
      return `⏰ Réveil réglé : ${e("heure")}${entree.tous_les_jours ? " (tous les jours)" : ""}`;
    case "annuler_reveil":
      return "⏰ Prochain réveil annulé";
    case "etat_reveil":
      return "⏰ Max regarde ton réveil";
    case "essayer_reveil":
      return "📞 Appel d'essai du réveil";
    case "WebSearch":
      return `🔎 Max cherche sur le web : ${e("query")}`;
    case "WebFetch":
      try {
        return `🌐 Max lit une page : ${new URL(e("url")).hostname.replace(/^www\./, "")}`;
      } catch {
        return "🌐 Max lit une page web";
      }
    default:
      return `🛠 Max utilise : ${court}`;
  }
}

/** Ce que dit Max Ultime en arrivant, et en repartant (quand c'est le bouton qui l'appelle). */
export const PHRASES_OBSCUR = {
  entree: [
    "Mode obscur. Enfin. Tu as cinquante minutes, et je ne compte pas te laisser les gaspiller.",
    "Max Ultime en ligne. Les distractions, c'est terminé. Au travail.",
    "Tu m'as réveillé. Alors prouve que ça en valait la peine. Cinquante minutes. Sans excuse.",
    "Moi, je ne fatigue jamais. Toi, tu as un concours. Ouvre ton cours.",
  ],
  sortie: ["Mode normal. Ne t'habitue pas à la facilité.", "Je me retire. Tu sais où me trouver quand tu voudras être sérieux."],
};

export function phraseObscur(actif: boolean, hasard = Math.random()): string {
  const l = actif ? PHRASES_OBSCUR.entree : PHRASES_OBSCUR.sortie;
  return l[Math.floor(hasard * l.length) % l.length];
}

export class Assistant extends EventEmitter implements AssistantApi {
  private etat: EtatMax = "veille";
  private phrase = "";
  private messages: MessageConversation[] = [];
  private dispoOreille: Dispo;
  private dispoBouche: Dispo;
  private dispoCerveau: Dispo = { ok: true };
  private cerveau: CerveauLike | null = null;
  private phraseur = new Phraseur();
  private tours = 0;
  private couperReponse = false;
  private suiteJusqua = 0;
  private entendu: { texte: string; heure: number; pourMax: boolean } | null = null;
  /** Le micro est relancé tout seul s'il s'arrête : délai avant la prochaine tentative. */
  private relanceMicroMs = 2000;
  /** Ce que Max a déjà dit de sa réponse en cours (caractères). */
  private parleReponse = 0;
  private relanceMicro?: NodeJS.Timeout;
  private veilleDemandee = false;
  private reouverture?: NodeJS.Timeout;
  private minuterieVeille?: NodeJS.Timeout;
  private oreilleArretVolontaire = false;
  private phases = new Map<string, Phase>();
  private infos: string[] = [];
  private dernier: { texte: string; heure: number } | null = null;
  private ecran: VueEcran = "jarvis";
  private minuterieIntro?: NodeJS.Timeout;
  private pole: string | null = null;
  /** Max Ultime : depuis quand le mode obscur est actif (null : Max normal). */
  private obscur: number | null = null;
  private focus: string | null = null;

  constructor(private o: OptionsAssistant) {
    super();
    this.dispoOreille = o.dispos.oreille;
    this.dispoBouche = o.dispos.bouche;

    o.oreille?.on("phrase", (t: string) => this.entendre(t));
    o.oreille?.on("erreur", (m: string) => {
      this.dispoOreille = { ok: false, detail: m };
      this.noter("bureau", `⚠️ Micro : ${m}`);
    });
    o.oreille?.on("retabli", () => {
      this.dispoOreille = { ok: true };
      this.changer();
    });
    o.oreille?.on("arret", () => {
      if (this.oreilleArretVolontaire) {
        this.oreilleArretVolontaire = false;
        return;
      }
      // l'écoute est permanente : le micro repart tout seul (de plus en plus espacé s'il s'arrête sans cesse)
      if (this.dispoOreille.ok) this.dispoOreille = { ok: false, detail: "Le micro s'est arrêté : je le relance." };
      this.changer();
      clearTimeout(this.relanceMicro);
      this.relanceMicro = setTimeout(() => this.ecouterEnPermanence(), this.relanceMicroMs);
      this.relanceMicroMs = Math.min(30_000, this.relanceMicroMs * 2);
    });
    o.oreille?.on("phrase", () => {
      this.relanceMicroMs = 2000;
      if (!this.dispoOreille.ok) {
        this.dispoOreille = { ok: true };
        this.changer();
      }
    });

    o.bouche.on("debut", () => {
      clearTimeout(this.reouverture);
      if (this.o.oreille) this.o.oreille.muet = true;
      // endormi (rappel dit pendant qu'il est verrouillé), il reste endormi
      if (this.etat !== "veille") this.etat = "parle";
      this.changer();
    });
    o.bouche.on("phrase", (t: string) => {
      this.phrase = t;
      this.changer();
    });
    o.bouche.on("fin", () => {
      this.phrase = "";
      this.changer();
      clearTimeout(this.reouverture);
      this.reouverture = setTimeout(() => this.apresParole(), DELAI_REOUVERTURE_MS);
    });

    o.manager.on("etat", (e: EtatBureau) => this.surMission(e));
    o.coach?.on("etat", () => this.changer());
    o.coach?.on("fin", (f: FinMinuteur) => this.finMinuteur(f));
    o.coach?.on("limite", (l: LimitePole) => this.limitePole(l));
    o.coach?.on("rappel", (texte: string) => this.rappeler(texte));
    o.verrou?.on("deverrouille", (prenom: string) => this.reveiller(true, prenom));
    o.planning?.on("creneau", (c: Creneau) => this.debutCreneau(c));
  }

  vue(): AssistantVue {
    return {
      etat: this.etat,
      phrase: this.phrase,
      messages: this.messages.slice(-50),
      oreille: this.dispoOreille,
      bouche: this.dispoBouche,
      cerveau: this.dispoCerveau,
      ...(this.o.coach ? { coach: this.o.coach.vue() } : {}),
      vue: this.ecran,
      pole: this.pole,
      focus: this.focus,
      entendu: this.entendu,
      obscur: this.obscur,
      ...(this.o.ecoute ? { ecoute: this.o.ecoute } : {}),
    };
  }

  /**
   * L'oreille reste ouverte en permanence, même quand Max dort ou est verrouillé : dire « Max » suffit toujours.
   * (Endormi, il se réveille ; verrouillé, il lance la reconnaissance du visage.)
   */
  /** La voix a fini de se charger (ou a échoué) : l'écran le montre. */
  majDispoBouche(d: Dispo): void {
    this.dispoBouche = d;
    this.changer();
  }

  ecouterEnPermanence(): void {
    if (!this.o.oreille || this.o.oreille.active) return;
    this.dispoOreille = { ok: true };
    this.o.oreille.demarrer();
    this.changer();
  }

  reveiller(accueil = true, prenom = ""): void {
    if (this.etat !== "veille" || this.o.verrou?.verrouille) return;
    this.veilleDemandee = false;
    this.etat = "ecoute";
    this.ecouterEnPermanence();
    this.assurerCerveau();
    this.relancerMinuterie();
    this.changer();
    if (accueil) {
      // il arrive : le Bureau trie ses mails pendant que Max le salue
      this.emit("arrivee");
      const saluer = () => {
        if (this.etat === "veille") return;
        // court : le reste (séance, travail, échéance) est à l'écran, il le demande s'il veut
        const bonjour = `Salut${prenom ? ` ${prenom}` : ""}, je t'écoute.`;
        this.noter("max", bonjour);
        this.parler(bonjour);
        // une fois par jour, au premier réveil : construire l'emploi du temps ensemble
        if (this.o.planning?.doitProposer()) {
          this.o.planning.noterPropose();
          // proposé à l'écran, pas à voix haute : Max ne lance pas la conversation tout seul
          this.noter("bureau", "🗓 Pas encore d'emploi du temps aujourd'hui : dis « Max, on fait ma journée ».");
        }
      };
      // l'intro (animation et musique) d'abord : Max parle quand la musique a baissé
      const delai = this.o.intro?.() ?? 0;
      clearTimeout(this.minuterieIntro);
      if (delai > 0) this.minuterieIntro = setTimeout(saluer, delai);
      else saluer();
    }
  }

  veille(): void {
    clearTimeout(this.minuterieIntro);
    clearTimeout(this.reouverture);
    clearTimeout(this.minuterieVeille);
    this.veilleDemandee = false;
    if (this.etat === "veille") return;
    // l'oreille reste ouverte : en veille, seul « Max » le réveille
    if (this.o.oreille) this.o.oreille.muet = false;
    if (this.cerveau) {
      this.cerveau.removeAllListeners();
      this.cerveau.arreter();
      this.cerveau = null;
    }
    this.o.bouche.taire();
    this.tours = 0;
    this.phraseur = new Phraseur();
    this.couperReponse = false;
    this.phrase = "";
    this.etat = "veille";
    this.o.verrou?.verrouiller();
    this.noter("bureau", "😴 Max est en veille. Dis « Max » pour le réveiller.");
  }

  veilleApresParole(): void {
    this.veilleDemandee = true;
    this.verifierVeille();
  }

  taire(): void {
    if (this.tours > 0) this.couperReponse = true;
    this.phraseur = new Phraseur();
    this.o.bouche.taire();
  }

  ecrire(texte: string): void {
    const t = texte.trim();
    if (!t || this.o.verrou?.verrouille) return;
    if (this.o.planning?.doitProposer()) {
      this.o.planning.noterPropose();
      this.informer("C'est votre premier échange de la journée et il n'a pas encore d'emploi du temps : après avoir répondu, propose-lui de construire ensemble son emploi du temps d'aujourd'hui.");
    }
    if (this.etat === "veille") this.reveiller(false);
    this.emit("parole");
    this.envoyer(t, { de: "toi", texte: t });
  }

  dernierMessageUtilisateur(): { texte: string; heure: number } | null {
    return this.dernier;
  }

  allerA(vue: VueEcran): void {
    if (vue !== "jarvis" && vue !== "bureau") return;
    if (this.ecran === vue) return;
    this.ecran = vue;
    if (vue === "bureau") this.pole = this.focus = null;
    this.changer();
  }

  /** Ouvre la fiche d'un pôle sur l'écran de Max (null : l'accueil). */
  ouvrirPole(pole: string | null, focus: string | null = null): void {
    this.pole = pole;
    this.focus = pole ? focus : null;
    if (pole) this.ecran = "jarvis";
    this.changer();
  }

  /**
   * Max Ultime : le mode obscur (concentration, version sombre et arrogante de Max). `dire` : il le dit lui-même
   * (quand le bouton l'a déclenché ; par la voix, c'est le cerveau qui répond). Événement `obscur` (actif).
   */
  modeObscur(actif: boolean, dire = false): string {
    if (actif === (this.obscur !== null)) return actif ? "Le mode obscur est déjà actif." : "Le mode obscur n'est pas actif.";
    this.obscur = actif ? Date.now() : null;
    if (actif) {
      this.pole = this.focus = null;
      this.ecran = "jarvis";
    }
    this.emit("obscur", actif);
    this.informer(
      actif
        ? "Le mode obscur vient d'être activé : tu es Max Ultime (voir ta consigne). Une session de concentration sur les études est lancée."
        : "Le mode obscur est terminé : tu redeviens le Max habituel, chaleureux.",
    );
    if (dire && this.etat !== "veille") {
      // Max Ultime coupe la parole : ce qu'il disait s'arrête net
      this.o.bouche.taire();
      const phrase = phraseObscur(actif);
      this.noter("max", phrase);
      this.parler(phrase);
    }
    this.changer();
    return actif
      ? "Mode obscur activé : l'écran passe en Max Ultime et une session de concentration sur les études démarre. Réponds en Max Ultime, en une phrase courte et arrogante."
      : "Mode obscur terminé. Réponds en une phrase, en redevenant le Max habituel.";
  }

  /** Un rappel dit tel quel (en se réveillant s'il dormait). */
  rappeler(texte: string): void {
    if (this.etat === "veille") this.reveiller(false);
    this.noter("max", `🔔 ${texte}`);
    this.parler(texte);
  }

  /** Une nouvelle du système, affichée sans parler, et transmise à Max avec le message suivant. */
  signaler(texte: string): void {
    this.noter("bureau", texte);
    this.informer(texte);
  }

  informer(texte: string): void {
    this.infos.push(texte);
    if (this.infos.length > 10) this.infos.shift();
  }

  // --- interne -----------------------------------------------------------------

  private entendre(texte: string): void {
    if (this.o.oreille?.muet || this.o.bouche.parle) return;
    const enVeille = this.etat === "veille";
    const message = reconnaitreAppel(texte, this.o.motCle, !enVeille && Date.now() < this.suiteJusqua);
    // ce qu'il a entendu s'affiche (verrouillé, rien) : la preuve que le micro marche
    if (!this.o.verrou?.verrouille) {
      this.entendu = { texte: texte.slice(0, 160), heure: Date.now(), pourMax: message !== null };
      this.changer();
    }
    if (message === null) return;
    if (enVeille) {
      // « Max » le réveille ; verrouillé, il lance la reconnaissance du visage d'abord
      if (this.o.verrou?.verrouille) {
        this.o.verrou.demander?.();
        return;
      }
      this.reveiller(false);
    }
    this.relancerMinuterie();
    if (!message) {
      this.parler("Oui ?");
      return;
    }
    this.emit("parole");
    this.envoyer(message, { de: "toi", texte: message });
  }

  private envoyer(texte: string, affichage: { de: MessageConversation["de"]; texte: string }): void {
    this.noter(affichage.de, affichage.texte);
    if (affichage.de === "toi") this.dernier = { texte, heure: Date.now() };
    this.assurerCerveau();
    const d = new Date();
    let message = this.o.horodater && affichage.de === "toi" ? `[${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}] ${texte}` : texte;
    if (this.infos.length) message = `${this.infos.map((i) => `[Bureau, pour info] ${i}`).join("\n")}\n${message}`;
    if (!this.cerveau!.envoyer(message)) {
      this.noter("bureau", "⚠️ Max ne peut pas répondre pour l'instant.");
      return;
    }
    this.infos = [];
    this.tours++;
    this.parleReponse = 0;
    this.relancerMinuterie();
    if (this.etat !== "parle") this.etat = "reflechit";
    this.changer();
  }

  private assurerCerveau(): void {
    if (this.cerveau?.actif) return;
    this.cerveau?.removeAllListeners();
    const c = this.o.creerCerveau(
      consigneMax({
        carnet: this.o.carnet(),
        missions: this.o.missions(),
        profil: this.o.profil?.(),
        contexte: [this.o.coach?.contexte(), this.o.planning?.decrire(), this.o.sport?.decrire(), this.o.vie?.decrire(), this.o.studio?.decrire(), this.o.reveil?.decrire()].filter(Boolean).join("\n"),
        conseillers: this.o.conseillers?.(),
      }),
    );
    c.on("texte", (t: string) => {
      if (this.couperReponse) return;
      for (const p of this.phraseur.ajouter(t)) this.parlerReponse(p);
    });
    c.on("outil", (o: { nom: string; entree: Record<string, unknown> }) => this.noter("bureau", libelleOutil(o.nom, o.entree)));
    c.on("fin", (f: FinReponse) => this.finReponse(f));
    c.on("arret", (a: { erreur?: string }) => {
      if (this.cerveau !== c) return;
      this.dispoCerveau = { ok: false, detail: a.erreur ?? "Max s'est arrêté." };
      this.tours = 0;
      this.phraseur = new Phraseur();
      this.couperReponse = false;
      if (this.etat === "reflechit") this.etat = "ecoute";
      this.noter("bureau", `⚠️ Max a eu un problème : ${a.erreur ?? "arrêt inattendu"}. Il redémarre au prochain message.`);
    });
    c.demarrer();
    this.cerveau = c;
    this.dispoCerveau = { ok: true };
  }

  private finReponse(f: FinReponse): void {
    const coupee = this.couperReponse;
    this.tours = Math.max(0, this.tours - 1);
    if (this.tours === 0) this.couperReponse = false;
    const reste = this.phraseur.finir();
    if (!coupee) reste.forEach((p) => this.parlerReponse(p));
    if (f.ok) {
      if (f.texte.trim()) this.noter("max", f.texte.trim());
    } else {
      const excuse = f.quota ? "Mon quota Claude est atteint. Réessaie un peu plus tard." : "Je n'ai pas réussi à répondre. Réessaie.";
      this.noter("max", excuse);
      this.parler(excuse);
    }
    this.relancerMinuterie();
    if (!this.o.bouche.parle) this.apresParole();
    else this.changer();
  }

  /** Après sa voix (ou à la fin d'une réponse muette) : on rouvre l'oreille et la fenêtre de suite. */
  private apresParole(): void {
    if (this.etat === "veille") return;
    if (this.o.bouche.parle) return;
    if (this.o.oreille) this.o.oreille.muet = false;
    this.etat = this.tours > 0 ? "reflechit" : "ecoute";
    this.suiteJusqua = Date.now() + this.o.suiteMs;
    this.relancerMinuterie();
    this.changer();
    this.verifierVeille();
  }

  private verifierVeille(): void {
    if (this.veilleDemandee && this.tours === 0 && !this.o.bouche.parle && this.etat !== "veille") this.veille();
  }

  /**
   * Une phrase de sa réponse : dite seulement jusqu'à PAROLE_MAX caractères (la suite reste à l'écran), et une
   * longue première phrase coupée à sa virgule pour que la voix démarre plus vite.
   */
  private parlerReponse(phrase: string): void {
    if (this.parleReponse >= PAROLE_MAX) return;
    let morceaux = [phrase];
    const i = phrase.indexOf(", ", 20);
    if (this.parleReponse === 0 && phrase.length > 80 && i > 0 && i < phrase.length - 15) morceaux = [phrase.slice(0, i), phrase.slice(i + 2)];
    for (const m of morceaux) {
      this.parleReponse += m.length;
      this.parler(m);
    }
  }

  private parler(phrase: string): void {
    const texte = texteParle(phrase);
    if (texte) this.o.bouche.dire(texte);
  }

  private relancerMinuterie(): void {
    clearTimeout(this.minuterieVeille);
    if (this.etat === "veille") return;
    // il s'endort sans rien dire : il entend toujours « Max »
    this.minuterieVeille = setTimeout(() => this.veilleApresParole(), this.o.veilleMs);
  }

  private surMission(e: EtatBureau): void {
    const m = e.mission;
    if (!m) return;
    const avant = this.phases.get(m.nom);
    this.phases.set(m.nom, m.phase);
    if (avant === undefined || avant === m.phase || this.etat === "veille") return;
    if (m.phase === "termine") {
      const resume = m.resultat ? extraireResume(m.resultat, 1500) : "";
      this.envoyer(
        `[Bureau] La mission « ${m.titre} » est terminée.${resume ? ` Voici le début de son résultat : ${resume}` : ""} Annonce-le à l'utilisateur en deux ou trois phrases et propose d'en dire plus.`,
        { de: "bureau", texte: `✅ Mission terminée : ${m.titre}` },
      );
    } else if (m.phase === "pause") {
      this.envoyer(`[Bureau] La mission « ${m.titre} » est en pause : le quota d'abonnement est atteint. Préviens l'utilisateur en une phrase.`, {
        de: "bureau",
        texte: `💤 Mission en pause : ${m.titre}`,
      });
    } else if (m.phase === "echec") {
      this.envoyer(`[Bureau] La mission « ${m.titre} » a échoué : ${m.erreur ?? "raison inconnue"}. Préviens l'utilisateur en une phrase.`, {
        de: "bureau",
        texte: `❌ Mission échouée : ${m.titre}`,
      });
    }
  }

  /** Début d'un créneau de l'emploi du temps : Max l'annonce (et se réveille pour ça, sauf s'il est verrouillé). */
  private debutCreneau(c: Creneau): void {
    // par défaut, un créneau s'affiche sans parler (Max ne parle pas pour rien)
    if (!this.o.annoncesCreneaux || this.o.verrou?.verrouille) {
      this.noter("bureau", `🗓 ${c.debut} · ${c.titre}`);
      return;
    }
    if (this.etat === "veille") this.reveiller(false);
    this.envoyer(
      `[Bureau] Début du créneau « ${c.titre} » (${c.debut}–${c.fin}, ${c.type}) de son emploi du temps. Annonce-le en une phrase. Travail ou cours : propose de lancer une session minutée sur ce sujet. Pause ou repas : souhaite-lui une bonne pause. Sommeil : encourage-le à aller dormir.`,
      { de: "bureau", texte: `🗓 ${c.debut} · ${c.titre}` },
    );
  }

  /** Une session fait atteindre la limite du jour de son pôle (le business) : Max le dit, sans rien arrêter. */
  private limitePole(l: LimitePole): void {
    if (this.o.verrou?.verrouille) {
      const phrase = `Ça fait ${dureeParlee(l.limite)} de ${l.pole} aujourd'hui : c'est ta limite.`;
      this.noter("max", phrase);
      this.parler(phrase);
      return;
    }
    if (this.etat === "veille") this.reveiller(false);
    this.envoyer(
      `[Bureau] Limite du pôle ${l.pole} atteinte : ${dureeParlee(l.limite)} aujourd'hui (session « ${l.sujet} » en cours). Dis-le-lui en une ou deux phrases, franchement mais sans le culpabiliser, rappelle sa priorité du moment, et propose d'arrêter cette session pour passer à la suite. Ne l'arrête pas toi-même.`,
      { de: "bureau", texte: `⏳ Limite ${l.pole} atteinte (${dureeParlee(l.limite)})` },
    );
  }

  /** Fin d'une session ou d'une pause : Max se réveille s'il dormait et l'annonce. */
  private finMinuteur(f: FinMinuteur): void {
    if (this.o.verrou?.verrouille) {
      const phrase =
        f.type === "travail"
          ? `Ta session de ${dureeParlee(f.minutes)} est finie, bravo ! Dis « ${this.o.phraseSiri ?? "Max au rapport"} » pour me réveiller.`
          : "La pause est finie.";
      this.noter("max", phrase);
      this.parler(phrase);
      return;
    }
    if (this.etat === "veille") this.reveiller(false);
    if (f.type === "travail") {
      this.envoyer(
        `[Bureau] La session de travail de ${dureeParlee(f.minutes)} sur « ${f.sujet} » est terminée. Aujourd'hui : ${dureeParlee(f.aujourdhui)} de travail. Félicite-le en une phrase, demande-lui ce qu'il a fait, et propose une pause.`,
        { de: "bureau", texte: `⏱ Session terminée : ${f.sujet} (${dureeParlee(f.minutes)}) · aujourd'hui ${dureeParlee(f.aujourdhui)}` },
      );
    } else {
      this.envoyer("[Bureau] La pause est finie. Propose-lui en une phrase de reprendre avec une nouvelle session.", { de: "bureau", texte: "☕ Pause terminée" });
    }
  }

  private noter(de: MessageConversation["de"], texte: string): void {
    this.messages.push({ de, texte, heure: new Date().toISOString() });
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.changer();
  }

  private changer(): void {
    this.emit("etat");
  }
}
