import { describe, expect, it } from "vitest";
import { CLIC_MS, FiltreUnEuro, PointeurMain, ZONE } from "../web/pointeur-pur.ts";
import type { Repere } from "../web/geste-main.ts";

/** Une main : poignet et base du majeur fixent la taille (0,2) ; pouce et index autour de (cx, cy), écartés de `ecart`. */
function main(cx: number, cy: number, ecart: number): Repere[] {
  const m: Repere[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy + 0.15 }));
  m[0] = { x: cx, y: cy + 0.3 };
  m[9] = { x: cx, y: cy + 0.1 };
  m[4] = { x: cx - ecart / 2, y: cy };
  m[8] = { x: cx + ecart / 2, y: cy };
  return m;
}

describe("PointeurMain", () => {
  it("suit la main en miroir, la zone centrale couvrant tout l'écran", () => {
    const p = new PointeurMain();
    const e = p.suivre(main(ZONE.x0, ZONE.y0, 0.15), 0);
    expect(e.present).toBe(true);
    expect(e.x).toBeCloseTo(1, 5); // à gauche dans l'image de la caméra = à droite de l'écran (miroir)
    expect(e.y).toBeCloseTo(0, 5);
    expect(p.suivre(null, 33).present).toBe(false);
  });

  it("une pince courte est un clic", () => {
    const p = new PointeurMain();
    p.suivre(main(0.5, 0.4, 0.15), 0);
    expect(p.suivre(main(0.5, 0.4, 0.03), 40).pince).toBe(true);
    const e = p.suivre(main(0.5, 0.4, 0.15), 40 + CLIC_MS / 2);
    expect(e.clic).toBe(true);
    expect(e.pince).toBe(false);
  });

  it("une pince tenue trop longtemps n'est pas un clic", () => {
    const p = new PointeurMain();
    p.suivre(main(0.5, 0.4, 0.15), 0);
    p.suivre(main(0.5, 0.4, 0.03), 40);
    expect(p.suivre(main(0.5, 0.4, 0.15), 40 + CLIC_MS + 100).clic).toBe(false);
  });

  it("pincer et monter la main fait défiler, sans clic", () => {
    const p = new PointeurMain();
    let t = 0;
    p.suivre(main(0.5, 0.5, 0.15), t);
    p.suivre(main(0.5, 0.5, 0.03), (t += 33));
    let total = 0;
    for (let y = 0.5; y > 0.3; y -= 0.02) total += p.suivre(main(0.5, y, 0.03), (t += 33)).defile;
    expect(total).toBeGreaterThan(0.1);
    expect(p.suivre(main(0.5, 0.3, 0.15), (t += 33)).clic).toBe(false);
  });

  it("garde la pince entre les deux seuils (pas de clignotement)", () => {
    const p = new PointeurMain();
    p.suivre(main(0.5, 0.4, 0.03), 0);
    // écart 0,08 / taille 0,2 = 0,4 : entre le seuil de pince et celui de lâcher
    expect(p.suivre(main(0.5, 0.4, 0.08), 33).pince).toBe(true);
  });
});

describe("FiltreUnEuro", () => {
  it("lisse un tremblement immobile, suit un grand mouvement", () => {
    const f = new FiltreUnEuro();
    let t = 0;
    let v = 0;
    for (let i = 0; i < 30; i++) v = f.filtrer(0.5 + (i % 2 ? 0.01 : -0.01), (t += 33));
    expect(Math.abs(v - 0.5)).toBeLessThan(0.006);
    for (let i = 0; i < 10; i++) v = f.filtrer(0.9, (t += 33));
    expect(v).toBeGreaterThan(0.85);
  });
});
