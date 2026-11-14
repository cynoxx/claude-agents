import { describe, it, expect } from "vitest";
import { MAILLAGE, versEcran } from "../web/scan-visage.ts";

describe("le scanner du visage", () => {
  it("le maillage relie les 68 points du visage, sans point inconnu ni trait en double", () => {
    const vus = new Set<number>();
    const traits = new Set<string>();
    for (const [a, b] of MAILLAGE) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(68);
      expect(a).not.toBe(b);
      const cle = [a, b].sort((x, y) => x - y).join("-");
      expect(traits.has(cle), cle).toBe(false);
      traits.add(cle);
      vus.add(a).add(b);
    }
    expect(vus.size).toBe(68);
  });

  it("place les points sur l'écran comme la vidéo : en miroir, et remplie (cover)", () => {
    // même proportions : le centre reste au centre, la gauche de l'image passe à droite
    expect(versEcran(0.5, 0.5, 640, 480, 1280, 960)).toEqual([640, 480]);
    expect(versEcran(0, 0, 640, 480, 1280, 960)).toEqual([1280, 0]);
    // écran plus large que la vidéo : l'image est agrandie et coupée en haut et en bas
    const [x, y] = versEcran(0.5, 0, 640, 480, 1600, 900);
    expect(x).toBe(800);
    expect(y).toBeLessThan(0);
  });
});
