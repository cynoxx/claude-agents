// La bouche de Max, phrase par phrase : la voix neuronale Piper si elle est installée (`npm run voix`), sinon la
// commande `say` du Mac. Avec Piper, la phrase suivante est préparée pendant que la précédente est dite.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { Dispo } from "../../shared/protocol.ts";
import { choisirVoix, type VoixInfo } from "../../shared/parole.ts";

/** La liste de `say -v ?` (« Thomas   fr_FR   # Bonjour… »). */
export function lireVoixSay(sortie: string): VoixInfo[] {
  const out: VoixInfo[] = [];
  for (const l of sortie.split("\n")) {
    const m = l.match(/^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]+)\s+#/);
    if (m) out.push({ name: m[1].trim(), lang: m[2], localService: true });
  }
  return out;
}

export interface PiperLike {
  demarrer(): Promise<void>;
  synthetiser(texte: string, fichier: string): Promise<void>;
  arreter(): void;
}

export interface OptionsBouche {
  bin: string;
  /** Voix imposée ; null = meilleure voix française installée. */
  voix: string | null;
  /** Mots par minute. */
  debit: number;
  /**
   * La voix « en fichiers » (Piper, ou ElevenLabs avec ses secours) : le moteur, le lecteur de WAV (`afplay`), un
   * dossier pour les fichiers, le nom de la voix, et de quoi la décrire après le démarrage.
   */
  piper?: { moteur: PiperLike; lecteur: string; dossier: string; nom: string; decrire?: () => string; ton?: (obscur: boolean) => void };
}

/** Combien de temps une phrase attend la vraie voix qui se charge, avant d'être dite par la voix du Mac. */
const ATTENTE_VOIX_MS = 150_000;

interface Phrase {
  texte: string;
  /** Avec Piper : le fichier WAV, une fois prêt (null si la synthèse a raté ; "" : la dire avec `say`). */
  wav?: Promise<string | null>;
}

/** Événements : `debut` (il se met à parler), `phrase` (chaque phrase dite), `fin` (il a fini ou s'est tu). */
export class Bouche extends EventEmitter {
  private file: Phrase[] = [];
  private enCours?: ChildProcess;
  private occupe = false;
  private generation = 0;
  private numero = 0;
  /** Pendant que la vraie voix se charge : true quand elle est prête, false si elle n'a pas démarré. */
  private chargement: Promise<boolean> | null = null;
  private voix: string | null;
  private disponible = true;
  private avecPiper = false;

  constructor(private o: OptionsBouche) {
    super();
    this.voix = o.voix;
  }

  get parle(): boolean {
    return this.occupe || this.file.length > 0;
  }

  /** Démarre Piper s'il est là ; sinon vérifie que `say` existe et choisit la voix. */
  async preparer(): Promise<Dispo> {
    let soucisPiper = "";
    if (this.o.piper) {
      try {
        await this.o.piper.moteur.demarrer();
        fs.mkdirSync(this.o.piper.dossier, { recursive: true });
        this.avecPiper = true;
        this.disponible = true;
        return { ok: true, detail: this.o.piper.decrire?.() ?? `Voix : ${this.o.piper.nom} (Piper)` };
      } catch (e) {
        soucisPiper = ` (la voix Piper n'a pas démarré : ${(e as Error).message})`;
      }
    }
    const say = await this.preparerSay();
    return say.ok ? { ...say, detail: say.detail + soucisPiper } : say;
  }

  /**
   * Comme `preparer`, sans attendre une voix lente à charger (XTTS met jusqu'à deux minutes) : Max parle tout de
   * suite avec la voix du Mac, puis passe à sa vraie voix dès qu'elle est prête (`surPrete`).
   */
  async preparerEnArrierePlan(surPrete: (d: Dispo) => void): Promise<Dispo> {
    if (!this.o.piper) return this.preparer();
    const say = await this.preparerSay();
    // les phrases dites pendant le chargement attendent la vraie voix (pas de voix du Mac qui jure avec la sienne)
    this.chargement = this.preparer().then((d) => {
      surPrete(d);
      this.chargement = null;
      return this.avecPiper;
    });
    return say.ok ? { ok: true, detail: `Voix : ${this.o.piper.nom} en chargement` } : say;
  }

  /**
   * Enregistre une phrase dite par Max dans un fichier WAV, sans la jouer (le message du réveil) : avec Piper, ou
   * avec `say`. Renvoie false si c'est impossible.
   */
  async enregistrer(texte: string, fichier: string): Promise<boolean> {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    if (this.avecPiper && this.o.piper) {
      try {
        await this.o.piper.moteur.synthetiser(texte, fichier);
        return fs.existsSync(fichier);
      } catch {
        return false;
      }
    }
    if (!this.disponible) return false;
    const args = [...(this.voix ? ["-v", this.voix] : []), "-r", String(this.o.debit), "-o", fichier, "--file-format=WAVE", "--data-format=LEI16@22050", texte];
    return new Promise((resolve) => execFile(this.o.bin, args, { timeout: 60_000 }, (e) => resolve(!e && fs.existsSync(fichier))));
  }

  /** Le ton de Max : normal, ou Max Ultime (plus grave et plus lent, quand la voix le permet). */
  ton(obscur: boolean): void {
    this.o.piper?.ton?.(obscur);
  }

  arreter(): void {
    this.taire();
    this.o.piper?.moteur.arreter();
  }

  private async preparerSay(): Promise<Dispo> {
    try {
      const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) =>
        execFile(this.o.bin, ["-v", "?"], { timeout: 10_000 }, (e, stdout) => (e ? reject(e) : resolve({ stdout }))),
      );
      if (!this.o.voix) this.voix = choisirVoix(lireVoixSay(stdout))?.name ?? null;
      this.disponible = true;
      return { ok: true, detail: this.voix ? `Voix : ${this.voix}` : "Voix par défaut du Mac" };
    } catch (e) {
      this.disponible = false;
      const err = e as NodeJS.ErrnoException;
      return {
        ok: false,
        detail:
          err.code === "ENOENT"
            ? "Pas de voix : la commande say du Mac est introuvable. Les réponses de Max s'affichent à l'écran."
            : `La voix ne marche pas : ${err.message}`,
      };
    }
  }

  dire(phrase: string): void {
    if (!this.disponible) return;
    const texte = phrase.replace(/^[\s\-–—]+/, "").trim();
    if (!texte) return;
    const silencieux = !this.parle;
    const item: Phrase = { texte };
    // avec Piper, la synthèse commence tout de suite (pendant que la phrase d'avant est dite)
    const piper = this.o.piper;
    if (piper && (this.avecPiper || this.chargement)) {
      const fichier = path.join(piper.dossier, `max-${process.pid}-${++this.numero}.wav`);
      const synthese = () =>
        piper.moteur.synthetiser(texte, fichier).then(
          () => fichier,
          () => null,
        );
      if (this.avecPiper) item.wav = synthese();
      else {
        // la vraie voix se charge : on l'attend (au plus ATTENTE_VOIX_MS), sinon la voix du Mac pour cette phrase
        const delai = new Promise<boolean>((r) => setTimeout(() => r(false), ATTENTE_VOIX_MS).unref());
        item.wav = Promise.race([this.chargement!, delai]).then((prete) => (prete && this.avecPiper ? synthese() : ""));
      }
    }
    this.file.push(item);
    if (silencieux) {
      this.occupe = true;
      this.emit("debut");
      this.suivante();
    }
  }

  /** Se tait tout de suite et oublie les phrases en attente. */
  taire(): void {
    if (!this.parle) return;
    this.generation++;
    for (const item of this.file) void item.wav?.then((f) => f && fs.rmSync(f, { force: true }));
    this.file = [];
    this.occupe = false;
    const p = this.enCours;
    this.enCours = undefined;
    p?.kill("SIGKILL");
    this.emit("fin");
  }

  private suivante(): void {
    const item = this.file.shift();
    if (item === undefined) {
      this.enCours = undefined;
      this.occupe = false;
      this.emit("fin");
      return;
    }
    this.emit("phrase", item.texte);
    if (item.wav && this.o.piper) {
      const generation = this.generation;
      const lecteur = this.o.piper.lecteur;
      void item.wav.then((fichier) => {
        if (generation !== this.generation) return void (fichier && fs.rmSync(fichier, { force: true }));
        if (fichier === "") return this.jouer(this.o.bin, [...(this.voix ? ["-v", this.voix] : []), "-r", String(this.o.debit), item.texte]);
        if (!fichier) return this.suivante(); // phrase ratée : on passe à la suivante
        this.jouer(lecteur, [fichier], () => fs.rmSync(fichier, { force: true }));
      });
      return;
    }
    this.jouer(this.o.bin, [...(this.voix ? ["-v", this.voix] : []), "-r", String(this.o.debit), item.texte]);
  }

  private jouer(bin: string, args: string[], ensuite?: () => void): void {
    const p = spawn(bin, args, { stdio: "ignore" });
    this.enCours = p;
    p.on("error", () => {});
    p.on("close", () => {
      ensuite?.();
      if (this.enCours !== p) return;
      this.suivante();
    });
  }
}
