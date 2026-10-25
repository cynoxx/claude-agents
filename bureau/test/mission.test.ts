import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { MissionManager } from "../server/mission.ts";
import { DEFAULT_CONFIG, type BureauConfig } from "../server/config.ts";
import { readEtat } from "../server/storage.ts";

const FAKE = path.join(__dirname, "fake-claude.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-mission-"));
const envAvant = { ...process.env };
let root: string;
let log: string;

function config(extra: Partial<BureauConfig> = {}): BureauConfig {
  return { ...DEFAULT_CONFIG, dossierMissions: root, ...extra };
}
const appels = () =>
  fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; cwd: string }) : [];
const prompt = (a: { argv: string[] }) => a.argv[a.argv.indexOf("-p") + 1];

beforeEach(() => {
  root = tmp();
  log = path.join(tmp(), "log.jsonl");
  process.env.FAKE_LOG = log;
  process.env.FAKE_DELAY = "5";
});
afterEach(() => {
  process.env = { ...envAvant };
});

async function mission(texte = "Compare 2 mutuelles", cfg = config()) {
  const m = new MissionManager(cfg, FAKE);
  const r = m.lancer(texte);
  expect(r).toEqual({ ok: true });
  await m.attendreFin();
  return m;
}
const dossier = (m: MissionManager) => path.join(root, m.snapshot().mission!.nom);

describe("MissionManager", () => {
  it("déroule une mission complète : plan, deux étapes, relecture", async () => {
    const m = await mission();
    const v = m.snapshot().mission!;
    expect(v.phase).toBe("termine");
    expect(v.titre).toBe("Mission test");
    expect(v.robots.map((r) => [r.id, r.statut])).toEqual([
      ["chercheur-1", "fini"],
      ["redacteur-1", "fini"],
    ]);
    expect(v.robots[0].nom).toBe("Chercheur");
    expect(v.robots[0].actions.length).toBeGreaterThan(0);
    expect(v.resultat).toContain("Synthèse de test");
    expect(v.max.bulle).toBe("Mission terminée !");

    const d = dossier(m);
    for (const f of ["MISSION.md", "plan.json", "RESULTAT.md", "journal.jsonl", "equipe/chercheur-1/rapport.md", "equipe/redacteur-1/rapport.md"]) {
      expect(fs.existsSync(path.join(d, f)), f).toBe(true);
    }
    expect(readEtat(d)!.statut).toBe("terminee");
  });

  it("transmet le rapport de l'étape 1 au robot de l'étape 2, et les bons modèles", async () => {
    await mission();
    const a = appels();
    const redacteur = a.find((x) => prompt(x).includes("Écrire la synthèse"))!;
    expect(prompt(redacteur)).toContain(path.join("equipe", "chercheur-1", "rapport.md"));
    expect(redacteur.argv[redacteur.argv.indexOf("--model") + 1]).toBe("sonnet");
    const plan = a.find((x) => x.argv.includes("--json-schema"))!;
    expect(plan.argv[plan.argv.indexOf("--model") + 1]).toBe("opus");
    expect(redacteur.cwd.endsWith(path.join("equipe", "redacteur-1"))).toBe(true);
  });

  it("garde le texte de la mission intact (guillemets, retours à la ligne)", async () => {
    const texte = 'Écris "10 posts"\npour Lifforge — l\'été';
    const m = await mission(texte);
    expect(fs.readFileSync(path.join(dossier(m), "MISSION.md"), "utf8")).toContain(texte);
    expect(prompt(appels()[0])).toContain(texte);
  });

  it("refuse une deuxième mission pendant qu'une autre tourne", async () => {
    const m = new MissionManager(config(), FAKE);
    expect(m.lancer("une")).toEqual({ ok: true });
    expect(m.lancer("deux")).toEqual({ ok: false, erreur: "Une mission est déjà en cours." });
    await m.attendreFin();
  });

  it("refuse une mission vide ou quand claude est indisponible", () => {
    expect(new MissionManager(config(), FAKE).lancer("   ").ok).toBe(false);
    const m = new MissionManager(config(), FAKE, { ok: false, erreur: "pas connecté" });
    expect(m.lancer("x")).toEqual({ ok: false, erreur: "Claude Code n'est pas prêt : pas connecté" });
  });

  it("se met en pause quand le quota est atteint, puis reprend", async () => {
    process.env.FAKE_MODE = "quota";
    const m = await mission();
    expect(m.snapshot().mission!.phase).toBe("pause");
    expect(m.snapshot().mission!.robots[0].statut).toBe("quota");
    expect(readEtat(dossier(m))!.statut).toBe("en-pause");
    expect(m.lancer("autre").ok).toBe(false);

    expect(m.reprendre()).toEqual({ ok: true });
    await m.attendreFin();
    // en mode quota, le faux claude ne réussit qu'avec --resume : la reprise doit l'utiliser
    expect(m.snapshot().mission!.robots[0].statut).toBe("fini");
    expect(appels().some((a) => a.argv.includes("--resume"))).toBe(true);
  });

  it("reprendre sans pause est refusé", () => {
    expect(new MissionManager(config(), FAKE).reprendre().ok).toBe(false);
  });

  it("continue quand un robot plante et prévient Max", async () => {
    process.env.FAKE_MODE = "crash";
    const m = await mission();
    const v = m.snapshot().mission!;
    expect(v.robots.every((r) => r.statut === "erreur")).toBe(true);
    expect(v.robots[0].erreur).toContain("boom");
    expect(v.phase).toBe("termine");
    const relecture = appels().find((a) => prompt(a).includes("RELECTURE"))!;
    expect(prompt(relecture)).toContain("pas de rapport");
  });

  it("échoue après deux plans invalides", async () => {
    process.env.FAKE_MODE = "bad-plan";
    const m = await mission();
    expect(m.snapshot().mission!.phase).toBe("echec");
    expect(m.snapshot().mission!.erreur).toMatch(/planifier/);
    expect(appels().filter((a) => a.argv.includes("--json-schema"))).toHaveLength(2);
    expect(readEtat(dossier(m))!.statut).toBe("echouee");
  });

  it("s'arrête proprement quand on clique sur Arrêter", async () => {
    process.env.FAKE_MODE = "slow";
    const m = new MissionManager(config(), FAKE);
    m.lancer("lente");
    setTimeout(() => m.arreter(), 150);
    await m.attendreFin();
    expect(m.snapshot().mission!.phase).toBe("arrete");
    expect(readEtat(dossier(m))!.statut).toBe("arretee");
    expect(m.lancer("nouvelle").ok).toBe(true);
    m.arreter();
    await m.attendreFin();
  });

  it("fait travailler le codeur sur une branche Git et la note dans le résultat", async () => {
    const repo = tmp();
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    git("add", ".");
    git("commit", "-q", "-m", "init");
    process.env.FAKE_PROJET = "Demo";

    const m = await mission("Ajoute une fonctionnalité à Demo", config({ projets: [{ nom: "Demo", chemin: repo }] }));
    const v = m.snapshot().mission!;
    expect(v.branche).toBe("bureau/mission-test");
    expect(v.robots.find((r) => r.role === "codeur")!.statut).toBe("fini");
    expect(git("show", "--name-only", "--format=", "bureau/mission-test")).toContain("fake-change.txt");
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(v.resultat).toContain("bureau/mission-test");
  });

  it("émet un état à chaque changement", async () => {
    const m = new MissionManager(config(), FAKE);
    const phases = new Set<string>();
    m.on("etat", (e) => e.mission && phases.add(e.mission.phase));
    m.lancer("x");
    await m.attendreFin();
    expect([...phases]).toEqual(["planification", "travail", "relecture", "termine"]);
  });
});
