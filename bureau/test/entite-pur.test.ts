import { describe, expect, it } from "vitest";
import { REGLAGES, Ressort, YEUX, humeurDe, nuage, pointVisage, voixSimulee } from "../web/max3d/entite-pur.ts";

describe("les humeurs de Max", () => {
  it("suit ce qu'il fait, et passe à l'ambre le soir quand il est calme", () => {
    expect(humeurDe("veille", { heure: 10 })).toBe("veille");
    expect(humeurDe("veille", { heure: 21 })).toBe("soir");
    expect(humeurDe("veille", { heure: 3 })).toBe("soir");
    expect(humeurDe("veille", { heure: 6 })).toBe("veille");
    expect(humeurDe("ecoute", { heure: 23 })).toBe("ecoute");
    expect(humeurDe("reflechit")).toBe("reflexion");
    expect(humeurDe("parle")).toBe("parole");
  });

  it("l'alerte passe avant tout, puis la fête", () => {
    expect(humeurDe("parle", { alerte: true, fete: true })).toBe("alerte");
    expect(humeurDe("veille", { fete: true, heure: 22 })).toBe("fete");
  });

  it("montre son visage quand il écoute ou parle, presque pas au repos", () => {
    expect(REGLAGES.ecoute.visage).toBeGreaterThan(0.8);
    expect(REGLAGES.parole.visage).toBeGreaterThan(0.6);
    expect(REGLAGES.veille.visage).toBeLessThan(0.3);
    expect(REGLAGES.soir.lumiere).toBeLessThan(REGLAGES.veille.lumiere);
  });
});

describe("le ressort", () => {
  it("rejoint sa cible et s'y pose", () => {
    const r = new Ressort(0, 60, 1);
    for (let i = 0; i < 180; i++) r.avancer(1, 1 / 60);
    expect(r.valeur).toBeCloseTo(1, 3);
    expect(Math.abs(r.vitesse)).toBeLessThan(0.01);
  });

  it("dépasse un peu sa cible quand il est peu amorti, et reste stable sur une image très longue", () => {
    const r = new Ressort(0, 70, 0.4);
    let max = 0;
    for (let i = 0; i < 120; i++) max = Math.max(max, r.avancer(1, 1 / 60));
    expect(max).toBeGreaterThan(1.02);
    expect(max).toBeLessThan(1.6);
    const lent = new Ressort(0, 260, 0.9);
    for (let i = 0; i < 20; i++) lent.avancer(1, 0.5);
    expect(lent.valeur).toBeCloseTo(1, 2);
  });
});

describe("le visage dans la sphère", () => {
  it("est plus étroit à la mâchoire qu'aux pommettes, et le nez dépasse", () => {
    const n = (x: number, y: number, z: number) => {
      const l = Math.hypot(x, y, z);
      return pointVisage(x / l, y / l, z / l);
    };
    const joue = n(0.7, 0, 0.7);
    const machoire = n(0.7, -0.7, 0.3);
    expect(Math.abs(machoire[0])).toBeLessThan(Math.abs(joue[0]));
    const nez = n(0, -0.12, 1);
    const cote = n(0.25, -0.12, 1);
    expect(nez[2]).toBeGreaterThan(cote[2] + 0.05);
  });

  it("a deux orbites creusées, symétriques", () => {
    const n = (x: number, y: number) => {
      const z = Math.sqrt(1 - x * x - y * y);
      return pointVisage(x, y, z);
    };
    const [g, d] = YEUX.map(([x, y]) => n(x, y));
    expect(g[2]).toBeCloseTo(d[2], 6);
    expect(g[0]).toBeCloseTo(-d[0], 6);
    const front = n(0.3, 0.45);
    expect(g[2] / Math.sqrt(1 - 0.3 ** 2 - 0.2 ** 2)).toBeLessThan(front[2] / Math.sqrt(1 - 0.3 ** 2 - 0.45 ** 2));
  });

  it("fabrique un nuage complet : des nombres finis, des normales de longueur 1, des yeux et une mâchoire", () => {
    const nu = nuage(4000);
    expect(nu.sphere).toHaveLength(12000);
    expect(nu.info).toHaveLength(16000);
    for (const t of [nu.sphere, nu.visage, nu.normale, nu.info]) expect(t.every((v) => Number.isFinite(v))).toBe(true);
    let yeux = 0, machoire = 0;
    for (let i = 0; i < nu.n; i++) {
      expect(Math.hypot(nu.normale[i * 3], nu.normale[i * 3 + 1], nu.normale[i * 3 + 2])).toBeCloseTo(1, 4);
      if (nu.info[i * 4 + 2] > 0.5) yeux++;
      if (nu.info[i * 4 + 1] > 0.5) machoire++;
    }
    expect(yeux).toBeGreaterThan(3);
    expect(machoire).toBeGreaterThan(30);
  });

  it("range les points dans un ordre mélangé : le premier tiers couvre déjà le haut et le bas", () => {
    const nu = nuage(3000);
    let haut = 0, bas = 0;
    for (let i = 0; i < 1000; i++) (nu.sphere[i * 3 + 1] > 0 ? haut++ : bas++);
    expect(Math.abs(haut - bas)).toBeLessThan(120);
  });
});

describe("la voix simulée", () => {
  it("reste entre 0 et 1, avec des silences et des pics", () => {
    let min = 1, max = 0;
    for (let t = 0; t < 20; t += 0.02) {
      const v = voixSimulee(t);
      expect(v.bandes).toHaveLength(8);
      for (const b of [v.niveau, ...v.bandes]) {
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(1);
      }
      min = Math.min(min, v.niveau);
      max = Math.max(max, v.niveau);
    }
    expect(min).toBe(0);
    expect(max).toBeGreaterThan(0.6);
  });
});
