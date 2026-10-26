import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import http from "node:http";
import WebSocket from "ws";
import { createBureauServer } from "../server/http.ts";
import { checkClaude } from "../server/claude-check.ts";
import { MissionManager } from "../server/mission.ts";
import { DEFAULT_CONFIG } from "../server/config.ts";
import { createMissionDir, writeEtat } from "../server/storage.ts";
import type { ServerMessage } from "../shared/protocol.ts";

const FAKE = path.join(__dirname, "fake-claude.mjs");
const envAvant = { ...process.env };
let root: string;
let webDir: string;
let server: ReturnType<typeof createBureauServer>;
let base: string;
let ouverts: string[];

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-http-"));
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-web-"));
  fs.writeFileSync(path.join(webDir, "index.html"), "<h1>Bureau</h1>");
  process.env.FAKE_DELAY = "5";
  const config = { ...DEFAULT_CONFIG, dossierMissions: root };
  ouverts = [];
  server = createBureauServer({ config, manager: new MissionManager(config, FAKE), webDir, ouvrir: (p) => ouverts.push(p) });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  process.env = { ...envAvant };
  await new Promise((r) => server.close(r));
});

function connecter(): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    ws.on("open", () => resolve({ ws, messages }));
  });
}
const attendre = async (cond: () => boolean, ms = 10_000) => {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error("délai dépassé");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("serveur HTTP", () => {
  it("une seule fenêtre de Max : la nouvelle page prévient les autres, pas elle-même", async () => {
    const a = await connecter();
    const b = await connecter();
    b.ws.send(JSON.stringify({ type: "fenetre", nee: 1234 }));
    await attendre(() => a.messages.some((m) => m.type === "fenetre"));
    expect(a.messages.find((m) => m.type === "fenetre")).toEqual({ type: "fenetre", nee: 1234 });
    await new Promise((r) => setTimeout(r, 50));
    expect(b.messages.some((m) => m.type === "fenetre")).toBe(false);
    a.ws.close();
    b.ws.close();
  });

  it("sert la page", async () => {
    const r = await fetch(base + "/");
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(await r.text()).toBe("<h1>Bureau</h1>");
  });

  it("liste les missions et lit un résultat", async () => {
    const d = createMissionDir(root, "x", new Date(2026, 9, 25, 9, 5));
    writeEtat(d, { statut: "terminee", titre: "X", texte: "x", debut: "2026-10-25T09:05:00.000Z" });
    fs.writeFileSync(path.join(d, "RESULTAT.md"), "# Super");
    const liste = await (await fetch(base + "/api/missions")).json();
    expect(liste).toEqual([{ nom: "2026-10-25 09h05 - x", titre: "X", statut: "terminee", debut: "2026-10-25T09:05:00.000Z" }]);
    const res = await fetch(`${base}/api/missions/${encodeURIComponent(liste[0].nom)}/resultat`);
    expect(await res.text()).toBe("# Super");
  });

  it("signale proprement un port déjà utilisé, sans planter", async () => {
    const config = { ...DEFAULT_CONFIG, dossierMissions: root };
    const second = createBureauServer({ config, manager: new MissionManager(config, FAKE), webDir });
    const port = (server.address() as AddressInfo).port;
    const err = await new Promise<NodeJS.ErrnoException>((resolve) => {
      second.on("error", resolve);
      second.listen(port, "127.0.0.1");
    });
    expect(err.code).toBe("EADDRINUSE");
    await new Promise((r) => setTimeout(r, 50));
  });

  it("refuse de sortir du dossier de mission", async () => {
    const d = createMissionDir(root, "x", new Date());
    writeEtat(d, { statut: "terminee", titre: "X", texte: "x", debut: new Date().toISOString() });
    const nom = encodeURIComponent(path.basename(d));
    expect((await fetch(`${base}/api/missions/${nom}/fichier?chemin=../../etc/passwd`)).status).toBe(400);
    expect((await fetch(`${base}/api/missions/..%2F..%2Fetc/resultat`)).status).toBe(400);
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
  });
});

describe("protection contre les autres sites", () => {
  it("refuse une requête dont l'hôte n'est pas localhost (DNS rebinding)", async () => {
    const port = (server.address() as AddressInfo).port;
    const status = await new Promise<number>((resolve) => {
      http.get({ host: "127.0.0.1", port, path: "/api/missions", headers: { host: "evil.example" } }, (r) => resolve(r.statusCode!));
    });
    expect(status).toBe(403);
  });

  it("refuse un WebSocket ouvert depuis un autre site", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws", { origin: "http://evil.example" });
    const code = await new Promise<number>((resolve) => {
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode!));
      ws.on("open", () => resolve(200));
    });
    expect(code).toBe(403);
  });

  it("accepte la page du Bureau elle-même", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws", { origin: base });
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve());
      ws.on("unexpected-response", () => reject(new Error("refusé")));
    });
    ws.close();
  });
});

describe("WebSocket", () => {
  it("envoie l'état à la connexion", async () => {
    const { ws, messages } = await connecter();
    await attendre(() => messages.length > 0);
    expect(messages[0]).toEqual({ type: "etat", etat: { claude: { ok: true }, mission: null } });
    ws.close();
  });

  it("lance une mission et diffuse son avancement jusqu'au résultat", async () => {
    const { ws, messages } = await connecter();
    ws.send(JSON.stringify({ type: "lancer", texte: "Mission par WebSocket" }));
    const phase = () => {
      const e = [...messages].reverse().find((m) => m.type === "etat");
      return e?.type === "etat" ? e.etat.mission?.phase : undefined;
    };
    await attendre(() => phase() === "termine");
    ws.send(JSON.stringify({ type: "ouvrir-dossier" }));
    await attendre(() => ouverts.length === 1);
    expect(ouverts[0].startsWith(root)).toBe(true);
    ws.close();
  });

  it("renvoie une erreur lisible pour un message invalide ou refusé", async () => {
    const { ws, messages } = await connecter();
    ws.send("pas du json");
    ws.send(JSON.stringify({ type: "reprendre" }));
    await attendre(() => messages.filter((m) => m.type === "erreur").length === 2);
    expect(messages.filter((m) => m.type === "erreur").map((m) => (m as any).message)).toEqual([
      "Message incompréhensible.",
      "Aucune mission en pause.",
    ]);
    ws.close();
  });
});

describe("checkClaude", () => {
  it("donne la version quand claude est connecté", async () => {
    expect(await checkClaude(FAKE)).toEqual({ ok: true, version: "9.9.9 (Claude Code)" });
  });
  it("explique quand claude n'est pas connecté", async () => {
    process.env.FAKE_AUTH = "out";
    const r = await checkClaude(FAKE);
    expect(r.ok).toBe(false);
    expect(r.erreur).toContain("claude auth login");
  });
  it("explique quand claude est introuvable", async () => {
    const r = await checkClaude("/nexiste/pas");
    expect(r.ok).toBe(false);
    expect(r.erreur).toMatch(/introuvable/);
  });
});
