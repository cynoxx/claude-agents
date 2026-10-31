// Le cerveau de Max avec une IA locale (sur le Mac) au lieu de Claude : n'importe quel serveur compatible OpenAI
// (Ollama, LM Studio, AnythingLLM…). Il a les mêmes outils que Claude (le serveur MCP « bureau ») et se comporte comme
// le cerveau Claude : `texte` au fil de l'écriture, `outil`, `fin` par message, `arret` s'il ne peut plus répondre.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface OutilLocal {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** Les outils de Max, vus par l'IA locale. */
export interface BoiteOutils {
  lister(): Promise<OutilLocal[]>;
  appeler(nom: string, args: Record<string, unknown>): Promise<string>;
  fermer(): void;
}

/** Les outils du serveur MCP « bureau », comme pour Claude (même config). */
export function outilsMcp(mcpConfig: string): BoiteOutils {
  let client: Client | null = null;
  const connecter = async () => {
    if (client) return client;
    const c = JSON.parse(fs.readFileSync(mcpConfig, "utf8")).mcpServers.bureau as { command: string; args: string[]; env: Record<string, string> };
    const cl = new Client({ name: "max-local", version: "1.0.0" });
    await cl.connect(new StdioClientTransport({ command: c.command, args: c.args, env: { ...(process.env as Record<string, string>), ...c.env } }));
    client = cl;
    return cl;
  };
  return {
    async lister() {
      return (await (await connecter()).listTools()).tools as OutilLocal[];
    },
    async appeler(nom, args) {
      const r = (await (await connecter()).callTool({ name: nom, arguments: args })) as { content?: { type: string; text?: string }[] };
      return (r.content ?? []).map((x) => x.text ?? "").join("\n") || "(fait)";
    },
    fermer() {
      void client?.close();
      client = null;
    },
  };
}

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface OptionsCerveauLocal {
  /** L'adresse compatible OpenAI, par exemple http://localhost:11434/v1 (Ollama). */
  url: string;
  modele: string;
  cle?: string;
  consigne: string;
  outils: BoiteOutils | null;
  /** Tours d'outils au plus par message (une IA locale peut tourner en rond). */
  toursMax?: number;
}

const HISTORIQUE = 24;

/**
 * Enlève la réflexion à voix basse des modèles qui « pensent » (Qwen 3, DeepSeek : <think>…</think>), même coupée
 * entre deux morceaux du flux. Renvoie le texte à garder.
 */
export class FiltrePensee {
  private dedans = false;
  private reste = "";
  filtrer(morceau: string): string {
    let t = this.reste + morceau;
    this.reste = "";
    let out = "";
    for (;;) {
      if (this.dedans) {
        const f = t.indexOf("</think>");
        if (f < 0) {
          this.reste = t.slice(-7); // une balise peut être coupée en deux
          return out;
        }
        t = t.slice(f + 8);
        this.dedans = false;
      } else {
        const d = t.indexOf("<think>");
        if (d < 0) {
          // garder de côté un début de balise possible
          const p = t.lastIndexOf("<");
          if (p >= 0 && "<think>".startsWith(t.slice(p))) {
            this.reste = t.slice(p);
            return out + t.slice(0, p);
          }
          return out + t;
        }
        out += t.slice(0, d);
        t = t.slice(d + 7);
        this.dedans = true;
      }
    }
  }
}

export class CerveauLocal extends EventEmitter {
  private _actif = false;
  private historique: Message[] = [];
  private file: string[] = [];
  private occupe = false;
  private outils: OutilLocal[] | null = null;
  private abandon: AbortController | null = null;

  constructor(private o: OptionsCerveauLocal) {
    super();
  }

  get actif(): boolean {
    return this._actif;
  }

  demarrer(): void {
    this._actif = true;
    // les outils se chargent en avance (le serveur MCP met une seconde à démarrer)
    void this.chargerOutils();
  }

  arreter(): void {
    this._actif = false;
    this.file = [];
    this.abandon?.abort();
    this.o.outils?.fermer();
  }

  envoyer(texte: string): boolean {
    if (!this._actif) return false;
    this.file.push(texte);
    if (!this.occupe) void this.suivant();
    return true;
  }

  private async chargerOutils(): Promise<OutilLocal[]> {
    if (this.outils) return this.outils;
    try {
      this.outils = (await this.o.outils?.lister()) ?? [];
    } catch {
      this.outils = [];
    }
    return this.outils;
  }

  private async suivant(): Promise<void> {
    const texte = this.file.shift();
    if (texte === undefined) return;
    this.occupe = true;
    try {
      await this.repondre(texte);
    } finally {
      this.occupe = false;
      if (this.file.length && this._actif) void this.suivant();
    }
  }

  private async repondre(texte: string): Promise<void> {
    this.historique.push({ role: "user", content: texte });
    const outils = await this.chargerOutils();
    let tout = "";
    for (let tour = 0; tour < (this.o.toursMax ?? 4); tour++) {
      let r: { texte: string; appels: NonNullable<Message["tool_calls"]> };
      try {
        r = await this.demander(outils, tour < (this.o.toursMax ?? 4) - 1);
      } catch (e) {
        const m = (e as Error).message;
        const injoignable = /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(m);
        this.emit("fin", { texte: tout, ok: false, quota: false });
        if (injoignable) {
          this._actif = false;
          this.emit("arret", { erreur: `IA locale injoignable (${this.o.url}) : lance Ollama ou LM Studio.` });
        }
        return;
      }
      tout += r.texte;
      this.historique.push({ role: "assistant", content: r.texte || null, ...(r.appels.length ? { tool_calls: r.appels } : {}) });
      if (!r.appels.length) break;
      for (const a of r.appels) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(a.function.arguments || "{}");
        } catch {
          // des arguments mal formés : l'outil dira ce qui manque
        }
        this.emit("outil", { nom: `mcp__bureau__${a.function.name}`, entree: args });
        let res: string;
        try {
          res = this.o.outils ? await this.o.outils.appeler(a.function.name, args) : "Outils indisponibles.";
        } catch (e) {
          res = `Erreur : ${(e as Error).message}`;
        }
        this.historique.push({ role: "tool", tool_call_id: a.id, content: res.slice(0, 6000) });
      }
    }
    if (this.historique.length > HISTORIQUE) this.historique = this.historique.slice(-HISTORIQUE);
    // l'historique ne doit pas commencer par une réponse d'outil orpheline
    while (this.historique[0] && this.historique[0].role !== "user") this.historique.shift();
    this.emit("fin", { texte: tout, ok: true, quota: false });
  }

  /** Un appel au serveur, en flux : le texte part au fil de l'écriture, les appels d'outils sont rassemblés. */
  private async demander(outils: OutilLocal[], avecOutils: boolean): Promise<{ texte: string; appels: NonNullable<Message["tool_calls"]> }> {
    this.abandon = new AbortController();
    const corps = {
      model: this.o.modele,
      stream: true,
      messages: [{ role: "system", content: this.o.consigne }, ...this.historique],
      ...(avecOutils && outils.length
        ? { tools: outils.map((t) => ({ type: "function", function: { name: t.name, description: (t.description ?? "").slice(0, 400), parameters: t.inputSchema } })) }
        : {}),
    };
    const rep = await fetch(`${this.o.url.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.o.cle ? { authorization: `Bearer ${this.o.cle}` } : {}) },
      body: JSON.stringify(corps),
      signal: this.abandon.signal,
    });
    if (!rep.ok || !rep.body) throw new Error(`IA locale : ${rep.status} ${(await rep.text().catch(() => "")).slice(0, 200)}`);
    let texte = "";
    const filtre = new FiltrePensee();
    const appels: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];
    let tampon = "";
    const lecteur = rep.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      let i: number;
      while ((i = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, i).trim();
        tampon = tampon.slice(i + 1);
        if (!ligne.startsWith("data:")) continue;
        const data = ligne.slice(5).trim();
        if (data === "[DONE]") continue;
        let m: { choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
        try {
          m = JSON.parse(data);
        } catch {
          continue;
        }
        const d = m.choices?.[0]?.delta;
        const garde = d?.content ? filtre.filtrer(d.content) : "";
        if (garde) {
          // les premiers mots après la réflexion arrivent souvent précédés de blancs
          const t = texte ? garde : garde.replace(/^\s+/, "");
          if (t) {
            texte += t;
            this.emit("texte", t);
          }
        }
        for (const t of d?.tool_calls ?? []) {
          const k = t.index ?? appels.length;
          appels[k] ??= { id: t.id ?? `appel-${k}`, type: "function", function: { name: "", arguments: "" } };
          if (t.id) appels[k].id = t.id;
          if (t.function?.name) appels[k].function.name += t.function.name;
          if (t.function?.arguments) appels[k].function.arguments += t.function.arguments;
        }
      }
    }
    return { texte, appels: appels.filter((a) => a?.function.name) };
  }
}
