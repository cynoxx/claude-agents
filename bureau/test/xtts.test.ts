import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SCRIPT_XTTS, Xtts, cheminsXtts, xttsInstalle } from "../server/voix/xtts.ts";
import { enregistrerLocuteurXtts } from "../server/voix/choix-voix.ts";
import { loadConfig } from "../server/config.ts";
import { moteurVoix } from "../server/voix/voix-config.ts";

const python = (() => {
  try {
    execFileSync("python3", ["-c", "import numpy"]);
    return "python3";
  } catch {
    return null;
  }
})();
const envAvant = process.env.PYTHONPATH;
afterEach(() => {
  process.env.PYTHONPATH = envAvant;
});

describe.skipIf(!python)("la voix XTTS (avec un faux modèle)", () => {
  it("se met en route, dit chaque phrase dans un WAV, avec le locuteur demandé, et survit à une phrase ratée", async () => {
    process.env.PYTHONPATH = path.join(__dirname, "faux-tts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xtts-"));
    const x = new Xtts(dir, { locuteur: "Damien Black", vitesse: 1, appareil: "cpu" }, { bin: python!, args: [SCRIPT_XTTS, "Damien Black", "1", "cpu", "accord"] });
    await x.demarrer(30_000);
    const f = path.join(dir, "a.wav");
    await x.synthetiser("Bonjour, ici Max.", f);
    const wav = fs.readFileSync(f);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(44 + 2400 * 2);
    await expect(x.synthetiser("PLANTE", path.join(dir, "b.wav"))).rejects.toThrow("phrase impossible");
    await x.synthetiser("Encore là.", path.join(dir, "c.wav"), { locuteur: "Viktor Eka" });
    expect(fs.existsSync(path.join(dir, "c.wav"))).toBe(true);
    x.arreter();
  });

  it("prend une voix connue si celle de la config n'existe pas", async () => {
    process.env.PYTHONPATH = path.join(__dirname, "faux-tts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xtts-"));
    const x = new Xtts(dir, { locuteur: "Inconnu", vitesse: 1.2, appareil: "cpu" }, { bin: python!, args: [SCRIPT_XTTS, "Inconnu", "1.2", "cpu"] });
    await x.demarrer(30_000);
    await x.synthetiser("Salut.", path.join(dir, "a.wav"));
    expect(fs.readFileSync(path.join(dir, "a.wav")).length).toBe(44 + 2000 * 2);
    x.arreter();
  });
});

describe("XTTS dans la config", () => {
  it("n'est choisi que s'il est installé, licence acceptée et modèle téléchargé", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
    const donnees = path.join(dir, "donnees");
    fs.writeFileSync(path.join(dir, "bureau.config.json"), JSON.stringify({ dossierDonnees: donnees }));
    expect(moteurVoix(loadConfig(dir))).not.toBe("xtts");
    const c = cheminsXtts(donnees);
    fs.mkdirSync(path.dirname(c.python), { recursive: true });
    fs.writeFileSync(c.python, "");
    fs.writeFileSync(c.accord, "");
    expect(xttsInstalle(donnees)).toBe(false);
    fs.writeFileSync(c.pret, "");
    expect(moteurVoix(loadConfig(dir))).toBe("xtts");
    enregistrerLocuteurXtts(path.join(dir, "bureau.config.json"), "Viktor Eka");
    expect(loadConfig(dir).voix.xtts).toEqual({ locuteur: "Viktor Eka", vitesse: 1, appareil: "cpu" });
  });
});
