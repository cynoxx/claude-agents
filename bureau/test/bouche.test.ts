import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bouche, lireVoixSay } from "../server/voix/bouche.ts";

const FAKE_SAY = path.join(__dirname, "fake-say.mjs");
const envAvant = { ...process.env };
let log: string;
beforeEach(() => {
  log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bureau-say-")), "say.jsonl");
  process.env.FAKE_SAY_LOG = log;
});
afterEach(() => {
  process.env = { ...envAvant };
});
const dits = (): string[][] => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bouche = (o: Partial<{ voix: string | null; debit: number }> = {}) => new Bouche({ bin: FAKE_SAY, voix: null, debit: 185, ...o });

function suivre(b: Bouche) {
  const evts: string[] = [];
  b.on("debut", () => evts.push("debut"));
  b.on("phrase", (t: string) => evts.push(`phrase:${t}`));
  b.on("fin", () => evts.push("fin"));
  return evts;
}

describe("lireVoixSay", () => {
  it("lit les noms (même avec espaces et parenthèses) et les langues", () => {
    const voix = lireVoixSay(
      "Thomas              fr_FR    # Bonjour\nAudrey (Premium)    fr_FR    # Bonjour\nEddy (Français (France)) fr_FR    # Bonjour\nBad News            en_US    # Hello\n\n",
    );
    expect(voix.map((v) => [v.name, v.lang])).toEqual([
      ["Thomas", "fr_FR"],
      ["Audrey (Premium)", "fr_FR"],
      ["Eddy (Français (France))", "fr_FR"],
      ["Bad News", "en_US"],
    ]);
  });
});

describe("Bouche", () => {
  it("choisit la meilleure voix française installée", async () => {
    const b = bouche();
    expect(await b.preparer()).toEqual({ ok: true, detail: "Voix : Audrey (Premium)" });
  });

  it("utilise la voix imposée dans la config", async () => {
    const b = bouche({ voix: "Thomas" });
    await b.preparer();
    b.dire("Salut.");
    await attendre(300);
    expect(dits()).toEqual([["-v", "Thomas", "-r", "185", "Salut."]]);
  });

  it("dit les phrases dans l'ordre, une à la fois", async () => {
    const b = bouche();
    await b.preparer();
    const evts = suivre(b);
    b.dire("Bonjour.");
    b.dire("Ça va ?");
    expect(b.parle).toBe(true);
    await attendre(400);
    expect(dits().map((a) => a.at(-1))).toEqual(["Bonjour.", "Ça va ?"]);
    expect(dits()[0].slice(0, 4)).toEqual(["-v", "Audrey (Premium)", "-r", "185"]);
    expect(evts).toEqual(["debut", "phrase:Bonjour.", "phrase:Ça va ?", "fin"]);
    expect(b.parle).toBe(false);
  });

  it("se tait tout de suite et oublie la suite", async () => {
    process.env.FAKE_SAY_MS = "500";
    const b = bouche();
    await b.preparer();
    const evts = suivre(b);
    b.dire("Une longue phrase.");
    b.dire("Une autre.");
    await attendre(100);
    b.taire();
    await attendre(700);
    expect(dits().map((a) => a.at(-1))).toEqual(["Une longue phrase."]);
    expect(evts.at(-1)).toBe("fin");
    expect(evts.filter((e) => e === "fin")).toHaveLength(1);
    expect(b.parle).toBe(false);
  });

  it("n'essaie pas de faire lire un tiret de début comme une option", async () => {
    const b = bouche({ voix: "Thomas" });
    await b.preparer();
    b.dire("- premier point");
    await attendre(300);
    expect(dits()[0].at(-1)).toBe("premier point");
  });

  it("ignore une phrase vide", async () => {
    const b = bouche();
    await b.preparer();
    const evts = suivre(b);
    b.dire("   ");
    await attendre(100);
    expect(evts).toEqual([]);
    expect(dits()).toEqual([]);
  });

  it("explique quand say n'existe pas (hors Mac) et ne plante pas", async () => {
    const b = new Bouche({ bin: "/nexiste/pas/say", voix: null, debit: 185 });
    expect(await b.preparer()).toEqual({ ok: false, detail: "Pas de voix : la commande say du Mac est introuvable. Les réponses de Max s'affichent à l'écran." });
    const evts = suivre(b);
    b.dire("Bonjour.");
    await attendre(50);
    expect(evts).toEqual([]);
  });
});
