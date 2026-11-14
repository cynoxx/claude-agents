import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Visage, distance } from "../server/max/visage.ts";
import { Verrou } from "../server/max/verrou.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-visage-"));
/** Un descripteur de 128 nombres, décalé de `d` (distance euclidienne ≈ d·√128). */
const desc = (base: number, d = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(i * base) * 0.3 + d);
const moi = [desc(1), desc(1, 0.002), desc(1, -0.002), desc(1, 0.003), desc(1, -0.001)];

describe("distance", () => {
  it("est la distance euclidienne", () => {
    expect(distance([0, 0], [3, 4])).toBe(5);
    expect(distance(desc(1), desc(1))).toBe(0);
  });
});

describe("Visage — l'empreinte", () => {
  it("n'a rien au départ", () => {
    const v = new Visage(tmp());
    expect(v.enregistre).toBe(false);
    expect(v.comparer(desc(1))).toEqual({ ok: false, distance: Infinity });
  });

  it("enregistre l'empreinte dans un fichier lisible par l'utilisateur seul, sans photo", () => {
    const dir = tmp();
    const v = new Visage(dir);
    v.enregistrer(moi, "Johan");
    const fichier = path.join(dir, "visage.json");
    expect(fs.statSync(fichier).mode & 0o777).toBe(0o600);
    const contenu = JSON.parse(fs.readFileSync(fichier, "utf8"));
    expect(Object.keys(contenu).sort()).toEqual(["date", "descripteurs", "prenom"]);
    expect(contenu.descripteurs).toHaveLength(5);
    expect(new Visage(dir).prenom).toBe("Johan");
  });

  it("reconnaît le même visage et refuse un autre", () => {
    const v = new Visage(tmp());
    v.enregistrer(moi, "");
    expect(v.comparer(desc(1, 0.001)).ok).toBe(true);
    const autre = v.comparer(desc(7));
    expect(autre.ok).toBe(false);
    expect(autre.distance).toBeGreaterThan(0.5);
  });

  it("refuse une empreinte invalide", () => {
    const v = new Visage(tmp());
    expect(() => v.enregistrer([desc(1)], "x")).toThrow(/3/);
    expect(() => v.enregistrer([[1, 2, 3], desc(1), desc(1)], "x")).toThrow(/128/);
    expect(() => v.enregistrer([desc(1), desc(1), Array(128).fill(NaN)], "x")).toThrow(/128/);
    expect(v.comparer([1, 2])).toEqual({ ok: false, distance: Infinity });
  });

  it("s'efface", () => {
    const dir = tmp();
    const v = new Visage(dir);
    v.enregistrer(moi, "");
    v.effacer();
    expect(v.enregistre).toBe(false);
    expect(fs.existsSync(path.join(dir, "visage.json"))).toBe(false);
  });
});

describe("Verrou", () => {
  const creer = (o: { enregistre?: boolean; actif?: boolean } = {}) => {
    const visage = new Visage(tmp());
    if (o.enregistre !== false) visage.enregistrer(moi, "Johan");
    let t = 0;
    const verrou = new Verrou({ visage, actif: o.actif ?? true, horloge: () => t });
    return { verrou, visage, avancer: (ms: number) => (t += ms) };
  };

  it("est fermé au démarrage quand un visage est enregistré, ouvert sinon", () => {
    expect(creer().verrou.verrouille).toBe(true);
    expect(creer({ enregistre: false }).verrou.verrouille).toBe(false);
    expect(creer({ actif: false }).verrou.verrouille).toBe(false);
  });

  it("s'ouvre avec le bon visage qui bouge (pas une photo), et prévient", () => {
    const { verrou } = creer();
    const ouvertures: string[] = [];
    verrou.on("deverrouille", (prenom: string) => ouvertures.push(prenom));
    expect(verrou.tenter(desc(1, 0.001), false)).toMatchObject({ ok: false });
    expect(verrou.tenter(desc(7), true)).toMatchObject({ ok: false });
    expect(verrou.verrouille).toBe(true);
    expect(verrou.tenter(desc(1, 0.001), true)).toMatchObject({ ok: true });
    expect(verrou.verrouille).toBe(false);
    expect(ouvertures).toEqual(["Johan"]);
  });

  it("se referme à la demande (mise en veille de Max)", () => {
    const { verrou } = creer();
    verrou.tenter(desc(1), true);
    verrou.verrouiller();
    expect(verrou.verrouille).toBe(true);
  });

  it("fait patienter après trop d'essais ratés", () => {
    const { verrou, avancer } = creer();
    for (let i = 0; i < 10; i++) verrou.tenter(desc(7), true);
    const r = verrou.tenter(desc(1), true);
    expect(r.ok).toBe(false);
    expect(r.texte).toMatch(/attends/i);
    avancer(31_000);
    expect(verrou.tenter(desc(1), true).ok).toBe(true);
  });

  it("n'accepte un nouveau visage que s'il est ouvert, puis se ferme sur ce visage", () => {
    const { verrou } = creer();
    expect(verrou.enregistrer(moi, "Johan").ok).toBe(false);
    const libre = creer({ enregistre: false }).verrou;
    expect(libre.enregistrer(moi, "Johan")).toMatchObject({ ok: true });
    expect(libre.vue()).toMatchObject({ actif: true, enregistre: true, verrouille: false, prenom: "Johan" });
    libre.verrouiller();
    expect(libre.verrouille).toBe(true);
  });

  it("n'efface le visage que s'il est ouvert", () => {
    const { verrou } = creer();
    expect(verrou.effacer().ok).toBe(false);
    verrou.tenter(desc(1), true);
    expect(verrou.effacer().ok).toBe(true);
    expect(verrou.vue()).toMatchObject({ enregistre: false, verrouille: false });
  });

  it("note une demande de déverrouillage (Siri) pour que la page allume la caméra", () => {
    const { verrou, avancer } = creer();
    avancer(5000);
    verrou.demander();
    expect(verrou.vue().demande).toBe(5000);
  });
});
