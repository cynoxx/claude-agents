// L'oreille de Max : micro (ffmpeg) → détecteur de parole → Whisper → phrase.
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { DetecteurParole, TAUX, type OptionsDetecteur } from "./vad.ts";
import { encoderWav } from "./wav.ts";
import { estHallucination } from "./mot-cle.ts";

const SORTIE_PCM = ["-ac", "1", "-ar", String(TAUX), "-f", "s16le", "-"];

/** ffmpeg qui lit un micro du Mac (format avfoundation, ex. « :0 »). */
export function argsFfmpegMicro(micro: string): string[] {
  return ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", micro, ...SORTIE_PCM];
}

/** ffmpeg qui lit un fichier audio, pour les essais ; `tempsReel` le lit à vitesse normale. */
export function argsFfmpegFichier(fichier: string, tempsReel: boolean): string[] {
  return ["-hide_banner", "-loglevel", "error", ...(tempsReel ? ["-re"] : []), "-i", fichier, ...SORTIE_PCM];
}

export interface OptionsOreille {
  commande: { bin: string; args: string[] };
  transcrire: (wav: Buffer) => Promise<string>;
  detecteur?: OptionsDetecteur;
}

/**
 * Événements : `phrase` (texte transcrit, déjà débarrassé des inventions de Whisper),
 * `erreur` (message pour l'utilisateur), `arret` (le micro est coupé).
 */
export class Oreille extends EventEmitter {
  private processus?: ChildProcess;
  private detecteur: DetecteurParole;
  private octetSeul: Buffer | null = null;
  private file: Promise<void> = Promise.resolve();
  private arretDemande = false;
  private _muet = false;

  constructor(private o: OptionsOreille) {
    super();
    this.detecteur = new DetecteurParole(o.detecteur);
  }

  get active(): boolean {
    return !!this.processus && this.processus.exitCode === null && !this.processus.killed;
  }

  /** Muette pendant que Max parle : ce qui est capté est jeté, pour qu'il ne s'entende pas lui-même. */
  set muet(v: boolean) {
    this._muet = v;
    this.detecteur.reinitialiser();
  }
  get muet(): boolean {
    return this._muet;
  }

  demarrer(): void {
    if (this.active) return;
    this.arretDemande = false;
    this.detecteur.reinitialiser();
    this.octetSeul = null;
    let stderr = "";
    const p = spawn(this.o.commande.bin, this.o.commande.args, { stdio: ["ignore", "pipe", "pipe"] });
    this.processus = p;

    p.stdout!.on("data", (chunk: Buffer) => this.recevoir(chunk));
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (t: string) => (stderr = (stderr + t).slice(-2000)));
    p.on("error", (e: NodeJS.ErrnoException) => {
      const msg = e.code === "ENOENT" ? `ffmpeg introuvable (${this.o.commande.bin}). Installe-le avec « brew install ffmpeg ».` : e.message;
      this.emit("erreur", msg);
    });
    p.on("close", (code) => {
      if (!this.arretDemande && code !== 0 && code !== null && stderr.trim()) {
        this.emit("erreur", `Le micro ne répond pas : ${stderr.trim().split("\n").slice(-2).join(" ")}`);
      }
      this.file.then(() => this.emit("arret"));
    });
  }

  arreter(): void {
    this.arretDemande = true;
    const p = this.processus;
    if (!p || p.exitCode !== null) return;
    p.kill("SIGTERM");
    setTimeout(() => p.exitCode === null && p.kill("SIGKILL"), 2000).unref();
  }

  private recevoir(chunk: Buffer): void {
    let b = this.octetSeul ? Buffer.concat([this.octetSeul, chunk]) : chunk;
    this.octetSeul = null;
    if (b.length % 2) {
      this.octetSeul = b.subarray(b.length - 1);
      b = b.subarray(0, b.length - 1);
    }
    const pcm = new Int16Array(b.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = b.readInt16LE(i * 2);
    for (const enonce of this.detecteur.pousser(pcm)) {
      if (this._muet) continue;
      const wav = encoderWav(enonce, TAUX);
      this.file = this.file.then(() => this.transcrire(wav));
    }
  }

  private async transcrire(wav: Buffer): Promise<void> {
    try {
      const texte = (await this.o.transcrire(wav)).trim();
      if (texte && !estHallucination(texte)) this.emit("phrase", texte);
    } catch (e) {
      this.emit("erreur", `Transcription impossible : ${(e as Error).message}`);
    }
  }
}
