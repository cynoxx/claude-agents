// La musique de Max (ton fichier, par exemple `~/Documents/Bureau/musique/max.mp3`) : l'intro jouée sur le Mac quand
// Max se lance, et le fond musical de l'appel du réveil. ffmpeg prépare les extraits (une fois, gardés en cache) :
// la musique démarre fort, puis baisse pour laisser parler Max, et s'éteint en fondu.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Executer = (bin: string, args: string[]) => Promise<{ code: number; stderr: string }>;

const executerParDefaut: Executer = (bin, args) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: 120_000 }, (e, _stdout, stderr) => resolve({ code: e ? ((e as { code?: number }).code ?? 1) : 0, stderr: String(stderr) }));
  });

/** Les mp3 d'un dossier (sans descendre dans les sous-dossiers) dont le nom correspond au motif. */
export function chercherMp3(dossier: string, motif: RegExp): string[] {
  try {
    return fs
      .readdirSync(dossier)
      .filter((n) => /\.mp3$/i.test(n) && motif.test(n))
      .map((n) => path.join(dossier, n));
  } catch {
    return [];
  }
}

/** L'intro : 14 s, pleine puissance 5 s, puis baisse sous la voix de Max, et fondu final. */
export const INTRO_MS = 14_000;
/** Max commence à parler quand la musique a baissé. */
// l'entrée (l'œil de code, puis la fenêtre du Système) dure ~7,4 s : Max parle juste après
export const PAROLE_APRES_MS = 7_400;

export function argsIntro(source: string, sortie: string): string[] {
  return [
    "-y", "-loglevel", "error", "-i", source,
    // 5 s de musique pleine, puis elle descend doucement (à 15 %) et reste en fond sous la voix de Max, une minute en tout
    "-af", "atrim=0:60,afade=t=in:d=0.4,volume='if(lt(t,5),1,if(lt(t,6.5),1-0.85*(t-5)/1.5,0.15))':eval=frame,afade=t=out:st=51:d=9",
    "-ac", "2", "-ar", "44100", sortie,
  ];
}

/**
 * Le message du réveil (la voix de Max, en WAV) sur la musique : 4 s de musique seule, puis la voix par-dessus la
 * musique baissée, puis la musique revient et s'éteint. Sortie en MP3 mono 22 kHz (assez pour un téléphone).
 */
export function argsMixReveil(musique: string, voix: string, sortie: string, dureeVoix: number): string[] {
  const fin = Math.ceil(4 + dureeVoix + 4);
  return [
    "-y", "-loglevel", "error", "-i", musique, "-i", voix,
    "-filter_complex",
    `[0:a]atrim=0:${fin},volume='if(lt(t,4),0.9,if(lt(t,${(4 + dureeVoix).toFixed(1)}),0.18,0.6))':eval=frame,afade=t=in:d=0.3,afade=t=out:st=${fin - 2}:d=2[m];` +
      `[1:a]adelay=4000|4000,volume=1.6[v];[m][v]amix=inputs=2:duration=first:normalize=0[out]`,
    "-map", "[out]", "-ac", "1", "-ar", "22050", "-b:a", "64k", sortie,
  ];
}

/** Événement : `intro` (moment, en ms) quand l'intro démarre, pour l'animation de la page. */
export class Musique extends EventEmitter {
  private executer: Executer;
  private lecture: ChildProcess | null = null;

  constructor(
    private o: {
      /** Ton fichier de musique ; null ou absent = pas de musique. */
      source: string | null;
      /** Un motif (regex, sans tenir compte des majuscules) pour retrouver ton mp3 par son nom s'il n'est pas à sa place. */
      recherche?: string;
      /** La maison de l'utilisateur (pour les tests). */
      maison?: string;
      /** Recherche par Spotlight (`mdfind -name …`), pour les fichiers rangés ailleurs. */
      recherchePar?: (nom: string) => Promise<string[]>;
      /** Où ranger les extraits préparés. */
      dossier: string;
      ffmpeg: string;
      /** Le lecteur audio du Mac (`afplay`) ; null = pas de son (hors Mac). */
      lecteur: string | null;
      executer?: Executer;
    },
  ) {
    super();
    this.executer = o.executer ?? executerParDefaut;
  }

  get disponible(): boolean {
    return !!this.o.source && fs.existsSync(this.o.source);
  }

  /**
   * Si ta musique n'est pas encore à sa place, la cherche par son nom là où on télécharge ou range d'habitude
   * (Téléchargements, Bureau, Musique, Documents, puis Spotlight) et la copie à sa place. Renvoie où elle est.
   */
  async chercher(): Promise<string | null> {
    if (this.disponible) return this.o.source;
    if (!this.o.source || !this.o.recherche) return null;
    const motif = new RegExp(this.o.recherche, "i");
    const maison = this.o.maison ?? os.homedir();
    const lieux = ["Downloads", "Desktop", "Music", "Documents", path.join("Music", "Music", "Media.localized", "Music")].map((d) => path.join(maison, d));
    let trouves = lieux.flatMap((d) => chercherMp3(d, motif));
    if (!trouves.length && this.o.recherchePar) {
      try {
        trouves = (await this.o.recherchePar(this.o.recherche)).filter((f) => /\.mp3$/i.test(f) && motif.test(path.basename(f)) && fs.existsSync(f));
      } catch {
        trouves = [];
      }
    }
    if (!trouves.length) return null;
    // le plus récent d'abord
    trouves.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    try {
      fs.mkdirSync(path.dirname(this.o.source), { recursive: true });
      fs.copyFileSync(trouves[0], this.o.source);
    } catch {
      return null;
    }
    return trouves[0];
  }

  get source(): string | null {
    return this.disponible ? this.o.source : null;
  }

  /** Un extrait préparé par ffmpeg, refait seulement si ton fichier change. */
  private async extrait(nom: string, args: (source: string, sortie: string) => string[]): Promise<string | null> {
    const source = this.source;
    if (!source) return null;
    const cle = Math.round(fs.statSync(source).mtimeMs).toString(36);
    const sortie = path.join(this.o.dossier, `${nom}-${cle}.wav`);
    if (fs.existsSync(sortie)) return sortie;
    fs.mkdirSync(this.o.dossier, { recursive: true });
    const r = await this.executer(this.o.ffmpeg, args(source, sortie));
    return r.code === 0 && fs.existsSync(sortie) ? sortie : null;
  }

  /**
   * L'intro au lancement de Max : l'animation de la page démarre tout de suite (`intro`), la musique aussi (sur le
   * Mac). Renvoie le délai avant que Max parle (0 sans musique).
   */
  jouerIntro(): number {
    this.emit("intro", Date.now());
    if (!this.disponible || !this.o.lecteur) return this.disponible ? 0 : 1200;
    const lecteur = this.o.lecteur;
    void this.extrait("intro", argsIntro).then((f) => {
      if (f) spawn(lecteur, [f], { stdio: "ignore" }).on("error", () => {});
    });
    return PAROLE_APRES_MS;
  }

  /**
   * L'amorce du réveil : ta musique, tout de suite (l'extrait de l'intro), pendant que la voix de Max se fabrique.
   * Renvoie false sans musique ou hors Mac.
   */
  async jouerAmorce(): Promise<boolean> {
    if (!this.disponible || !this.o.lecteur) return false;
    const f = await this.extrait("intro", argsIntro);
    return f ? this.jouerFichier(f) : false;
  }

  /** Joue un fichier sur le Mac (le réveil) ; arrête la lecture précédente. false hors Mac. */
  jouerFichier(fichier: string): boolean {
    this.arreterLecture();
    if (!this.o.lecteur || !fs.existsSync(fichier)) return false;
    const p = spawn(this.o.lecteur, [fichier], { stdio: "ignore" });
    p.on("error", () => {});
    p.on("exit", () => this.lecture === p && (this.lecture = null));
    this.lecture = p;
    return true;
  }

  arreterLecture(): void {
    this.lecture?.kill();
    this.lecture = null;
  }

  /** Mixe un message (WAV) sur la musique, pour l'appel du réveil ; null sans musique ou si ffmpeg échoue. */
  async mixerReveil(voix: string, dureeVoix: number, sortie: string): Promise<string | null> {
    const source = this.source;
    if (!source) return null;
    fs.mkdirSync(path.dirname(sortie), { recursive: true });
    const r = await this.executer(this.o.ffmpeg, argsMixReveil(source, voix, sortie, dureeVoix));
    return r.code === 0 && fs.existsSync(sortie) ? sortie : null;
  }
}
