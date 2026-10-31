import { describe, expect, it } from "vitest";
import { evenementsSysteme } from "../web/systeme-evenements.ts";
import { statsJoueur, titreJoueur } from "../web/systeme.ts";

const plan = (regles: [boolean, boolean, boolean], blocs = 3) => ({
  jour: 3, semaine: 1, blocs, reveil: "08:30", reveilDemain: "08:00", serie: 0, identite: "x",
  regles: [{ id: "lever" as const, texte: "a" }, { id: "bloc" as const, texte: "b" }, { id: "coucher" as const, texte: "c" }],
  aujourdhui: { lever: regles[0], bloc: regles[1], coucher: regles[2] },
});
const assistant = (total: number, aujourdhui: number, etat = "ecoute") => ({ etat, coach: { total, aujourdhui, serie: 0, minuteur: null, echeance: null } }) as never;
const mem = { niveau: 1, queteAttribuee: "2026-11-02", queteAccomplie: null, aujourdhui: "2026-11-02" };

describe("les événements du Système", () => {
  it("attribue la quête une fois par jour, annonce le niveau supérieur et la quête accomplie", () => {
    expect(evenementsSysteme({ assistant: assistant(0, 0), plan: plan([false, false, false]) }, { ...mem, queteAttribuee: "2026-11-01" })).toEqual(["attribution"]);
    expect(evenementsSysteme({ assistant: assistant(0, 0), plan: plan([false, false, false]) }, mem)).toEqual([]);
    expect(evenementsSysteme({ assistant: assistant(70, 0), plan: plan([false, false, false]) }, mem)).toEqual(["niveau"]);
    expect(evenementsSysteme({ assistant: assistant(0, 150), plan: plan([true, true, true]) }, mem)).toEqual(["accomplie"]);
    expect(evenementsSysteme({ assistant: assistant(0, 100), plan: plan([true, true, true]) }, mem)).toEqual([]);
    expect(evenementsSysteme({ assistant: assistant(0, 150), plan: plan([true, true, true]) }, { ...mem, queteAccomplie: "2026-11-02" })).toEqual([]);
    expect(evenementsSysteme({ assistant: assistant(999, 0, "veille"), plan: plan([true, true, true]) }, mem)).toEqual([]);
  });

  it("calcule les stats et le titre du Joueur à partir de ses vraies données", () => {
    const s = statsJoueur({ sport: { seances30: 9 } as never, poles: [{ id: "etudes", semaine: 600 } as never], plan: { serie: 4 } as never, assistant: { coach: { serie: 2 } } as never });
    expect(s).toEqual({ FOR: 9, INT: 10, VIT: 4, PER: 2 });
    expect(titreJoueur(s)).toBe("L'Éveillé");
    expect(titreJoueur({ FOR: 0, INT: 0, VIT: 0, PER: 0 })).toBe("Nouveau Joueur");
    expect(titreJoueur({ FOR: 0, INT: 0, VIT: 8, PER: 0 })).toBe("Celui qui tient parole");
  });
});
