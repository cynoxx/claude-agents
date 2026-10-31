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

describe("couper la parole à Max", () => {
  it("reconnaît sa propre voix (ses phrases) et ne se coupe pas", async () => {
    const { tuLuiCoupesLaParole } = await import("../web/ecoute-pur.ts");
    const max = ["D'accord.", "Ta séance de biochimie commence à quatorze heures, pense à prendre tes fiches."];
    expect(tuLuiCoupesLaParole("ta séance de biochimie commence", max)).toBe(false);
    expect(tuLuiCoupesLaParole("pense à prendre tes fiches", max)).toBe(false);
    expect(tuLuiCoupesLaParole("biochimie", max)).toBe(false);
  });

  it("t'entend quand tu parles par-dessus, ou quand tu dis stop", async () => {
    const { tuLuiCoupesLaParole } = await import("../web/ecoute-pur.ts");
    const max = ["Ta séance de biochimie commence à quatorze heures."];
    expect(tuLuiCoupesLaParole("attends non plutôt la physiologie", max)).toBe(true);
    expect(tuLuiCoupesLaParole("mets-moi un minuteur de vingt minutes", max)).toBe(true);
    expect(tuLuiCoupesLaParole("stop", max)).toBe(true);
  });
});
