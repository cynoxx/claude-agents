import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, expandHome, DEFAULT_CONFIG } from "../server/config.ts";

describe("loadConfig", () => {
  it("renvoie les valeurs par défaut sans fichier", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-cfg-"));
    const c = loadConfig(dir);
    expect(c.port).toBe(4747);
    expect(c.modeles).toEqual({ chef: "opus", robots: "sonnet", conversation: "opus" });
    expect(c.limites).toEqual({ robots: 5, etapes: 3, minutesParRobot: 20 });
    expect(c.dossierMissions).toBe(path.join(os.homedir(), "Documents", "Bureau"));
    expect(c.projets).toEqual([]);
  });

  it("fusionne un fichier partiel et développe ~", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-cfg-"));
    fs.writeFileSync(
      path.join(dir, "bureau.config.json"),
      JSON.stringify({ projets: [{ nom: "Cynox", chemin: "~/Code/cynox" }], modeles: { robots: "haiku" } }),
    );
    const c = loadConfig(dir);
    expect(c.modeles).toEqual({ chef: "opus", robots: "haiku", conversation: "opus" });
    expect(c.projets).toEqual([{ nom: "Cynox", chemin: path.join(os.homedir(), "Code/cynox") }]);
    expect(c.limites).toEqual(DEFAULT_CONFIG.limites);
  });

  it("donne des réglages de voix par défaut, avec le modèle Whisper dans le dossier de données", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-cfg-"));
    const c = loadConfig(dir);
    const donnees = path.join(os.homedir(), "Library", "Application Support", "Bureau");
    expect(c.dossierDonnees).toBe(donnees);
    expect(c.voix).toEqual({
      active: true,
      ffmpeg: "ffmpeg",
      whisper: "whisper-cli",
      say: "say",
      modele: path.join(donnees, "modeles", "ggml-large-v3-turbo-q5_0.bin"),
      micro: null,
      moteur: "auto",
      voixPiper: "fr_FR-tom-medium",
      vitessePiper: 1,
      voixMac: null,
      debit: 175,
      motCle: "max",
      phraseSiri: "Max au rapport",
      suiteSecondes: 10,
      veilleMinutes: 30,
    });
  });

  it("fusionne un bloc voix partiel et développe ~ dans les chemins", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-cfg-"));
    fs.writeFileSync(
      path.join(dir, "bureau.config.json"),
      JSON.stringify({ dossierDonnees: "~/donnees", voix: { micro: ":1", modele: "~/m.bin" }, modeles: { conversation: "sonnet" } }),
    );
    const c = loadConfig(dir);
    expect(c.dossierDonnees).toBe(path.join(os.homedir(), "donnees"));
    expect(c.voix.micro).toBe(":1");
    expect(c.voix.modele).toBe(path.join(os.homedir(), "m.bin"));
    expect(c.voix.debit).toBe(175);
    expect(c.modeles.conversation).toBe("sonnet");
  });

  it("a cinq conseillers par défaut, et complète ceux écrits à la main", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-cfg-"));
    expect(loadConfig(dir).conseillers.map((c) => c.id)).toEqual(["etudes", "sante", "business", "apps", "vie"]);
    fs.writeFileSync(
      path.join(dir, "bureau.config.json"),
      JSON.stringify({ conseillers: [{ id: "etudes", nom: "Docteur" }, { id: "musique", domaine: "Musique" }] }),
    );
    const [etudes, musique] = loadConfig(dir).conseillers;
    expect(etudes).toMatchObject({ id: "etudes", nom: "Docteur", domaine: "Études", emoji: "🩺" });
    expect(etudes.consigne).toContain("PASS");
    expect(musique).toMatchObject({ id: "musique", nom: "musique", domaine: "Musique", description: "Musique", emoji: "🤖", consigne: "" });
  });

  it("règle le pilotage du Mac (ville, musique, dossier des captures)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-cfg-"));
    expect(loadConfig(dir).mac).toEqual({ ville: null, musique: "auto", dossierCaptures: null });
    fs.writeFileSync(path.join(dir, "bureau.config.json"), JSON.stringify({ mac: { ville: "Lyon", dossierCaptures: "~/Captures" } }));
    expect(loadConfig(dir).mac).toEqual({ ville: "Lyon", musique: "auto", dossierCaptures: path.join(os.homedir(), "Captures") });
  });

  it("signale un JSON invalide avec un message clair", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-cfg-"));
    fs.writeFileSync(path.join(dir, "bureau.config.json"), "{ oups");
    expect(() => loadConfig(dir)).toThrow(/bureau\.config\.json/);
  });
});

describe("expandHome", () => {
  it("laisse les chemins absolus intacts", () => {
    expect(expandHome("/tmp/x")).toBe("/tmp/x");
    expect(expandHome("~")).toBe(os.homedir());
  });
});
