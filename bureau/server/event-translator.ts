// Traduit les lignes `stream-json` de `claude -p` en phrases courtes pour les bulles.

export interface Resultat {
  ok: boolean;
  texte: string;
  quota: boolean;
  structured?: unknown;
}

export interface Traduction {
  bulle?: string; // ≤ 60 caractères
  action?: string; // version longue pour le fil d'actions
  sessionId?: string;
  limite?: boolean; // l'abonnement a refusé la requête (quota)
  resultat?: Resultat;
}

const QUOTA_RE = /usage limit|limit reached|hit your limit|rate limit|out of (extra )?usage|limite d'utilisation/i;

export function tronquer(texte: string, max = 60): string {
  const t = texte.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

const nomFichier = (p: unknown) => String(p ?? "").split("/").filter(Boolean).pop() ?? "un fichier";

function hote(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "une page";
  }
}

function phraseOutil(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "WebSearch":
      return `Je cherche : ${input.query ?? ""}`;
    case "WebFetch":
      return `Je lis ${hote(input.url)}…`;
    case "Read":
      return `Je lis ${nomFichier(input.file_path)}`;
    case "Write":
      return `J'écris ${nomFichier(input.file_path)}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Je modifie ${nomFichier(input.file_path ?? input.notebook_path)}`;
    case "Glob":
      return `Je cherche des fichiers (${input.pattern ?? ""})`;
    case "Grep":
      return `Je fouille le code : ${input.pattern ?? ""}`;
    case "Bash":
      return `Je lance : ${String(input.command ?? "").split("\n")[0]}`;
    case "TodoWrite":
      return "Je fais ma liste de tâches";
    case "Task":
    case "Agent":
      return "Je délègue une sous-tâche";
    case "StructuredOutput":
      return "Je rédige le plan";
    default:
      return `J'utilise ${name}`;
  }
}

function texteResultat(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c?.text === "string" ? c.text : "")).join(" ");
  return "";
}

/** Une ligne du flux → zéro, une ou plusieurs traductions. Les lignes invalides sont ignorées. */
export function translate(line: string): Traduction[] {
  let ev: any;
  try {
    ev = JSON.parse(line);
  } catch {
    return [];
  }
  if (!ev || typeof ev !== "object") return [];

  switch (ev.type) {
    case "system":
      return ev.subtype === "init" && ev.session_id ? [{ sessionId: ev.session_id }] : [];

    case "assistant": {
      const out: Traduction[] = [];
      for (const b of ev.message?.content ?? []) {
        if (b?.type === "tool_use") {
          const phrase = phraseOutil(String(b.name), b.input ?? {});
          out.push({ bulle: tronquer(phrase), action: tronquer(phrase, 200) });
        } else if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
          out.push({ bulle: tronquer(b.text.trim().split("\n")[0]), action: tronquer(b.text, 200) });
        }
      }
      return out;
    }

    case "user": {
      const out: Traduction[] = [];
      for (const b of ev.message?.content ?? []) {
        if (b?.type === "tool_result" && b.is_error) {
          out.push({ action: tronquer(`Échec de l'outil : ${texteResultat(b.content)}`, 200) });
        }
      }
      return out;
    }

    case "rate_limit_event":
      return ev.rate_limit_info?.status === "rejected" ? [{ limite: true }] : [];

    case "result": {
      const texte = typeof ev.result === "string" ? ev.result : (ev.errors ?? []).join(" ");
      const ok = ev.subtype === "success" && !ev.is_error;
      return [{ resultat: { ok, texte, quota: !ok && QUOTA_RE.test(texte), structured: ev.structured_output } }];
    }

    default:
      return [];
  }
}

/** Découpe un flux de texte en lignes complètes, en gardant la fin incomplète pour plus tard. */
export class LineSplitter {
  private reste = "";

  push(chunk: string): string[] {
    const parts = (this.reste + chunk).split("\n");
    this.reste = parts.pop() ?? "";
    return parts.filter((l) => l.trim());
  }

  flush(): string[] {
    const r = this.reste.trim();
    this.reste = "";
    return r ? [r] : [];
  }
}
