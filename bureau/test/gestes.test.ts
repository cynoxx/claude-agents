import { describe, it, expect } from "vitest";
import { actionPour, reconnaitrePose, SuiviGestes, TENUE_MS, type ContexteGestes } from "../web/gestes-pur.ts";
import type { Repere } from "../web/geste-main.ts";

/** Une main synthétique, poignet en bas : `doigts` = quels doigts sont levés (index, majeur, annulaire, auriculaire). */
function main(doigts: [boolean, boolean, boolean, boolean], x = 0.5): Repere[] {
  const p: Repere[] = Array.from({ length: 21 }, () => ({ x, y: 0.7 }));
  p[0] = { x, y: 0.8 };
  p[9] = { x, y: 0.6 };
  // [bout, articulation] par doigt : levé = le bout loin du poignet, replié = le bout revenu près de la paume
  const idx: [number, number][] = [[8, 6], [12, 10], [16, 14], [20, 18]];
  idx.forEach(([bout, art], k) => {
    const dx = (k - 1.5) * 0.03;
    p[art] = { x: x + dx, y: 0.55 };
    p[bout] = doigts[k] ? { x: x + dx, y: 0.3 } : { x: x + dx, y: 0.62 };
  });
  return p;
}
const T = (a: boolean, b: boolean, c: boolean, d: boolean) => main([a, b, c, d]);

describe("reconnaître la pose de la main", () => {
  it("compte les doigts levés", () => {
    expect(reconnaitrePose(T(false, false, false, false))).toBe("poing");
    expect(reconnaitrePose(T(true, false, false, false))).toBe("index");
    expect(reconnaitrePose(T(true, true, false, false))).toBe("deux");
    expect(reconnaitrePose(T(true, true, true, false))).toBe("trois");
    expect(reconnaitrePose(T(true, true, true, true))).toBe("paume");
    // une pose qui n'en est pas une : auriculaire seul
    expect(reconnaitrePose(T(false, false, false, true))).toBe("autre");
    expect(reconnaitrePose(null)).toBe("autre");
  });
});

describe("suivre les gestes dans le temps", () => {
  it("déclenche une pose tenue assez longtemps, une seule fois, puis attend", () => {
    const s = new SuiviGestes();
    let t = 1000;
    const gestes: (string | null)[] = [];
    for (; t < 1000 + TENUE_MS * 3; t += 90) gestes.push(s.suivre(T(true, true, false, false), t).geste);
    expect(gestes.filter(Boolean)).toEqual(["deux"]);
  });

  it("une pose trop brève ne compte pas, et la jauge se remplit", () => {
    const s = new SuiviGestes();
    expect(s.suivre(T(false, false, false, false), 0).progres).toBe(0);
    expect(s.suivre(T(false, false, false, false), 450).progres).toBeCloseTo(0.5, 1);
    expect(s.suivre(T(true, false, false, false), 500).progres).toBe(0); // la pose change : on recommence
    for (let t = 590; t < 900; t += 90) expect(s.suivre(T(true, false, false, false), t).geste).toBeNull();
  });

  it("un trou d'un cadre n'annule pas la pose tenue", () => {
    const s = new SuiviGestes();
    let geste: string | null = null;
    for (let t = 0; t < TENUE_MS + 400; t += 90) {
      const trou = t === 360;
      const r = s.suivre(trou ? null : T(true, false, false, false), t);
      geste = geste ?? r.geste;
    }
    expect(geste).toBe("index");
  });

  it("un balayage de la main ouverte, vers la droite puis vers la gauche (en miroir)", () => {
    const s = new SuiviGestes();
    const r: (string | null)[] = [];
    // la main passe de x = 0.8 à x = 0.4 dans l'image brute : vers la droite de l'utilisateur
    for (let k = 0; k < 8; k++) r.push(s.suivre(main([true, true, true, true], 0.8 - k * 0.06), k * 70).geste);
    expect(r.filter(Boolean)).toEqual(["balayage-droite"]);
    const s2 = new SuiviGestes();
    const r2: (string | null)[] = [];
    for (let k = 0; k < 8; k++) r2.push(s2.suivre(main([true, true, true, true], 0.4 + k * 0.06), k * 70).geste);
    expect(r2.filter(Boolean)).toEqual(["balayage-gauche"]);
  });

  it("une main ouverte qui bouge à peine ne balaie pas", () => {
    const s = new SuiviGestes();
    for (let k = 0; k < 8; k++) expect(s.suivre(main([true, true, true, true], 0.5 + k * 0.01), k * 70).geste).toBeNull();
  });
});

describe("ce que fait chaque geste", () => {
  const base: ContexteGestes = { veille: false, obscur: false, poles: ["etudes", "sante", "business"], pole: null, auBureau: false };
  it("balayage : fait le tour de l'accueil et des pôles", () => {
    expect(actionPour("balayage-droite", base)).toEqual({ type: "pole", pole: "etudes" });
    expect(actionPour("balayage-droite", { ...base, pole: "business" })).toEqual({ type: "pole", pole: null });
    expect(actionPour("balayage-gauche", base)).toEqual({ type: "pole", pole: "business" });
    expect(actionPour("balayage-gauche", { ...base, pole: "etudes" })).toEqual({ type: "pole", pole: null });
  });
  it("✌️ bascule le mode obscur, ☝️ retourne à l'accueil, 🤟 va au bureau et revient", () => {
    expect(actionPour("deux", base)).toEqual({ type: "obscur", actif: true });
    expect(actionPour("deux", { ...base, obscur: true })).toEqual({ type: "obscur", actif: false });
    expect(actionPour("index", { ...base, pole: "sante" })).toEqual({ type: "pole", pole: null });
    expect(actionPour("trois", base)).toEqual({ type: "vue", vue: "bureau" });
    expect(actionPour("trois", { ...base, auBureau: true })).toEqual({ type: "vue", vue: "jarvis" });
  });
  it("✋ tenue réveille Max seulement s'il dort ; ✊ le fait taire ; pas de balayage s'il dort", () => {
    expect(actionPour("paume", { ...base, veille: true })).toEqual({ type: "reveil" });
    expect(actionPour("paume", base)).toBeNull();
    expect(actionPour("poing", base)).toEqual({ type: "taire" });
    expect(actionPour("balayage-droite", { ...base, veille: true })).toBeNull();
  });
});
