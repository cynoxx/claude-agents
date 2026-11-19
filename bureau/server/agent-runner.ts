import { spawn } from "node:child_process";
import { LineSplitter, translate, type Traduction } from "./event-translator.ts";

export interface RunResult {
  ok: boolean;
  quota: boolean;
  sessionId?: string;
  texte: string;
  structured?: unknown;
  erreur?: string;
}

export interface AgentHandle {
  done: Promise<RunResult>;
  stop(): void;
}

export interface RunOptions {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** "stream" : une ligne JSON par événement ; "json" : un seul objet résultat à la fin. */
  mode: "stream" | "json";
  onTraduction?(t: Traduction): void;
  onRawLine?(line: string): void;
}

const QUOTA_STDERR = /usage limit|limit reached|hit your limit|rate limit/i;

/** Lance un processus `claude -p` (sans shell) et suit son flux jusqu'au résultat. */
export function runAgent(opts: RunOptions): AgentHandle {
  let arretDemande = false;
  let delaiDepasse = false;
  let child: ReturnType<typeof spawn> | undefined;

  const tuer = () => {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGTERM");
    setTimeout(() => child && child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
  };

  const done = new Promise<RunResult>((resolve) => {
    let sessionId: string | undefined;
    let limite = false;
    let resultat: Traduction["resultat"];
    let stdoutJson = "";
    let stderr = "";
    const splitter = new LineSplitter();

    const traiter = (line: string) => {
      opts.onRawLine?.(line);
      for (const t of translate(line)) {
        if (t.sessionId) sessionId = t.sessionId;
        if (t.limite) limite = true;
        if (t.resultat) resultat = t.resultat;
        opts.onTraduction?.(t);
      }
    };

    try {
      child = spawn(opts.bin, opts.args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    } catch (e) {
      resolve({ ok: false, quota: false, texte: "", erreur: `Impossible de lancer claude : ${(e as Error).message}` });
      return;
    }

    const timer = setTimeout(() => {
      delaiDepasse = true;
      tuer();
    }, opts.timeoutMs);

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (opts.mode === "json") stdoutJson += chunk;
      else splitter.push(chunk).forEach(traiter);
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const msg = e.code === "ENOENT" ? `claude introuvable (${opts.bin})` : e.message;
      resolve({ ok: false, quota: false, texte: "", erreur: msg });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (opts.mode === "json") {
        if (stdoutJson.trim()) traiter(stdoutJson.trim());
      } else {
        splitter.flush().forEach(traiter);
      }
      const base = { sessionId, texte: resultat?.texte ?? "", structured: resultat?.structured };
      if (arretDemande) return resolve({ ...base, ok: false, quota: false, erreur: "Arrêté" });
      if (delaiDepasse) {
        const min = Math.round(opts.timeoutMs / 60000);
        return resolve({ ...base, ok: false, quota: false, erreur: `Délai dépassé (${min || "<1"} min)` });
      }
      if (resultat?.ok) return resolve({ ...base, ok: true, quota: false });
      const quota = Boolean(resultat?.quota || limite || QUOTA_STDERR.test(stderr));
      const detail = resultat?.texte || stderr.trim().split("\n").slice(-3).join(" ") || `code de sortie ${code}`;
      resolve({ ...base, ok: false, quota, erreur: quota ? "Quota d'abonnement atteint" : detail });
    });
  });

  return {
    done,
    stop() {
      arretDemande = true;
      tuer();
    },
  };
}
