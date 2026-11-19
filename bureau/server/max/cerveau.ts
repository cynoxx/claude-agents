// Le cerveau de Max : un `claude -p` allumé en continu, à qui on envoie les messages au fil de la conversation.
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { LineSplitter } from "../event-translator.ts";

const QUOTA = /usage limit|limit reached|hit your limit|rate limit|out of (extra )?usage/i;

export function argsCerveau(o: { modele: string; consigne: string; mcpConfig: string }): string[] {
  return [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--model", o.modele,
    "--strict-mcp-config",
    "--mcp-config", o.mcpConfig,
    "--tools", "WebSearch,WebFetch",
    "--allowedTools", "WebSearch,WebFetch,mcp__bureau",
    "--permission-mode", "default",
    "--append-system-prompt", o.consigne,
  ];
}

export interface OptionsCerveau {
  bin: string;
  modele: string;
  consigne: string;
  mcpConfig: string;
  cwd: string;
}

export interface FinReponse {
  texte: string;
  ok: boolean;
  quota: boolean;
}

/**
 * Événements : `texte` (morceau de réponse, au fil de l'écriture), `outil` ({ nom, entree }),
 * `fin` (FinReponse, une par message envoyé), `arret` ({ code, erreur? }).
 */
export class Cerveau extends EventEmitter {
  private processus?: ChildProcess;
  private arretDemande = false;
  private limite = false;

  constructor(private o: OptionsCerveau) {
    super();
  }

  get actif(): boolean {
    return !!this.processus && this.processus.exitCode === null && !this.processus.killed && !!this.processus.pid;
  }

  demarrer(): void {
    if (this.actif) return;
    this.arretDemande = false;
    let stderr = "";
    let fini = false;
    const terminer = (code: number | null, erreur?: string) => {
      if (fini) return;
      fini = true;
      this.emit("arret", { code, erreur });
    };
    const p = spawn(this.o.bin, argsCerveau(this.o), { cwd: this.o.cwd, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    this.processus = p;
    const lignes = new LineSplitter();
    p.stdout!.setEncoding("utf8");
    p.stdout!.on("data", (t: string) => lignes.push(t).forEach((l) => this.lire(l)));
    p.stderr!.setEncoding("utf8");
    p.stderr!.on("data", (t: string) => (stderr = (stderr + t).slice(-2000)));
    p.stdin!.on("error", () => {});
    p.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") terminer(null, `claude introuvable (${this.o.bin}).`);
    });
    p.on("close", (code) => {
      lignes.flush().forEach((l) => this.lire(l));
      const erreur = this.arretDemande ? undefined : stderr.trim().split("\n").slice(-3).join(" ") || `Max s'est arrêté (code ${code}).`;
      terminer(code, erreur);
    });
  }

  /** Envoie un message à Max ; false s'il n'est pas allumé. */
  envoyer(texte: string): boolean {
    if (!this.actif) return false;
    this.processus!.stdin!.write(JSON.stringify({ type: "user", message: { role: "user", content: texte } }) + "\n");
    return true;
  }

  arreter(): void {
    this.arretDemande = true;
    const p = this.processus;
    if (!p || p.exitCode !== null) return;
    p.stdin?.end();
    p.kill("SIGTERM");
    setTimeout(() => p.exitCode === null && p.kill("SIGKILL"), 2000).unref();
  }

  private lire(ligne: string): void {
    let ev: any;
    try {
      ev = JSON.parse(ligne);
    } catch {
      return;
    }
    if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") {
      this.emit("texte", String(ev.event.delta.text ?? ""));
    } else if (ev.type === "assistant") {
      for (const b of ev.message?.content ?? []) if (b?.type === "tool_use") this.emit("outil", { nom: String(b.name), entree: b.input ?? {} });
    } else if (ev.type === "rate_limit_event" && ev.rate_limit_info?.status === "rejected") {
      this.limite = true;
    } else if (ev.type === "result") {
      const texte = typeof ev.result === "string" ? ev.result : "";
      const ok = ev.subtype === "success" && !ev.is_error;
      this.emit("fin", { texte, ok, quota: !ok && (this.limite || QUOTA.test(texte)) } satisfies FinReponse);
      this.limite = false;
    }
  }
}
