import { describe, it, expect } from "vitest";
import { ABSENCE_MS, revient, versRegard } from "../web/regard.ts";
import { PARTITIONS } from "../web/sons.ts";
import { etiquettesAnneaux } from "../web/jarvis.ts";
import type { EtatBureau } from "../shared/protocol.ts";

describe("Max te regarde", () => {
  it("tourne la tête vers toi, en miroir de l'image de la caméra", () => {
    // tu es à gauche de l'image brute = à droite de l'écran (vu par toi) : il regarde à droite
    expect(versRegard(0.2, 0.45).x).toBeCloseTo(0.6);
    expect(versRegard(0.5, 0.45)).toEqual({ x: 0, y: 0 });
    expect(versRegard(0.9, 0.2).x).toBeCloseTo(-0.8);
    expect(versRegard(0.5, 0.2).y).toBeLessThan(0);
    // jamais au-delà des bords
    expect(versRegard(-1, 5)).toEqual({ x: 1, y: 1 });
  });

  it("te salue la première fois qu'il te voit, et quand tu reviens après une absence", () => {
    expect(revient(0, 1000)).toBe(true);
    expect(revient(1000, 1000 + 5000)).toBe(false);
    expect(revient(1000, 1000 + ABSENCE_MS + 1)).toBe(true);
  });

  it("des sons courts et discrets", () => {
    for (const notes of Object.values(PARTITIONS)) {
      for (const [f0, f1, debut, duree, , v] of notes) {
        expect(f0).toBeGreaterThan(200);
        expect(f1).toBeGreaterThan(200);
        expect(debut + duree).toBeLessThanOrEqual(0.8);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("les anneaux de données : état, échéance, séance, études", () => {
    const e = {
      assistant: { etat: "ecoute", coach: { echeance: { nom: "Concours PASS", jours: 49 } } },
      sport: { prevue: "pec_dos", faite: null },
      poles: [{ id: "etudes", aujourdhui: 180, objectif: 360 }],
    } as unknown as EtatBureau;
    expect(etiquettesAnneaux(e)).toEqual(["SYS · À l'écoute", "Concours PASS · J-49", "Séance · Pec-Dos", "Études · 50 %"]);
    expect(etiquettesAnneaux({ assistant: { etat: "veille" } } as unknown as EtatBureau)).toEqual(["SYS · En veille"]);
  });
});
