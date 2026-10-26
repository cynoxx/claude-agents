// La bouche de Max : la commande `say` du Mac, phrase par phrase.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
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

export interface OptionsBouche {
  bin: string;
  /** Voix imposée ; null = meilleure voix française installée. */
  voix: string | null;
  /** Mots par minute. */
  debit: number;
}

/** Événements : `debut` (il se met à parler), `phrase` (chaque phrase dite), `fin` (il a fini ou s'est tu). */
export class Bouche extends EventEmitter {
  private file: string[] = [];
  private enCours?: ChildProcess;
  private voix: string | null;
  private disponible = true;

  constructor(private o: OptionsBouche) {
    super();
    this.voix = o.voix;
  }

  get parle(): boolean {
    return !!this.enCours || this.file.length > 0;
  }

  /** Vérifie que `say` existe et choisit la voix. */
  async preparer(): Promise<Dispo> {
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
    this.file.push(texte);
    if (silencieux) {
      this.emit("debut");
      this.suivante();
    }
  }

  /** Se tait tout de suite et oublie les phrases en attente. */
  taire(): void {
    if (!this.parle) return;
    this.file = [];
    const p = this.enCours;
    this.enCours = undefined;
    p?.kill("SIGKILL");
    this.emit("fin");
  }

  private suivante(): void {
    const texte = this.file.shift();
    if (texte === undefined) {
      this.enCours = undefined;
      this.emit("fin");
      return;
    }
    this.emit("phrase", texte);
    const args = [...(this.voix ? ["-v", this.voix] : []), "-r", String(this.o.debit), texte];
    const p = spawn(this.o.bin, args, { stdio: "ignore" });
    this.enCours = p;
    p.on("error", () => {});
    p.on("close", () => {
      if (this.enCours !== p) return;
      this.suivante();
    });
  }
}
