import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lireCarnet, memoriser, oublier } from "../server/max/carnet.ts";
import { Phraseur } from "../server/voix/phraseur.ts";
import { consigneMax } from "../server/max/consigne.ts";
import { Cerveau, argsCerveau } from "../server/max/cerveau.ts";

const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-max-"));
const envAvant = { ...process.env };
afterEach(() => {
  process.env = { ...envAvant };
});

describe("carnet", () => {
  let dir: string;
  beforeEach(() => (dir = tmp()));

  it("est vide au début", () => {
    expect(lireCarnet(dir)).toEqual([]);
  });

  it("note des faits datés sur une ligne et les relit", () => {
    expect(memoriser(dir, "Projet Cynox Fitness :\napp de fitness", new Date(2026, 9, 26))).toBe("- [2026-10-26] Projet Cynox Fitness : app de fitness");
    memoriser(dir, "Préfère des réponses courtes", new Date(2026, 9, 26));
    expect(lireCarnet(dir)).toEqual(["- [2026-10-26] Projet Cynox Fitness : app de fitness", "- [2026-10-26] Préfère des réponses courtes"]);
    expect(fs.readFileSync(path.join(dir, "carnet.md"), "utf8")).toMatch(/^# Carnet de Max/);
  });

  it("refuse une note vide", () => {
    expect(() => memoriser(dir, "   ")).toThrow();
  });

  it("oublie les lignes qui contiennent un texte, sans tenir compte des accents ni des majuscules", () => {
    memoriser(dir, "Projet Cynox Fitness");
    memoriser(dir, "Aime le café");
    memoriser(dir, "Projet Lifforge");
    expect(oublier(dir, "cafe")).toBe(1);
    expect(oublier(dir, "PROJET")).toBe(2);
    expect(oublier(dir, "rien")).toBe(0);
    expect(lireCarnet(dir)).toEqual([]);
  });

  it("garde les 200 dernières notes seulement pour Max", () => {
    for (let i = 0; i < 205; i++) memoriser(dir, `note ${i}`);
    const notes = lireCarnet(dir);
    expect(notes).toHaveLength(200);
    expect(notes[0]).toContain("note 5");
  });
});

describe("Phraseur", () => {
  it("rend chaque phrase dès qu'elle est finie, même coupée en morceaux", () => {
    const p = new Phraseur();
    expect(p.ajouter("Bonjour Jo")).toEqual([]);
    expect(p.ajouter("han. Comment ")).toEqual(["Bonjour Johan."]);
    expect(p.ajouter("ça va ? Très")).toEqual(["Comment ça va ?"]);
    expect(p.ajouter(" bien")).toEqual([]);
    expect(p.finir()).toEqual(["Très bien"]);
    expect(p.finir()).toEqual([]);
  });

  it("ne coupe pas les nombres à virgule anglaise ni les points de suspension en plein mot", () => {
    const p = new Phraseur();
    expect(p.ajouter("Il fait 3.5 degrés... Brr ! ")).toEqual(["Il fait 3.5 degrés...", "Brr !"]);
  });

  it("coupe aussi aux retours à la ligne", () => {
    const p = new Phraseur();
    expect(p.ajouter("Voici :\n- un\n- deux")).toEqual(["Voici :", "- un"]);
    expect(p.finir()).toEqual(["- deux"]);
  });
});

describe("consigneMax", () => {
  it("donne à Max son rôle, son carnet et les missions récentes", () => {
    const c = consigneMax({
      carnet: ["- [2026-10-26] Projet Cynox Fitness : app de fitness"],
      missions: [{ nom: "m", titre: "Comparatif mutuelles", statut: "terminee", debut: "2026-10-25T10:00:00.000Z" }],
    });
    expect(c).toContain("Tu es Max");
    expect(c).toContain("lues à voix haute");
    expect(c).toContain("Projet Cynox Fitness");
    expect(c).toContain("Comparatif mutuelles");
    expect(c).toContain("lancer_mission");
    expect(c).toContain("[Bureau]");
  });

  it("dit quand le carnet et l'historique sont vides", () => {
    const c = consigneMax({ carnet: [], missions: [] });
    expect(c).toContain("(rien pour l'instant)");
    expect(c).toContain("(aucune mission pour l'instant)");
  });
});

describe("argsCerveau", () => {
  it("garde Max allumé en conversation, avec seulement ses outils et la recherche web", () => {
    const a = argsCerveau({ modele: "opus", consigne: "C", mcpConfig: "/m.json" });
    const v = (f: string) => a[a.indexOf(f) + 1];
    expect(a[0]).toBe("-p");
    expect(v("--input-format")).toBe("stream-json");
    expect(v("--output-format")).toBe("stream-json");
    expect(a).toContain("--include-partial-messages");
    expect(a).toContain("--verbose");
    expect(v("--model")).toBe("opus");
    expect(a).toContain("--strict-mcp-config");
    expect(v("--mcp-config")).toBe("/m.json");
    expect(v("--tools")).toBe("WebSearch,WebFetch");
    expect(v("--allowedTools")).toBe("WebSearch,WebFetch,mcp__bureau");
    expect(v("--append-system-prompt")).toBe("C");
  });
});

describe("Cerveau", () => {
  const cerveau = () => new Cerveau({ bin: FAKE_CLAUDE, modele: "opus", consigne: "C", mcpConfig: "/m.json", cwd: tmp() });
  function suivre(c: Cerveau) {
    const morceaux: string[] = [];
    const fins: { texte: string; ok: boolean; quota: boolean }[] = [];
    const outils: string[] = [];
    const arrets: { code: number | null; erreur?: string }[] = [];
    c.on("texte", (t: string) => morceaux.push(t));
    c.on("fin", (f) => fins.push(f));
    c.on("outil", (o: { nom: string }) => outils.push(o.nom));
    c.on("arret", (a) => arrets.push(a));
    return { morceaux, fins, outils, arrets };
  }
  const attendre = async (cond: () => boolean, ms = 5000) => {
    const fin = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > fin) throw new Error("délai dépassé");
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it("répond en streaming et garde la même session d'un message à l'autre", async () => {
    const log = path.join(tmp(), "log.jsonl");
    process.env.FAKE_LOG = log;
    process.env.FAKE_DELAY = "1";
    const c = cerveau();
    const s = suivre(c);
    c.demarrer();
    expect(c.envoyer("Bonjour")).toBe(true);
    await attendre(() => s.fins.length === 1);
    expect(s.morceaux.join("")).toBe("Bien reçu : Bonjour. Autre chose ?");
    expect(s.fins[0]).toEqual({ texte: "Bien reçu : Bonjour. Autre chose ?", ok: true, quota: false });
    c.envoyer("Et toi ?");
    await attendre(() => s.fins.length === 2);
    const lignes = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lignes.filter((l) => l.argv)).toHaveLength(1);
    expect(lignes.filter((l) => l.message).map((l) => l.message)).toEqual(["Bonjour", "Et toi ?"]);
    c.arreter();
  });

  it("signale les outils que Max utilise", async () => {
    process.env.FAKE_DELAY = "1";
    const c = cerveau();
    const s = suivre(c);
    c.demarrer();
    c.envoyer("utilise un outil");
    await attendre(() => s.fins.length === 1);
    expect(s.outils).toEqual(["mcp__bureau__etat_bureau"]);
    c.arreter();
  });

  it("signale le quota atteint", async () => {
    const c = cerveau();
    const s = suivre(c);
    c.demarrer();
    c.envoyer("quota");
    await attendre(() => s.fins.length === 1);
    expect(s.fins[0]).toMatchObject({ ok: false, quota: true });
    c.arreter();
  });

  it("prévient quand il meurt et refuse les messages ensuite", async () => {
    const c = cerveau();
    const s = suivre(c);
    c.demarrer();
    c.envoyer("plante");
    await attendre(() => s.arrets.length === 1);
    expect(s.arrets[0].erreur).toContain("erreur interne");
    expect(c.actif).toBe(false);
    expect(c.envoyer("encore ?")).toBe(false);
  });

  it("explique quand claude est introuvable", async () => {
    const c = new Cerveau({ bin: "/nexiste/pas/claude", modele: "opus", consigne: "C", mcpConfig: "/m.json", cwd: tmp() });
    const s = suivre(c);
    c.demarrer();
    await attendre(() => s.arrets.length === 1);
    expect(s.arrets[0].erreur).toMatch(/claude introuvable/);
  });

  it("s'arrête proprement à la demande", async () => {
    const c = cerveau();
    const s = suivre(c);
    c.demarrer();
    expect(c.actif).toBe(true);
    c.arreter();
    await attendre(() => s.arrets.length === 1);
    expect(c.actif).toBe(false);
    expect(s.arrets[0].erreur).toBeUndefined();
  });
});
