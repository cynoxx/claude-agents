import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Compagnon, consigneCompagnon, Souvenirs } from "../server/compagnon/compagnon.ts";
import { FiltrePensee } from "../server/max/cerveau-local.ts";

class FausseBouche extends EventEmitter {
  dites: string[] = [];
  parle = false;
  dire(p: string) {
    this.dites.push(p);
  }
  taire() {
    this.parle = false;
  }
}
class FauxCerveau extends EventEmitter {
  actif = false;
  recus: string[] = [];
  constructor(public consigne: string) {
    super();
  }
  demarrer() {
    this.actif = true;
  }
  envoyer(t: string) {
    this.recus.push(t);
    return true;
  }
  arreter() {
    this.actif = false;
  }
  repondre(t: string) {
    this.emit("texte", t);
    this.emit("fin", { texte: t, ok: true, quota: false });
  }
}

describe("la pensée à voix basse des modèles qui réfléchissent", () => {
  it("est retirée, même coupée entre deux morceaux", () => {
    const f = new FiltrePensee();
    expect(["<thi", "nk>je calcule", " encore</th", "ink>Salut", " toi <", "3"].map((m) => f.filtrer(m)).join("")).toBe("Salut toi <3");
    expect(new FiltrePensee().filtrer("Bonjour <b>")).toBe("Bonjour <b>");
  });
});

describe("le compagnon", () => {
  it("parle, se souvient, et repart à neuf après une conversation", async () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-compagnon-"));
    const bouche = new FausseBouche();
    const cerveaux: FauxCerveau[] = [];
    const souvenirs = new Souvenirs(path.join(dossier, "souvenirs.md"));
    const c = new Compagnon({
      nom: "Lumen",
      bouche,
      souvenirs,
      creerCerveau: (consigne) => {
        const x = new FauxCerveau(consigne);
        cerveaux.push(x);
        return x;
      },
      consigne: () => consigneCompagnon({ nom: "Lumen", souvenirs: souvenirs.lire(), profil: "", maintenant: new Date() }),
      resumer: async () => ["- Il a un partiel de biochimie vendredi", "- rien"],
      jour: () => "2026-10-29",
    });
    c.entendre("J'ai un partiel vendredi, je stresse");
    expect(c.vue().etat).toBe("reflechit");
    expect(cerveaux[0].recus).toEqual(["J'ai un partiel vendredi, je stresse"]);
    cerveaux[0].repondre("Je comprends. **Raconte-moi** ce qui te stresse le plus ?");
    expect(bouche.dites).toEqual(["Je comprends.", "Raconte-moi ce qui te stresse le plus ?"]);
    expect(c.vue().messages.map((m) => m.de)).toEqual(["toi", "lui"]);
    // pendant qu'il parle, ce qu'entend le micro est ignoré ; écrire le coupe
    bouche.parle = true;
    c.entendre("écho de sa voix");
    expect(cerveaux[0].recus).toHaveLength(1);
    await c.finirConversation();
    expect(fs.readFileSync(path.join(dossier, "souvenirs.md"), "utf8")).toContain("- [2026-10-29] Il a un partiel de biochimie vendredi");
    c.ecrire("Salut");
    expect(cerveaux).toHaveLength(2);
    expect(cerveaux[1].consigne).toContain("Il a un partiel de biochimie vendredi");
    c.pause(true);
    c.entendre("ignoré");
    expect(cerveaux[1].recus).toEqual(["Salut"]);
    expect(c.vue().etat).toBe("pause");
  });
});
