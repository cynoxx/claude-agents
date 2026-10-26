import { describe, it, expect } from "vitest";
import { GesteMain, type Repere } from "../web/geste-main.ts";
import { barres, duree, semaineSport, seanceSuivante, tuile } from "../web/poles-pur.ts";
import type { EtatBureau, SportVue, TempsPole } from "../shared/protocol.ts";

/** Une main simple : poignet en (x, y + 0.2), base du majeur en (x, y), pouce et index écartés de `ecart`. */
function main(x: number, y: number, ecart: number, taille = 0.2): Repere[] {
  const r: Repere[] = Array.from({ length: 21 }, () => ({ x, y }));
  r[0] = { x, y: y + taille };
  r[9] = { x, y };
  r[4] = { x: x - ecart / 2, y: y - 0.05 };
  r[8] = { x: x + ecart / 2, y: y - 0.05 };
  return r;
}

describe("geste de la main", () => {
  it("ne fait rien sans main, ou main ouverte", () => {
    const g = new GesteMain();
    expect(g.suivre(null)).toMatchObject({ etat: "aucune", dLacet: 0, position: null });
    const m = g.suivre(main(0.3, 0.5, 0.15));
    expect(m.etat).toBe("ouverte");
    expect(m.position?.x).toBeCloseTo(0.7); // en miroir
    expect(g.suivre(main(0.6, 0.5, 0.15)).dLacet).toBe(0);
  });

  it("pincer attrape le corps : bouger la main le tourne, l'approcher zoome", () => {
    const g = new GesteMain();
    expect(g.suivre(main(0.5, 0.5, 0.02)).etat).toBe("pince");
    // main vers ta droite = x qui diminue dans l'image de la caméra : le corps tourne vers la droite (lacet positif)
    const tourne = g.suivre(main(0.45, 0.5, 0.02));
    expect(tourne.etat).toBe("pince");
    expect(tourne.dLacet).toBeCloseTo(0.45);
    const zoom = g.suivre(main(0.45, 0.5, 0.02, 0.22));
    expect(zoom.zoom).toBeCloseTo(1.1);
    // un grand saut de taille est borné
    expect(g.suivre(main(0.45, 0.5, 0.02, 0.5)).zoom).toBe(1.15);
  });

  it("garde la pince un peu ouverte (hystérésis), puis la lâche", () => {
    const g = new GesteMain();
    g.suivre(main(0.5, 0.5, 0.05)); // 0.25 < 0.33 : pince
    expect(g.suivre(main(0.5, 0.5, 0.08)).etat).toBe("pince"); // 0.4 : toujours pincé
    expect(g.suivre(main(0.5, 0.5, 0.12)).etat).toBe("ouverte"); // 0.6 : lâché
    expect(g.suivre(main(0.5, 0.5, 0.08)).etat).toBe("ouverte"); // 0.4 : pas assez fermé pour reprendre
  });
});

const temps = (o: Partial<TempsPole>): TempsPole => ({ id: "x", aujourdhui: 0, semaine: 0, jours: [0, 0, 0, 0, 0, 0, 0], limite: null, objectif: null, notes: [], ...o });
const sport = (o: Partial<SportVue> = {}): SportVue => ({
  semaine: ["pec_dos", "bras_epaules", "jambes", "repos", "pec_dos", "bras_epaules", "repos"],
  jour: "2026-10-28",
  prevue: "jambes",
  faite: null,
  cetteSemaine: [
    { jour: "2026-10-26", prevue: "pec_dos", faite: "pec_dos" },
    { jour: "2026-10-27", prevue: "bras_epaules", faite: null },
    { jour: "2026-10-28", prevue: "jambes", faite: null },
    { jour: "2026-10-29", prevue: "repos", faite: null },
    { jour: "2026-10-30", prevue: "pec_dos", faite: null },
    { jour: "2026-10-31", prevue: "bras_epaules", faite: null },
    { jour: "2026-11-01", prevue: "repos", faite: null },
  ],
  muscles: [],
  seances30: 3,
  ...o,
});

describe("tuiles des pôles", () => {
  const base = { claude: { ok: true }, mission: null } as EtatBureau;

  it("affiche les durées simplement", () => {
    expect(duree(0)).toBe("0 min");
    expect(duree(45)).toBe("45 min");
    expect(duree(60)).toBe("1 h");
    expect(duree(192)).toBe("3 h 12");
  });

  it("études : progression vers l'objectif ; business : limite, qui s'allume une fois dépassée", () => {
    const e = { ...base, poles: [temps({ id: "etudes", aujourdhui: 135, objectif: 360 }), temps({ id: "business", aujourdhui: 75, limite: 60 })] };
    expect(tuile("etudes", e)).toEqual({ ligne: "2 h 15 / 6 h", jauge: 135 / 360, alerte: false });
    expect(tuile("business", e)).toMatchObject({ ligne: "1 h 15 / 1 h", alerte: true });
  });

  it("sport : la séance du jour, faite ou à faire (s'allume le soir), et le repos", () => {
    const soir = new Date("2026-10-28T20:00:00");
    expect(tuile("sante", { ...base, sport: sport() }, soir)).toEqual({ ligne: "🦵 Jambes · à faire", jauge: null, alerte: true });
    expect(tuile("sante", { ...base, sport: sport({ faite: "jambes" }) }, soir).ligne).toBe("🦵 Jambes ✅");
    expect(tuile("sante", { ...base, sport: sport({ prevue: "repos" }) }, soir)).toMatchObject({ ligne: "😴 Jour de repos", alerte: false });
  });

  it("vie : les mails à traiter ; apps : la quête en cours", () => {
    const mails = { heure: "", resume: "", categories: [{ id: "a_traiter" as const, nom: "", emoji: "", mails: [{ id: 1, de: "", sujet: "", lu: false }] }] };
    expect(tuile("vie", { ...base, mails })).toEqual({ ligne: "📬 1 mail à traiter", jauge: null, alerte: true });
    expect(tuile("apps", base).ligne).toBe("Aucune quête en cours");
  });

  it("dessine les 7 derniers jours par rapport à l'objectif", () => {
    const b = barres(temps({ jours: [0, 0, 0, 0, 0, 180, 360], objectif: 360 }), new Date("2026-10-28T12:00:00"));
    expect(b.map((x) => x.hauteur)).toEqual([0, 0, 0, 0, 0, 0.5, 1]);
    expect(b[6].jour).toBe("M"); // mercredi
  });
});

describe("semaine de sport", () => {
  it("distingue séance faite, manquée, aujourd'hui, repos et à venir", () => {
    expect(semaineSport(sport()).map((j) => j.etat)).toEqual(["faite", "manquee", "aujourdhui", "avenir", "avenir", "avenir", "avenir"]);
  });

  it("change la séance d'un jour dans l'ordre 1 → 2 → 3 → repos → 1", () => {
    expect(["pec_dos", "bras_epaules", "jambes", "repos"].map(seanceSuivante)).toEqual(["bras_epaules", "jambes", "repos", "pec_dos"]);
  });
});

describe("hologramme de Max", () => {
  it("dessine une tête en œuf, plus étroite au menton", async () => {
    const { pointTete } = await import("../web/humanoide.ts");
    const [, ySommet] = pointTete(0, 100, 100, 30, 40);
    const [, yMenton] = pointTete(Math.PI, 100, 100, 30, 40);
    expect(ySommet).toBe(60);
    expect(yMenton).toBeCloseTo(140);
    const [xHaut] = pointTete(Math.PI / 4, 100, 100, 30, 40);
    const [xBas] = pointTete((3 * Math.PI) / 4, 100, 100, 30, 40);
    expect(xHaut - 100).toBeGreaterThan(xBas - 100);
  });

  it("génère des crêtes de montagnes stables et bornées", async () => {
    const { crete } = await import("../web/montagnes.ts");
    const a = Array.from({ length: 50 }, (_, i) => crete(i / 50, 11));
    expect(a).toEqual(Array.from({ length: 50 }, (_, i) => crete(i / 50, 11)));
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1.2);
  });
});
