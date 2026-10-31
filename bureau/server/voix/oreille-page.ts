// L'oreille de Max dans sa page : la reconnaissance vocale de Chrome écoute en continu, montre ce qu'elle entend en
// direct, et envoie au serveur chaque phrase finie (après une vraie pause). Bien plus rapide et fiable que capturer
// le micro avec ffmpeg puis transcrire avec Whisper. Côté serveur, elle se comporte comme l'oreille du Mac.
import { EventEmitter } from "node:events";

export class OreillePage extends EventEmitter {
  muet = false;
  private _active = false;
  /** Ce que la page dit de son micro (autorisation, coupure…). */
  probleme: string | null = null;

  get active(): boolean {
    return this._active;
  }

  demarrer(): void {
    this._active = true;
  }

  arreter(): void {
    this._active = false;
  }

  /** Une phrase finie, envoyée par la page. */
  recevoir(texte: string): void {
    const t = texte.replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!this._active || !t) return;
    this.emit("phrase", t);
  }

  /** L'état du micro de la page : null quand tout va bien, sinon ce qui coince. */
  signaler(probleme: string | null): void {
    if (probleme === this.probleme) return;
    this.probleme = probleme;
    if (probleme) this.emit("erreur", probleme);
    else this.emit("retabli");
  }
}
