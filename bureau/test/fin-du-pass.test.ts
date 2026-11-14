import { describe, expect, it } from "vitest";
import { sansMedecine, sansPass } from "../server/max/fin-du-pass.js";
import type { ProjetVie } from "../shared/protocol.js";

describe("la fin du PASS dans ce que Max a gardé", () => {
  it("remet le projet d'études de départ à aujourd'hui, sans toucher aux autres", () => {
    const projets = [
      { id: "reussir-l-examen-de-pass", domaine: "etudes", categorie: "PASS", nom: "Réussir l'examen de PASS", prochaineAction: "x", statut: "actif", maj: "2026-10-27" },
      { id: "asclepium", domaine: "business", categorie: "Vidéos", nom: "Asclepium — conseils PASS", statut: "actif", maj: "2026-10-27" },
    ] as ProjetVie[];
    const [etudes, business] = sansPass(projets);
    expect(etudes.nom).toBe("Réussir mon année");
    expect(etudes.categorie).toBe("Cours");
    expect(etudes.id).toBe("reussir-l-examen-de-pass");
    expect(business).toEqual(projets[1]);
  });

  it("remplace les blocs de médecine par des blocs d'études", () => {
    expect(sansMedecine("un bloc de médecine de 50 minutes, Blocs de médecine (3 visés)")).toBe("un bloc d'études de 50 minutes, Blocs d'études (3 visés)");
    expect(sansMedecine("48 lois pour réussir en médecine")).toBe("48 lois pour réussir en médecine");
  });
});
