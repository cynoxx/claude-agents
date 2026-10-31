// L'oreille de Max dans sa page : la reconnaissance vocale de Chrome (Web Speech API), en continu, en français.
// - Ce que tu dis s'affiche en direct sous Max (preuve immédiate qu'il t'entend).
// - Ta phrase n'est envoyée qu'après une vraie pause (pauseFinMs) : il te laisse finir.
// - Pendant que Max parle, ce qu'il entend est ignoré (c'est sa propre voix), sauf « stop », « tais-toi »,
//   « attends », « chut » : Max se tait tout de suite.
// - Elle redémarre toute seule quand Chrome la coupe (silence, réseau), et dit ce qui coince.
import type { ClientMessage, EtatBureau } from "../shared/protocol.ts";
import { texteFinal, tuLuiCoupesLaParole } from "./ecoute-pur.ts";

type Resultat = { isFinal: boolean; 0: { transcript: string } };
interface Reconnaissance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<Resultat> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const ECHO_MS = 700; // après sa voix, encore un instant sourd (la fin de son son dans la pièce)

export class Ecoute {
  private rec: Reconnaissance | null = null;
  private voulu = false;
  private enMarche = false;
  private tampon: string[] = [];
  private minuterie = 0;
  private parle = false;
  private finParole = 0;
  private pauseFinMs = 1200;
  private relance = 0;
  private echecs = 0;
  private probleme: string | null = null;
  private ligne = document.getElementById("j-entendu");
  /** Les dernières phrases dites par Max : ce que le micro entend de lui (pour le reconnaître). */
  private phrasesMax: string[] = [];
  private signe = 0;

  constructor(private envoyer: (m: ClientMessage) => void) {
    const C = (window as unknown as { SpeechRecognition?: new () => Reconnaissance; webkitSpeechRecognition?: new () => Reconnaissance }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Reconnaissance }).webkitSpeechRecognition;
    if (!C) return;
    const r = new C();
    r.lang = "fr-FR";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      this.enMarche = true;
      this.echecs = 0;
      this.signaler(null);
    };
    r.onresult = (e) => this.resultat(e);
    r.onerror = (e) => this.erreur(e.error);
    r.onend = () => {
      this.enMarche = false;
      if (this.voulu) this.redemarrer();
    };
    this.rec = r;
  }

  get disponible(): boolean {
    return !!this.rec;
  }

  rendre(e: EtatBureau): void {
    const a = e.assistant;
    const page = a?.ecoute?.mode === "page";
    if (page && !this.rec) this.signaler("Ce navigateur ne sait pas écouter : ouvre Max dans Chrome (npm start l'ouvre tout seul).");
    if (a?.ecoute) this.pauseFinMs = a.ecoute.pauseFinMs;
    const parle = a?.etat === "parle";
    if (a?.phrase && a.phrase !== this.phrasesMax.at(-1)) this.phrasesMax = [...this.phrasesMax.slice(-3), a.phrase];
    if (this.parle && !parle) this.finParole = Date.now();
    this.parle = parle;
    if (parle) this.vider(); // ce qu'il a entendu pendant qu'il parlait, c'était lui
    this.vouloir(page);
  }

  private vouloir(oui: boolean): void {
    if (oui === this.voulu || !this.rec) return;
    this.voulu = oui;
    if (oui) this.redemarrer(0);
    else {
      clearTimeout(this.relance);
      this.rec.abort();
    }
  }

  private redemarrer(delai = 250): void {
    clearTimeout(this.relance);
    this.relance = window.setTimeout(() => {
      if (!this.voulu || this.enMarche || !this.rec) return;
      try {
        this.rec.start();
      } catch {
        // déjà en marche
      }
    }, delai);
  }

  private resultat(e: { resultIndex: number; results: ArrayLike<Resultat> }): void {
    let provisoire = "";
    const finals: string[] = [];
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finals.push(t);
      else provisoire += t;
    }
    const sourd = this.parle || Date.now() - this.finParole < ECHO_MS;
    if (sourd) {
      // il parle (ou sa voix résonne encore) : ce qui ressemble à ses phrases, c'est lui ; sinon c'est toi qui lui
      // coupes la parole : il se tait tout de suite et t'écoute (ce que tu as commencé à dire est gardé)
      if (!tuLuiCoupesLaParole(provisoire + " " + finals.join(" "), this.phrasesMax)) return;
      if (this.parle) this.envoyer({ type: "taire" });
      this.parle = false;
      this.finParole = 0;
      this.afficher();
    }
    this.tampon.push(...finals.map((f) => f.trim()).filter(Boolean));
    const tout = texteFinal([...this.tampon, provisoire]);
    if (tout) this.afficher();
    // la phrase part après une vraie pause : tant qu'il parle encore (provisoire), on attend
    clearTimeout(this.minuterie);
    if (this.tampon.length) this.minuterie = window.setTimeout(() => this.envoyerPhrase(), provisoire.trim() ? this.pauseFinMs + 400 : this.pauseFinMs);
  }

  private envoyerPhrase(): void {
    const texte = texteFinal(this.tampon);
    this.tampon = [];
    if (!texte || this.parle) return;
    this.envoyer({ type: "entendu", texte });
  }

  private vider(): void {
    clearTimeout(this.minuterie);
    this.tampon = [];
  }

  /** Tes paroles ne s'écrivent pas à l'écran : seul un signe montre qu'il t'entend. */
  private afficher(): void {
    if (!this.ligne) return;
    this.ligne.dataset.entend = "oui";
    this.ligne.dataset.directA = String(Date.now());
    clearTimeout(this.signe);
    this.signe = window.setTimeout(() => this.ligne && (this.ligne.dataset.entend = "non"), 900);
  }

  private erreur(code: string): void {
    if (code === "no-speech" || code === "aborted") return; // du silence : il relance tout seul
    if (code === "not-allowed" || code === "service-not-allowed") {
      this.voulu = false;
      this.signaler("Max n'a pas le droit d'utiliser le micro : clique sur le cadenas à gauche de l'adresse, autorise le micro, puis recharge la page.");
      return;
    }
    if (code === "audio-capture") this.signaler("Aucun micro trouvé : vérifie Réglages Système › Son › Entrée.");
    else if (code === "network") this.signaler("La reconnaissance vocale a besoin d'internet : je réessaie.");
    // on réessaie, de plus en plus espacé
    this.echecs++;
    this.redemarrer(Math.min(10_000, 500 * 2 ** this.echecs));
  }

  private signaler(probleme: string | null): void {
    if (probleme === this.probleme) return;
    this.probleme = probleme;
    this.envoyer({ type: "micro", probleme });
  }
}
