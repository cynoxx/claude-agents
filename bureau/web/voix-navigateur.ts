// Enveloppes minces autour de la dictée et de la synthèse vocale du navigateur.
// Les constructeurs sont passés en paramètre : les tests y mettent de fausses versions.
import { choisirVoix, messageErreurDictee, type VoixInfo } from "./voix.ts";

interface Reconnaissance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}
type ConstructeurReconnaissance = new () => Reconnaissance;

export interface RappelsDictee {
  /** Texte entendu jusqu'ici ; `final` quand le navigateur le considère comme terminé. */
  onTexte(texte: string, final: boolean): void;
  /** La dictée est finie ; `texte` est le texte final, vide si rien n'est sorti (erreur, silence, arrêt). */
  onFin(texte: string): void;
  onErreur(message: string): void;
}

/** La dictée : micro → texte, en français, tant que tu parles. */
export class Dictee {
  ecoute = false;
  private reco: Reconnaissance | null = null;

  constructor(private Ctor: ConstructeurReconnaissance | undefined) {}

  static duNavigateur(): Dictee {
    const w = window as any;
    return new Dictee(w.SpeechRecognition ?? w.webkitSpeechRecognition);
  }

  get disponible(): boolean {
    return !!this.Ctor;
  }

  demarrer(rappels: RappelsDictee): void {
    if (!this.Ctor || this.ecoute) return;
    const reco = new this.Ctor();
    reco.lang = "fr-FR";
    reco.interimResults = true;
    reco.continuous = false;
    reco.maxAlternatives = 1;

    let texte = "";
    let final = false;
    let erreur = false;
    reco.onresult = (e) => {
      const parts: string[] = [];
      for (let i = 0; i < e.results.length; i++) parts.push(e.results[i][0].transcript);
      texte = parts.join(" ").trim();
      final = !!e.results[e.results.length - 1]?.isFinal;
      rappels.onTexte(texte, final);
    };
    reco.onerror = (e) => {
      erreur = true;
      const message = messageErreurDictee(e.error);
      if (message) rappels.onErreur(message);
    };
    reco.onend = () => {
      this.ecoute = false;
      this.reco = null;
      rappels.onFin(final && !erreur ? texte : "");
    };

    this.reco = reco;
    this.ecoute = true;
    try {
      reco.start();
    } catch (e) {
      this.ecoute = false;
      this.reco = null;
      rappels.onErreur(`La dictée n'a pas pu démarrer (${(e as Error).message}).`);
      rappels.onFin("");
    }
  }

  arreter(): void {
    this.reco?.stop();
  }
}

interface Synthese {
  getVoices(): VoixInfo[];
  speak(e: any): void;
  cancel(): void;
}

/** La voix de Max : texte → parole, avec la meilleure voix française du Mac. */
export class Parole {
  muet = false;

  constructor(
    private synthese: Synthese | undefined,
    private Enonce: (new (texte: string) => any) | undefined,
  ) {}

  static duNavigateur(): Parole {
    const w = window as any;
    return new Parole(w.speechSynthesis, w.SpeechSynthesisUtterance);
  }

  get disponible(): boolean {
    return !!this.synthese && !!this.Enonce;
  }

  parler(texte: string): void {
    if (!this.synthese || !this.Enonce || this.muet || !texte.trim()) return;
    this.synthese.cancel();
    const enonce = new this.Enonce(texte);
    enonce.lang = "fr-FR";
    try {
      const voix = choisirVoix(this.synthese.getVoices());
      if (voix) enonce.voice = voix;
    } catch {
      // voix refusée par le navigateur : Max parle avec la voix par défaut plutôt que de rester muet
    }
    this.synthese.speak(enonce);
  }

  taire(): void {
    this.synthese?.cancel();
  }
}
