import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bouche, lireVoixSay } from "../server/voix/bouche.ts";
import { Piper } from "../server/voix/piper.ts";

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

describe("Bouche avec la voix Piper", () => {
  const FAKE_PIPER = path.join(__dirname, "fake-piper.mjs");
  const FAKE_LECTEUR = path.join(__dirname, "fake-lecteur.mjs");
  let dossier: string;
  let lus: string;
  beforeEach(() => {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-piper-"));
    lus = path.join(dossier, "lus.txt");
    process.env.FAKE_LECTEUR_LOG = lus;
  });
  const avecPiper = () =>
    new Bouche({
      bin: FAKE_SAY,
      voix: null,
      debit: 175,
      piper: {
        moteur: new Piper({ python: "python3", modele: "m.onnx", vitesse: 1, commande: { bin: FAKE_PIPER, args: [] } }),
        lecteur: FAKE_LECTEUR,
        dossier: path.join(dossier, "wav"),
        nom: "fr_FR-tom-medium",
      },
    });
  const lignesLues = () => (fs.existsSync(lus) ? fs.readFileSync(lus, "utf8").trim().split("\n") : []);

  it("prépare chaque phrase avec Piper et la fait jouer, dans l'ordre, puis efface les fichiers", async () => {
    const b = avecPiper();
    expect(await b.preparer()).toEqual({ ok: true, detail: "Voix : fr_FR-tom-medium (Piper)" });
    const evts = suivre(b);
    b.dire("Bonjour.");
    b.dire("Je t'écoute.");
    expect(b.parle).toBe(true);
    for (let i = 0; i < 100 && evts.at(-1) !== "fin"; i++) await attendre(20);
    expect(evts).toEqual(["debut", "phrase:Bonjour.", "phrase:Je t'écoute.", "fin"]);
    expect(lignesLues()).toEqual(["WAV:Bonjour.", "WAV:Je t'écoute."]);
    expect(dits()).toEqual([]);
    await attendre(50);
    expect(fs.readdirSync(path.join(dossier, "wav"))).toEqual([]);
    b.arreter();
  });

  it("se tait tout de suite, même pendant qu'une phrase se prépare", async () => {
    const b = avecPiper();
    await b.preparer();
    const evts = suivre(b);
    b.dire("Une très longue phrase.");
    b.dire("Une autre.");
    b.taire();
    expect(b.parle).toBe(false);
    await attendre(200);
    expect(evts).toEqual(["debut", "phrase:Une très longue phrase.", "fin"]);
    expect(lignesLues()).toEqual([]);
    b.arreter();
  });

  it("passe une phrase que Piper n'arrive pas à dire, sans se bloquer", async () => {
    process.env.FAKE_PIPER_MODE = "rate";
    const b = avecPiper();
    await b.preparer();
    const evts = suivre(b);
    b.dire("Phrase ratée.");
    for (let i = 0; i < 100 && evts.at(-1) !== "fin"; i++) await attendre(20);
    expect(evts).toEqual(["debut", "phrase:Phrase ratée.", "fin"]);
    b.arreter();
  });

  it("démarre tout de suite avec say et prévient quand la voix lourde est prête", async () => {
    const b = avecPiper();
    let prete: { ok: boolean; detail?: string } | null = null;
    const d = await b.preparerEnArrierePlan((x) => (prete = x));
    expect(d.ok).toBe(true);
    expect(d.detail).toContain("en chargement");
    for (let i = 0; i < 100 && !prete; i++) await attendre(20);
    expect(prete).toEqual({ ok: true, detail: "Voix : fr_FR-tom-medium (Piper)" });
    b.arreter();
  });

  it("pendant le chargement, attend la vraie voix au lieu de parler avec celle du Mac", async () => {
    const b = avecPiper();
    let prete = false;
    await b.preparerEnArrierePlan(() => (prete = true));
    const evts = suivre(b);
    b.dire("Salut.");
    for (let i = 0; i < 150 && evts.at(-1) !== "fin"; i++) await attendre(20);
    expect(prete).toBe(true);
    expect(lignesLues()).toEqual(["WAV:Salut."]);
    expect(dits()).toEqual([]);
    b.arreter();
  });

  it("dit la phrase avec la voix du Mac si la vraie voix n'a pas pu démarrer", async () => {
    process.env.FAKE_PIPER_MODE = "plante";
    const b = avecPiper();
    await b.preparerEnArrierePlan(() => {});
    b.dire("Salut.");
    await attendre(400);
    expect(dits().at(-1)?.at(-1)).toBe("Salut.");
    b.arreter();
  });

  it("reprend la voix du Mac (say) si Piper ne démarre pas, et dit pourquoi", async () => {
    process.env.FAKE_PIPER_MODE = "plante";
    const b = avecPiper();
    const d = await b.preparer();
    expect(d.ok).toBe(true);
    expect(d.detail).toContain("Voix : Audrey (Premium)");
    expect(d.detail).toContain("No module named 'piper'");
    b.dire("Salut.");
    await attendre(300);
    expect(dits()).toEqual([["-v", "Audrey (Premium)", "-r", "175", "Salut."]]);
  });
});
