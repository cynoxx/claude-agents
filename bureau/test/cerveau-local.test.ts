import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { CerveauLocal, type BoiteOutils } from "../server/max/cerveau-local.ts";

let serveur: http.Server | null = null;
afterEach(() => serveur?.close());

/** Un faux Ollama : au 1er appel il demande l'outil memoriser, au 2e il répond en deux morceaux. */
async function fauxOllama(corps: Record<string, unknown>[]): Promise<string> {
  let n = 0;
  serveur = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      corps.push(JSON.parse(b));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (o: object) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (n++ === 0) {
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a1", function: { name: "memoriser", arguments: '{"note":' } }] } }] });
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"aime le violet"}' } }] } }] });
      } else {
        ev({ choices: [{ delta: { content: "C'est noté. " } }] });
        ev({ choices: [{ delta: { content: "Autre chose ?" } }] });
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => serveur!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(serveur!.address() as AddressInfo).port}/v1`;
}

describe("le cerveau local (IA du Mac, compatible OpenAI)", () => {
  it("répond au fil de l'écriture et utilise les outils de Max", async () => {
    const corps: Record<string, unknown>[] = [];
    const url = await fauxOllama(corps);
    const appels: string[] = [];
    const outils: BoiteOutils = {
      lister: async () => [{ name: "memoriser", description: "Retient une note", inputSchema: { type: "object", properties: { note: { type: "string" } } } }],
      appeler: async (nom, args) => (appels.push(`${nom}:${JSON.stringify(args)}`), "Noté."),
      fermer: () => {},
    };
    const c = new CerveauLocal({ url, modele: "qwen2.5:7b", consigne: "Tu es Max.", outils });
    const morceaux: string[] = [];
    const evts: string[] = [];
    c.on("texte", (t: string) => morceaux.push(t));
    c.on("outil", (o: { nom: string }) => evts.push(o.nom));
    const fin = new Promise<{ texte: string; ok: boolean }>((r) => c.once("fin", r));
    c.demarrer();
    expect(c.envoyer("Retiens que j'aime le violet")).toBe(true);
    expect(await fin).toEqual({ texte: "C'est noté. Autre chose ?", ok: true, quota: false });
    expect(morceaux).toEqual(["C'est noté. ", "Autre chose ?"]);
    expect(evts).toEqual(["mcp__bureau__memoriser"]);
    expect(appels).toEqual(['memoriser:{"note":"aime le violet"}']);
    expect((corps[0].messages as { role: string }[])[0]).toEqual({ role: "system", content: "Tu es Max." });
    expect((corps[0].tools as unknown[]).length).toBe(1);
    expect((corps[1].messages as { role: string; content: string }[]).at(-1)).toMatchObject({ role: "tool", content: "Noté." });
  });

  it("dit clairement quand l'IA locale n'est pas lancée", async () => {
    const c = new CerveauLocal({ url: "http://127.0.0.1:9/v1", modele: "x", consigne: "", outils: null });
    const arret = new Promise<{ erreur: string }>((r) => c.once("arret", r));
    c.on("fin", () => {});
    c.demarrer();
    c.envoyer("Salut");
    expect((await arret).erreur).toContain("lance Ollama ou LM Studio");
    expect(c.actif).toBe(false);
  });
});

describe("npm run ia-locale", () => {
  it("choisit le meilleur modèle installé pour Max", async () => {
    const { choisirModele } = await import("../server/ia-locale.ts");
    expect(choisirModele(["llama3.2:3b", "qwen2.5:7b-instruct", "gemma2"])).toBe("qwen2.5:7b-instruct");
    expect(choisirModele(["mistral:latest", "gemma2"])).toBe("mistral:latest");
    expect(choisirModele(["phi3"])).toBe("phi3");
    expect(choisirModele([])).toBeNull();
  });
});
