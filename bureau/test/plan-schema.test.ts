import { describe, it, expect } from "vitest";
import { parsePlan, PlanInvalide, PLAN_JSON_SCHEMA } from "../server/plan-schema.ts";

const limites = { robots: 5, etapes: 3 };
const ok = {
  titre: "Comparatif mutuelles",
  slug: "Comparatif Mutuelles !",
  annonce: "Je prends deux chercheurs et une analyste.",
  projet: null,
  etapes: [
    { robots: [{ role: "chercheur", tache: "MAIF" }, { role: "chercheur", tache: "Alan" }] },
    { robots: [{ role: "analyste", tache: "Tableau" }] },
  ],
};

describe("parsePlan", () => {
  it("accepte un plan valide et nettoie le slug", () => {
    const p = parsePlan(ok, limites, []);
    expect(p.slug).toBe("comparatif-mutuelles");
    expect(p.etapes).toHaveLength(2);
  });

  it("refuse un rôle inconnu", () => {
    const bad = { ...ok, etapes: [{ robots: [{ role: "pirate", tache: "x" }] }] };
    expect(() => parsePlan(bad, limites, [])).toThrow(PlanInvalide);
  });

  it("refuse plus de 5 robots", () => {
    const robots = Array.from({ length: 6 }, () => ({ role: "redacteur", tache: "x" }));
    expect(() => parsePlan({ ...ok, etapes: [{ robots }] }, limites, [])).toThrow(/5 robots/);
  });

  it("refuse plus de 3 étapes", () => {
    const e = { robots: [{ role: "redacteur", tache: "x" }] };
    expect(() => parsePlan({ ...ok, etapes: [e, e, e, e] }, limites, [])).toThrow(/3 étapes/);
  });

  it("refuse une étape vide et un plan sans étape", () => {
    expect(() => parsePlan({ ...ok, etapes: [{ robots: [] }] }, limites, [])).toThrow(PlanInvalide);
    expect(() => parsePlan({ ...ok, etapes: [] }, limites, [])).toThrow(PlanInvalide);
  });

  it("garde un projet connu et oublie un projet inconnu", () => {
    expect(parsePlan({ ...ok, projet: "Cynox" }, limites, ["Cynox"]).projet).toBe("Cynox");
    expect(parsePlan({ ...ok, projet: "Inconnu" }, limites, ["Cynox"]).projet).toBeNull();
  });

  it("refuse autre chose qu'un objet", () => {
    expect(() => parsePlan("bonjour", limites, [])).toThrow(PlanInvalide);
  });
});

describe("PLAN_JSON_SCHEMA", () => {
  it("liste les cinq métiers", () => {
    const role = (PLAN_JSON_SCHEMA as any).properties.etapes.items.properties.robots.items.properties.role;
    expect(role.enum).toEqual(["chercheur", "codeur", "designer", "redacteur", "analyste"]);
  });
});
