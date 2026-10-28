import { describe, expect, it } from "vitest";
import { estCoupure, texteFinal } from "../web/ecoute-pur.ts";
import { OreillePage } from "../server/voix/oreille-page.ts";

describe("l'écoute de la page", () => {
  it("reconnaît les mots qui font taire Max", () => {
    for (const t of ["stop", "Max tais-toi", "chut", "attends deux secondes", "arrête"]) expect(estCoupure(t)).toBe(true);
    for (const t of ["je veux réviser", "c'est top", "Maxime"]) expect(estCoupure(t)).toBe(false);
  });

  it("recolle les morceaux sans doublon", () => {
    expect(texteFinal([" Max ", "quelle heure", "quelle heure", " est-il  "])).toBe("Max quelle heure est-il");
  });

  it("côté serveur, transmet les phrases quand elle est active, et ce qui coince une seule fois", () => {
    const o = new OreillePage();
    const recu: string[] = [];
    const erreurs: string[] = [];
    o.on("phrase", (t) => recu.push(t));
    o.on("erreur", (m) => erreurs.push(m));
    o.recevoir("avant");
    o.demarrer();
    o.recevoir("  Max   bonjour ");
    o.signaler("pas de micro");
    o.signaler("pas de micro");
    expect(recu).toEqual(["Max bonjour"]);
    expect(erreurs).toEqual(["pas de micro"]);
  });
});
