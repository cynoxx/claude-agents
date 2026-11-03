import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pourLaVoix } from "../server/voix/texte-voix.ts";
import { argsXtts, cheminsXtts } from "../server/voix/xtts.ts";

describe("pourLaVoix", () => {
  it("écrit les heures, pourcentages et fractions en mots", () => {
    expect(pourLaVoix("Réveil à 7h30, coucher 23 h")).toBe("Réveil à 7 heures 30, coucher 23 heures.");
    expect(pourLaVoix("Blocs 2/3, 87 % fait")).toBe("Blocs 2 sur 3, 87 pour cent fait.");
    expect(pourLaVoix("Partiel J-3")).toBe("Partiel J moins 3.");
  });
  it("retire émojis, symboles et markdown, garde une fin de phrase", () => {
    expect(pourLaVoix("🔥 **Bravo** ✓ → on continue")).toBe("Bravo, on continue.");
    expect(pourLaVoix("D'accord.")).toBe("D'accord.");
    expect(pourLaVoix("Le 14/12 c'est l'examen")).toBe("Le 14/12 c'est l'examen.");
  });
});

describe("argsXtts", () => {
  it("passe la voix de référence quand elle existe", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "xtts-"));
    const x = { locuteur: "Damien Black", vitesse: 1, appareil: "cpu" as const, reference: null };
    expect(argsXtts(d, x).some((a) => a.startsWith("ref="))).toBe(false);
    fs.mkdirSync(cheminsXtts(d).racine, { recursive: true });
    fs.writeFileSync(cheminsXtts(d).reference, "");
    expect(argsXtts(d, x).at(-1)).toBe(`ref=${cheminsXtts(d).reference}`);
  });
});
