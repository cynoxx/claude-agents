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
    expect(c.modeles).toEqual({ chef: "opus", robots: "sonnet" });
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
    expect(c.modeles).toEqual({ chef: "opus", robots: "haiku" });
    expect(c.projets).toEqual([{ nom: "Cynox", chemin: path.join(os.homedir(), "Code/cynox") }]);
    expect(c.limites).toEqual(DEFAULT_CONFIG.limites);
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
