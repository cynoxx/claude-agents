import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { preparerOreille } from "../server/voix/diagnostic.ts";
import { DEFAULT_CONFIG, type BureauConfig } from "../server/config.ts";

const FAKE_FFMPEG = path.join(__dirname, "fake-ffmpeg.mjs");

function config(voix: Partial<BureauConfig["voix"]>): BureauConfig {
  const modele = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bureau-diag-")), "modele.bin");
  fs.writeFileSync(modele, "x");
  return { ...DEFAULT_CONFIG, voix: { ...DEFAULT_CONFIG.voix, ffmpeg: FAKE_FFMPEG, whisper: process.execPath, modele, micro: ":1", ...voix } };
}

describe("preparerOreille", () => {
  it("prépare l'oreille quand tout est là", async () => {
    const r = await preparerOreille(config({}));
    expect(r.dispo).toEqual({ ok: true, detail: "Micro : :1" });
    expect(r.oreille).not.toBeNull();
  });

  it("respecte la voix désactivée dans la config", async () => {
    const r = await preparerOreille(config({ active: false }));
    expect(r.oreille).toBeNull();
    expect(r.dispo.detail).toContain("voix.active");
  });

  it("explique comment installer ffmpeg", async () => {
    const r = await preparerOreille(config({ ffmpeg: "/nexiste/pas/ffmpeg" }));
    expect(r.oreille).toBeNull();
    expect(r.dispo.detail).toContain("brew install ffmpeg");
  });

  it("explique comment installer whisper-cpp", async () => {
    const r = await preparerOreille(config({ whisper: "/nexiste/pas/whisper-cli" }));
    expect(r.dispo.detail).toContain("brew install whisper-cpp");
  });

  it("explique comment télécharger le modèle", async () => {
    const r = await preparerOreille(config({ modele: "/nexiste/pas/modele.bin" }));
    expect(r.dispo.detail).toContain("npm run modele");
  });
});
