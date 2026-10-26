import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Sport, indiceJour, lireSeances, musclesTravailles } from "../server/max/sport.ts";
import { SEMAINE_DEFAUT, trouverSeance } from "../shared/sport.ts";

const local = (j: string, h = "10:00") => new Date(`${j}T${h}:00`);

describe("séances", () => {
  it("reconnaît une séance par son nom, son numéro ou ce qu'on en dit", () => {
    expect(trouverSeance("pec dos")?.id).toBe("pec_dos");
    expect(trouverSeance("Pec-Dos")?.id).toBe("pec_dos");
    expect(trouverSeance("2")?.id).toBe("bras_epaules");
    expect(trouverSeance("séance 3")?.id).toBe("jambes");
    expect(trouverSeance("biceps triceps épaules")?.id).toBe("bras_epaules");
    expect(trouverSeance("jour de repos")?.id).toBe("repos");
    expect(trouverSeance("natation")).toBeUndefined();
  });

  it("numérote les jours du lundi (0) au dimanche (6)", () => {
    expect(indiceJour("2026-10-26")).toBe(0); // lundi
    expect(indiceJour("2026-11-01")).toBe(6); // dimanche
  });

  it("compte les muscles travaillés sur 14 jours, avec la dernière fois", () => {
    const m = musclesTravailles(
      [
        { jour: "2026-10-01", seance: "jambes" }, // hors des 14 jours
        { jour: "2026-10-20", seance: "pec_dos" },
        { jour: "2026-10-24", seance: "pec_dos" },
        { jour: "2026-10-25", seance: "repos" },
      ],
      "2026-10-26",
    );
    const de = (id: string) => m.find((x) => x.id === id)!;
    expect(de("pectoraux")).toEqual({ id: "pectoraux", fois: 2, derniere: "2026-10-24", intensite: 0.5 });
    expect(de("quadriceps").fois).toBe(0);
    expect(de("quadriceps").derniere).toBe("2026-10-01");
    expect(de("biceps")).toEqual({ id: "biceps", fois: 0, derniere: null, intensite: 0 });
  });
});

describe("Sport", () => {
  let dossier: string;
  let s: Sport;
  beforeEach(() => {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-sport-"));
    s = new Sport({ dossier });
  });

  it("a une semaine type par défaut, avec du repos, et la séance prévue du jour", () => {
    expect(s.semaine()).toEqual(SEMAINE_DEFAUT);
    expect(s.semaine()).toContain("repos");
    const v = s.vue(local("2026-10-28")); // mercredi
    expect(v.prevue).toBe("jambes");
    expect(v.faite).toBeNull();
    expect(v.cetteSemaine.map((j) => j.jour)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("change les jours fixes et les garde", () => {
    let etats = 0;
    s.on("etat", () => etats++);
    expect(s.changerSemaine([{ jour: "dimanche", seance: "jambes" }, { jour: 3, seance: "pec dos" }]).ok).toBe(true);
    expect(new Sport({ dossier }).semaine()).toEqual(["pec_dos", "bras_epaules", "jambes", "pec_dos", "pec_dos", "bras_epaules", "jambes"]);
    expect(s.changerSemaine([{ jour: "funday", seance: "jambes" }]).ok).toBe(false);
    expect(s.changerSemaine([{ jour: "lundi", seance: "yoga" }]).ok).toBe(false);
    expect(etats).toBe(1);
  });

  it("note une séance par jour (la dernière l'emporte) et refuse le futur", () => {
    const jour = s.vue().jour;
    expect(s.noter("jambes").ok).toBe(true);
    expect(s.noter("pec dos", { note: "  développé couché 60 kg " }).texte).toContain("Pectoraux");
    expect(lireSeances(dossier)).toEqual([{ jour, seance: "pec_dos", note: "développé couché 60 kg" }]);
    expect(s.vue().faite).toBe("pec_dos");
    expect(s.noter("jambes", { jour: "2999-01-01" }).ok).toBe(false);
    expect(s.noter("yoga").ok).toBe(false);
    expect(s.noter("repos", { jour: "2026-10-20" }).texte).toContain("Repos noté");
  });

  it("décrit le sport à Max : séance du jour, demain, muscles", () => {
    s.noter("bras épaules", { jour: s.vue().jour });
    const d = s.decrire();
    expect(d).toMatch(/séance du jour/);
    expect(d).toContain("Biceps ×1");
    expect(d).toContain("Semaine type : lundi Pec-Dos");
  });
});
