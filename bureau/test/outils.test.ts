import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { creerJeton, lireJeton } from "../server/jeton.ts";
import { createBureauServer, type AssistantApi } from "../server/http.ts";
import { MissionManager } from "../server/mission.ts";
import { DEFAULT_CONFIG } from "../server/config.ts";
import { decrireEtat, decrireHistorique } from "../server/max/descriptions.ts";
import { ecrireConfigMcp } from "../server/max/mcp-config.ts";
import { lireCarnet } from "../server/max/carnet.ts";
import type { AssistantVue, MissionVue, ServerMessage } from "../shared/protocol.ts";

const FAKE = path.join(__dirname, "fake-claude.mjs");
const RACINE = path.resolve(__dirname, "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-outils-"));
const envAvant = { ...process.env };

class FauxAssistant extends EventEmitter implements AssistantApi {
  appels: string[] = [];
  vue(): AssistantVue {
    return { etat: "ecoute", phrase: "", messages: [], oreille: { ok: true }, bouche: { ok: true }, cerveau: { ok: true } };
  }
  reveiller() {
    this.appels.push("reveiller");
  }
  veille() {
    this.appels.push("veille");
  }
  veilleApresParole() {
    this.appels.push("veilleApresParole");
  }
  taire() {
    this.appels.push("taire");
  }
  ecrire(texte: string) {
    this.appels.push(`ecrire:${texte}`);
  }
}

describe("jeton", () => {
  it("crée un jeton aléatoire lisible par l'utilisateur seul", () => {
    const dir = path.join(tmp(), "donnees");
    const j = creerJeton(dir);
    expect(j).toMatch(/^[0-9a-f]{64}$/);
    expect(lireJeton(dir)).toBe(j);
    expect(fs.statSync(path.join(dir, "jeton")).mode & 0o777).toBe(0o600);
    expect(creerJeton(dir)).not.toBe(j);
  });
  it("renvoie null sans jeton", () => {
    expect(lireJeton(tmp())).toBeNull();
  });
});

const mission = (o: Partial<MissionVue> = {}): MissionVue => ({
  nom: "2026-10-26 10h00 - x",
  texte: "Compare les mutuelles",
  titre: "Comparatif mutuelles",
  phase: "travail",
  etape: 0,
  totalEtapes: 2,
  debut: "2026-10-26T10:00:00.000Z",
  max: { bulle: "", actions: [] },
  robots: [
    { id: "chercheur-1", role: "chercheur", nom: "Chercheur", tache: "Prix MAIF", etape: 0, statut: "travail", bulle: "Je lis maif.fr…", actions: [] },
    { id: "analyste-1", role: "analyste", nom: "Analyste", tache: "Tableau", etape: 1, statut: "attente", bulle: "", actions: [] },
  ],
  ...o,
});

describe("descriptions pour Max", () => {
  it("décrit l'absence de mission", () => {
    expect(decrireEtat(null)).toBe("Aucune mission en cours.");
  });
  it("décrit une mission en cours, robot par robot", () => {
    const d = decrireEtat(mission());
    expect(d).toContain("Mission « Comparatif mutuelles » : l'équipe travaille (étape 1 sur 2)");
    expect(d).toContain("Chercheur (Prix MAIF) : travaille — Je lis maif.fr…");
    expect(d).toContain("Analyste (Tableau) : attend son tour");
  });
  it("indique qu'un résultat est disponible et les erreurs", () => {
    expect(decrireEtat(mission({ phase: "termine", resultat: "# R" }))).toContain("Le résultat est prêt");
    expect(decrireEtat(mission({ phase: "echec", erreur: "Max n'a pas réussi à planifier" }))).toContain("Erreur : Max n'a pas réussi à planifier");
  });
  it("résume l'historique", () => {
    expect(decrireHistorique([])).toBe("Aucune mission pour l'instant.");
    expect(decrireHistorique([{ nom: "n1", titre: "T1", statut: "terminee", debut: "2026-10-25T10:00:00.000Z" }])).toBe("- 2026-10-25 · T1 (terminée) · nom : n1");
  });
});

describe("configuration MCP de Max", () => {
  it("lance le serveur d'outils avec tsx et lui donne l'adresse du Bureau et le fichier du jeton", () => {
    const dir = tmp();
    const fichier = ecrireConfigMcp({ racine: RACINE, port: 4747, dossierDonnees: dir });
    const c = JSON.parse(fs.readFileSync(fichier, "utf8"));
    expect(c.mcpServers.bureau.command).toBe(path.join(RACINE, "node_modules", ".bin", "tsx"));
    expect(c.mcpServers.bureau.args).toEqual([path.join(RACINE, "server", "max", "outils-mcp.ts")]);
    expect(c.mcpServers.bureau.env).toEqual({ BUREAU_URL: "http://127.0.0.1:4747", BUREAU_JETON_FICHIER: path.join(dir, "jeton") });
    expect(fs.statSync(fichier).mode & 0o777).toBe(0o600);
  });
});

describe("routes et WebSocket de Max", () => {
  let root: string;
  let donnees: string;
  let jeton: string;
  let assistant: FauxAssistant;
  let manager: MissionManager;
  let server: ReturnType<typeof createBureauServer>;
  let base: string;

  beforeEach(async () => {
    root = tmp();
    donnees = tmp();
    jeton = creerJeton(donnees);
    process.env.FAKE_DELAY = "5";
    const config = { ...DEFAULT_CONFIG, dossierMissions: root, dossierDonnees: donnees };
    assistant = new FauxAssistant();
    manager = new MissionManager(config, FAKE);
    server = createBureauServer({ config, manager, webDir: tmp(), jeton, assistant });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    process.env = { ...envAvant };
    await manager.attendreFin();
    await new Promise((r) => server.close(r));
  });

  const avecJeton = (j = jeton) => ({ "x-bureau-jeton": j, "content-type": "application/json" });

  it("répond à /api/sante sans jeton (pour le script Siri)", async () => {
    expect(await (await fetch(base + "/api/sante")).json()).toEqual({ bureau: true });
  });

  it("refuse les outils sans jeton ou avec un mauvais jeton", async () => {
    expect((await fetch(base + "/api/outils/etat")).status).toBe(403);
    expect((await fetch(base + "/api/outils/etat", { headers: avecJeton("0".repeat(64)) })).status).toBe(403);
    expect((await fetch(base + "/api/outils/lancer", { method: "POST", body: JSON.stringify({ texte: "x" }) })).status).toBe(403);
    expect((await fetch(base + "/api/reveil", { method: "POST" })).status).toBe(403);
    expect(manager.snapshot().mission).toBeNull();
  });

  it("réveille Max avec le jeton", async () => {
    const r = await fetch(base + "/api/reveil", { method: "POST", headers: avecJeton() });
    expect(r.status).toBe(200);
    expect(assistant.appels).toEqual(["reveiller"]);
  });

  it("envoie l'état de Max avec celui du Bureau, et transmet les messages pour Max", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    for (const m of [{ type: "parler-max", texte: "Salut Max" }, { type: "reveil" }, { type: "veille" }, { type: "taire" }]) ws.send(JSON.stringify(m));
    for (let i = 0; i < 100 && assistant.appels.length < 4; i++) await new Promise((r) => setTimeout(r, 10));
    expect(assistant.appels).toEqual(["ecrire:Salut Max", "reveiller", "veille", "taire"]);
    const premier = messages[0];
    expect(premier.type === "etat" && premier.etat.assistant?.etat).toBe("ecoute");
    assistant.emit("etat");
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.filter((m) => m.type === "etat").length).toBeGreaterThanOrEqual(2);
    ws.close();
  });

  it("Max pilote le Bureau avec ses outils MCP (vrai client MCP)", async () => {
    const transport = new StdioClientTransport({
      command: path.join(RACINE, "node_modules", ".bin", "tsx"),
      args: [path.join(RACINE, "server", "max", "outils-mcp.ts")],
      env: { ...(process.env as Record<string, string>), BUREAU_URL: base, BUREAU_JETON_FICHIER: path.join(donnees, "jeton") },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const texte = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
      return { texte: r.content.map((c) => c.text).join("\n"), erreur: !!r.isError };
    };
    try {
      const outils = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(outils).toEqual(
        ["arreter_mission", "etat_bureau", "historique_missions", "lancer_mission", "lire_resultat", "memoriser", "mettre_en_veille", "oublier", "reprendre_mission"].sort(),
      );
      expect((await texte("etat_bureau")).texte).toBe("Aucune mission en cours.");
      expect((await texte("memoriser", { note: "Projet Cynox Fitness : app de fitness" })).texte).toContain("Noté");
      expect(lireCarnet(root)).toHaveLength(1);
      expect((await texte("oublier", { texte: "cynox" })).texte).toContain("1 note");
      expect(lireCarnet(root)).toEqual([]);

      expect((await texte("lancer_mission", { texte: "Compare deux mutuelles" })).texte).toContain("Mission lancée");
      expect((await texte("lancer_mission", { texte: "Une autre" })).erreur).toBe(true);
      await manager.attendreFin();
      expect((await texte("etat_bureau")).texte).toContain("Le résultat est prêt");
      expect((await texte("lire_resultat")).texte).toContain("Synthèse de test");
      expect((await texte("historique_missions")).texte).toContain("Mission test");
      expect((await texte("reprendre_mission")).erreur).toBe(true);
      expect((await texte("mettre_en_veille")).texte).toContain("veille");
      expect(assistant.appels).toContain("veilleApresParole");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("les outils MCP sont refusés sans le bon jeton", async () => {
    const mauvais = path.join(tmp(), "jeton");
    fs.writeFileSync(mauvais, "0".repeat(64));
    const transport = new StdioClientTransport({
      command: path.join(RACINE, "node_modules", ".bin", "tsx"),
      args: [path.join(RACINE, "server", "max", "outils-mcp.ts")],
      env: { ...(process.env as Record<string, string>), BUREAU_URL: base, BUREAU_JETON_FICHIER: mauvais },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const r = (await client.callTool({ name: "lancer_mission", arguments: { texte: "x" } })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("Accès refusé");
      expect(manager.snapshot().mission).toBeNull();
    } finally {
      await client.close();
    }
  }, 30_000);
});
