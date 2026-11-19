import { describe, expect, it } from "vitest";
import { bonjour } from "../server/max/bonjour.ts";

const samedi = (h: number) => new Date(2026, 10, 14, h, 5);

describe("le bonjour de Max à l'ouverture", () => {
  it("prend de ses nouvelles et pose la journée", () => {
    const t = bonjour({ maintenant: samedi(8), echeances: [] });
    expect(t).toMatch(/^Salut chef, comment tu vas \?/);
    expect(t).toContain("Aujourd'hui, on est samedi 14 novembre.");
    expect(t).toMatch(/On commence par quoi \?$/);
  });

  it("met l'examen proche en priorité", () => {
    const t = bonjour({
      maintenant: samedi(8),
      echeances: [
        { nom: "Partiel de maths (rattrapage)", date: "2026-11-16", jours: 2 },
        { nom: "Partiel d'électricité (rattrapage)", date: "2026-11-19", jours: 5 },
      ],
    });
    expect(t).toContain("Partiel de maths (rattrapage), dans 2 jours : c'est la priorité");
    expect(t).not.toContain("électricité");
  });

  it("le jour de l'examen, le dit sans dramatiser", () => {
    const t = bonjour({ maintenant: samedi(7), echeances: [{ nom: "Partiel de maths", date: "2026-11-14", jours: 0 }] });
    expect(t).toContain("C'est le jour J : Partiel de maths.");
  });

  it("rappelle une échéance ordinaire proche, pas une lointaine", () => {
    expect(bonjour({ maintenant: samedi(9), echeances: [{ nom: "Rendu du TP", date: "2026-11-15", jours: 1 }] })).toContain("Prochaine échéance : Rendu du TP, demain.");
    expect(bonjour({ maintenant: samedi(9), echeances: [{ nom: "Rendu du TP", date: "2026-12-30", jours: 46 }] })).not.toContain("Rendu");
  });

  it("dit le travail, la session en cours et la séance de sport", () => {
    expect(bonjour({ maintenant: samedi(15), echeances: [], travail: 80, sport: "Côté sport, aujourd'hui c'est Dos." })).toContain("Tu as déjà 1 h 20 de travail aujourd'hui. Côté sport, aujourd'hui c'est Dos.");
    expect(bonjour({ maintenant: samedi(15), echeances: [], session: "Maths" })).toMatch(/Ta session « Maths » tourne toujours\. Je t'écoute\.$/);
  });

  it("l'appelle par son prénom quand la caméra l'a reconnu", () => {
    expect(bonjour({ maintenant: samedi(8), echeances: [], nom: "Johan" })).toMatch(/^Salut Johan, comment tu vas \?/);
  });

  it("dit bonsoir le soir", () => {
    expect(bonjour({ maintenant: samedi(19), echeances: [] })).toMatch(/^Bonsoir chef/);
    expect(bonjour({ maintenant: samedi(23), echeances: [] })).toMatch(/^Salut chef\. Il est tard/);
  });
});
