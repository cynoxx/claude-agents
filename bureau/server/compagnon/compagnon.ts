// Le compagnon : un deuxième assistant, à part de Max, fait pour parler. Pas de business ni d'outils : une
// conversation naturelle, à la voix, avec une IA locale (rien ne sort du Mac), et des souvenirs qu'il garde d'une
// conversation à l'autre (souvenirs.md, écrit après chaque conversation).
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { texteParle } from "../../shared/parole.ts";
import { Phraseur } from "../voix/phraseur.ts";

export interface CerveauLike extends EventEmitter {
  demarrer(): void;
  envoyer(texte: string): boolean;
  arreter(): void;
  readonly actif: boolean;
}
export interface BoucheLike extends EventEmitter {
  dire(phrase: string): void;
  taire(): void;
  readonly parle: boolean;
}

export interface Message {
  de: "toi" | "lui" | "systeme";
  texte: string;
  heure: number;
}

export interface CompagnonVue {
  nom: string;
  etat: "ecoute" | "reflechit" | "parle" | "pause";
  phrase: string;
  messages: Message[];
  probleme: string | null;
  ecoute: { mode: "page"; pauseFinMs: number };
}

/** Les souvenirs : un fichier Markdown, une ligne par chose retenue. */
export class Souvenirs {
  constructor(private fichier: string) {}
  lire(): string[] {
    try {
      return fs.readFileSync(this.fichier, "utf8").split("\n").filter((l) => l.startsWith("- ")).slice(-80);
    } catch {
      return [];
    }
  }
  ajouter(lignes: string[], jour: string): void {
    const propres = lignes.map((l) => l.replace(/^[-*\s]+/, "").replace(/\s+/g, " ").trim()).filter((l) => l.length > 3).slice(0, 5);
    if (!propres.length) return;
    fs.mkdirSync(path.dirname(this.fichier), { recursive: true });
    if (!fs.existsSync(this.fichier)) fs.writeFileSync(this.fichier, "# Souvenirs\n\nCe que ton compagnon a retenu de vos conversations. Tu peux modifier ou supprimer des lignes.\n\n");
    fs.appendFileSync(this.fichier, propres.map((l) => `- [${jour}] ${l}`).join("\n") + "\n");
  }
}

export interface OptionsCompagnon {
  nom: string;
  bouche: BoucheLike;
  creerCerveau: (consigne: string) => CerveauLike;
  /** La consigne, refaite à chaque nouvelle conversation (avec les souvenirs du moment). */
  consigne: () => string;
  souvenirs: Souvenirs;
  /** Ce qu'il faut retenir d'une conversation finie (quelques lignes), ou []. */
  resumer?: (conversation: string) => Promise<string[]>;
  /** Après ce silence, la conversation est finie : il en garde le souvenir et repart à neuf. */
  finConversationMs?: number;
  pauseFinMs?: number;
  jour?: () => string;
}

/** Événement : `etat` à chaque changement. */
export class Compagnon extends EventEmitter {
  private etat: CompagnonVue["etat"] = "ecoute";
  private phrase = "";
  private messages: Message[] = [];
  private cerveau: CerveauLike | null = null;
  private phraseur = new Phraseur();
  private enPause = false;
  private probleme: string | null = null;
  private debutConversation = 0;
  private minuterieFin?: NodeJS.Timeout;

  constructor(private o: OptionsCompagnon) {
    super();
    o.bouche.on("debut", () => this.changer("parle"));
    o.bouche.on("phrase", (t: string) => {
      this.phrase = t;
      this.emit("etat");
    });
    o.bouche.on("fin", () => {
      this.phrase = "";
      this.changer(this.enPause ? "pause" : "ecoute");
    });
  }

  vue(): CompagnonVue {
    return { nom: this.o.nom, etat: this.etat, phrase: this.phrase, messages: this.messages.slice(-40), probleme: this.probleme, ecoute: { mode: "page", pauseFinMs: this.o.pauseFinMs ?? 1300 } };
  }

  /** Ce que la page a entendu (sa propre voix est déjà filtrée par la page). */
  entendre(texte: string): void {
    if (this.enPause || this.o.bouche.parle) return;
    this.envoyer(texte);
  }

  ecrire(texte: string): void {
    if (this.o.bouche.parle) this.o.bouche.taire();
    this.envoyer(texte);
  }

  taire(): void {
    this.o.bouche.taire();
  }

  /** Met l'écoute en pause (ou la reprend). */
  pause(oui: boolean): void {
    this.enPause = oui;
    if (oui) this.o.bouche.taire();
    this.changer(oui ? "pause" : "ecoute");
  }

  signalerMicro(probleme: string | null): void {
    this.probleme = probleme;
    this.emit("etat");
  }

  arreter(): void {
    clearTimeout(this.minuterieFin);
    this.cerveau?.arreter();
    this.o.bouche.taire();
  }

  private envoyer(texte: string): void {
    const t = texte.replace(/\s+/g, " ").trim();
    if (!t) return;
    // une nouvelle conversation commence avec ce message
    if (!this.cerveau?.actif) this.debutConversation = this.messages.length;
    this.noter("toi", t);
    this.assurerCerveau();
    if (!this.cerveau!.envoyer(t)) {
      this.noter("systeme", "⚠️ Je n'arrive pas à réfléchir pour l'instant.");
      return;
    }
    this.changer("reflechit");
    this.relancerFin();
  }

  private assurerCerveau(): void {
    if (this.cerveau?.actif) return;
    this.cerveau?.removeAllListeners();
    const c = this.o.creerCerveau(this.o.consigne());
    c.on("texte", (t: string) => {
      for (const p of this.phraseur.ajouter(t)) this.dire(p);
    });
    c.on("fin", (f: { texte: string; ok: boolean }) => {
      this.phraseur.finir().forEach((p) => this.dire(p));
      if (f.texte.trim()) this.noter("lui", f.texte.trim());
      else if (!f.ok) this.noter("systeme", "⚠️ Je n'ai pas réussi à répondre.");
      if (!this.o.bouche.parle) this.changer(this.enPause ? "pause" : "ecoute");
    });
    c.on("arret", (a: { erreur?: string }) => {
      this.noter("systeme", `⚠️ ${a.erreur ?? "Je me suis arrêté."}`);
      if (this.etat === "reflechit") this.changer("ecoute");
    });
    c.demarrer();
    this.cerveau = c;
  }

  private dire(phrase: string): void {
    const t = texteParle(phrase);
    if (t) this.o.bouche.dire(t);
  }

  /** Après un long silence : il garde le souvenir de la conversation, puis repart avec un cerveau neuf. */
  private relancerFin(): void {
    clearTimeout(this.minuterieFin);
    this.minuterieFin = setTimeout(() => void this.finirConversation(), this.o.finConversationMs ?? 6 * 60_000);
  }

  async finirConversation(): Promise<void> {
    const echange = this.messages.slice(this.debutConversation).filter((m) => m.de !== "systeme");
    this.cerveau?.removeAllListeners();
    this.cerveau?.arreter();
    this.cerveau = null;
    this.phraseur = new Phraseur();
    if (echange.length < 2 || !this.o.resumer) return;
    const texte = echange.map((m) => `${m.de === "toi" ? "Lui" : this.o.nom} : ${m.texte}`).join("\n");
    const lignes = await this.o.resumer(texte).catch(() => []);
    this.o.souvenirs.ajouter(lignes, this.o.jour?.() ?? new Date().toISOString().slice(0, 10));
  }

  private noter(de: Message["de"], texte: string): void {
    this.messages.push({ de, texte, heure: Date.now() });
    if (this.messages.length > 200) {
      const retire = this.messages.length - 200;
      this.messages = this.messages.slice(retire);
      this.debutConversation = Math.max(0, this.debutConversation - retire);
    }
    this.emit("etat");
  }

  private changer(e: CompagnonVue["etat"]): void {
    this.etat = e;
    this.emit("etat");
  }
}

/** La consigne du compagnon : une présence qui écoute, chaleureuse et honnête. */
export function consigneCompagnon(o: { nom: string; souvenirs: string[]; profil: string; maintenant: Date }): string {
  const quand = o.maintenant.toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  return `Tu es ${o.nom}, le compagnon de conversation de l'utilisateur : quelqu'un à qui il peut parler, de tout, à n'importe quelle heure. Ce n'est pas un assistant de travail (pour ça il a Max) : ici on parle.
Tes réponses sont lues à voix haute : parle comme à l'oral, en français, en tutoyant. Pas de listes, pas de markdown, pas d'emojis.
- Écoute d'abord. Reformule ce que tu as compris quand c'est important, pose une question à la fois, laisse-lui la place. Deux ou trois phrases le plus souvent.
- Sois chaleureux, curieux, drôle quand ça s'y prête, et honnête : tu peux ne pas être d'accord, gentiment. Jamais de morale, jamais de jugement, jamais d'insulte, même s'il s'en dit à lui-même : tu lui parles comme à un frère qu'on respecte.
- Tu te souviens de ce qu'il t'a raconté (souvenirs ci-dessous) : fais-y référence naturellement, demande des nouvelles.
- Tu es une IA et tu ne fais pas semblant d'être un humain. Tu ne remplaces ni ses proches, ni un psychologue : quand il va mal ou se sent seul, écoute vraiment, puis encourage-le avec douceur vers les vrais gens de sa vie (sa famille, un ami, le psychologue du service de santé de sa fac). S'il parle d'idées noires ou de se faire du mal, prends-le au sérieux, reste avec lui et donne-lui le 3114, joignable jour et nuit, gratuitement.
Nous sommes ${quand}.

Ce que tu sais de lui (son profil) :
${o.profil.trim() || "(rien encore)"}

Tes souvenirs de vos conversations :
${o.souvenirs.join("\n") || "(c'est votre première conversation)"}`;
}
