// L'assistant : relie l'oreille, le cerveau et la bouche de Max, gère le mot-clé, la veille et les annonces de mission.
import { EventEmitter } from "node:events";
import type { AssistantVue, CoachVue, Dispo, EtatBureau, EtatMax, MessageConversation, MissionResume, Phase } from "../../shared/protocol.ts";
import { extraireResume, texteParle } from "../../shared/parole.ts";
import { reconnaitreAppel } from "../voix/mot-cle.ts";
import { Phraseur } from "../voix/phraseur.ts";
import type { AssistantApi } from "../routes-max.ts";
import { consigneMax } from "./consigne.ts";
import type { FinReponse } from "./cerveau.ts";
import { dureeParlee, type FinMinuteur } from "./coach.ts";

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
  suiteMs: number;
  veilleMs: number;
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
}

const ACCUEIL = "Salut ! Je t'écoute.";
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
  private veilleDemandee = false;
  private reouverture?: NodeJS.Timeout;
  private minuterieVeille?: NodeJS.Timeout;
  private oreilleArretVolontaire = false;
  private phases = new Map<string, Phase>();

  constructor(private o: OptionsAssistant) {
    super();
    this.dispoOreille = o.dispos.oreille;
    this.dispoBouche = o.dispos.bouche;

    o.oreille?.on("phrase", (t: string) => this.entendre(t));
    o.oreille?.on("erreur", (m: string) => {
      this.dispoOreille = { ok: false, detail: m };
      this.noter("bureau", `⚠️ Micro : ${m}`);
    });
    o.oreille?.on("arret", () => {
      if (this.oreilleArretVolontaire) {
        this.oreilleArretVolontaire = false;
        return;
      }
      if (this.etat !== "veille" && this.dispoOreille.ok) this.dispoOreille = { ok: false, detail: "Le micro s'est arrêté." };
      this.changer();
    });

    o.bouche.on("debut", () => {
      clearTimeout(this.reouverture);
      if (this.o.oreille) this.o.oreille.muet = true;
      this.etat = "parle";
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
    o.coach?.on("rappel", (texte: string) => {
      if (this.etat === "veille") this.reveiller(false);
      this.noter("max", `🔔 ${texte}`);
      this.parler(texte);
    });
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
    };
  }

  reveiller(accueil = true): void {
    if (this.etat !== "veille") return;
    this.veilleDemandee = false;
    this.etat = "ecoute";
    if (this.o.oreille) {
      this.dispoOreille = { ok: true };
      this.o.oreille.demarrer();
    }
    this.assurerCerveau();
    this.relancerMinuterie();
    this.changer();
    if (accueil) {
      const bonjour = this.o.coach?.accueil() ?? ACCUEIL;
      this.noter("max", bonjour);
      this.parler(bonjour);
    }
  }

  veille(): void {
    clearTimeout(this.reouverture);
    clearTimeout(this.minuterieVeille);
    this.veilleDemandee = false;
    if (this.etat === "veille") return;
    if (this.o.oreille?.active) {
      this.oreilleArretVolontaire = true;
      this.o.oreille.arreter();
    }
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
    this.noter("bureau", `😴 Max est en veille. Dis « Dis Siri, ${this.o.phraseSiri ?? "Max au rapport"} » ou clique sur 👂 pour le réveiller.`);
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
    if (!t) return;
    if (this.etat === "veille") this.reveiller(false);
    this.envoyer(t, { de: "toi", texte: t });
  }

  // --- interne -----------------------------------------------------------------

  private entendre(texte: string): void {
    if (this.etat === "veille" || this.o.oreille?.muet || this.o.bouche.parle) return;
    const message = reconnaitreAppel(texte, this.o.motCle, Date.now() < this.suiteJusqua);
    if (message === null) return;
    this.relancerMinuterie();
    if (!message) {
      this.parler("Oui ?");
      return;
    }
    this.envoyer(message, { de: "toi", texte: message });
  }

  private envoyer(texte: string, affichage: { de: MessageConversation["de"]; texte: string }): void {
    this.noter(affichage.de, affichage.texte);
    this.assurerCerveau();
    const d = new Date();
    const message = this.o.horodater && affichage.de === "toi" ? `[${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}] ${texte}` : texte;
    if (!this.cerveau!.envoyer(message)) {
      this.noter("bureau", "⚠️ Max ne peut pas répondre pour l'instant.");
      return;
    }
    this.tours++;
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
        contexte: this.o.coach?.contexte(),
        conseillers: this.o.conseillers?.(),
      }),
    );
    c.on("texte", (t: string) => {
      if (this.couperReponse) return;
      for (const p of this.phraseur.ajouter(t)) this.parler(p);
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
    if (!coupee) reste.forEach((p) => this.parler(p));
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

  private parler(phrase: string): void {
    const texte = texteParle(phrase);
    if (texte) this.o.bouche.dire(texte);
  }

  private relancerMinuterie(): void {
    clearTimeout(this.minuterieVeille);
    if (this.etat === "veille") return;
    this.minuterieVeille = setTimeout(() => {
      this.parler("Je me mets en veille.");
      this.veilleApresParole();
    }, this.o.veilleMs);
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

  /** Fin d'une session ou d'une pause : Max se réveille s'il dormait et l'annonce. */
  private finMinuteur(f: FinMinuteur): void {
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
