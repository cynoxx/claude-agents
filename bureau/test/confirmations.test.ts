import { describe, it, expect } from "vitest";
import { Confirmations, estUnOui } from "../server/max/confirmations.ts";

describe("estUnOui", () => {
  it("reconnaît un oui, même au milieu d'une phrase", () => {
    for (const t of ["Oui", "oui vas-y", "Ouais envoie", "OK", "d'accord", "Vas-y", "c'est bon", "confirme", "go", "Yes", "Oui, envoie-le"]) {
      expect(estUnOui(t), t).toBe(true);
    }
  });
  it("refuse un non, une hésitation ou une autre demande", () => {
    for (const t of ["non", "Non attends", "oui mais non", "pas encore", "annule", "attends", "change le texte", "Ok non en fait", "Bonjour", "envoie plutôt à papa", "envoie un autre message"]) {
      expect(estUnOui(t), t).toBe(false);
    }
  });
});

describe("Confirmations", () => {
  const fait: string[] = [];
  const action = (nom: string) => async () => {
    fait.push(nom);
    return { ok: true, texte: `${nom} fait.` };
  };

  it("n'exécute rien sans un oui de l'utilisateur dit après la préparation", async () => {
    let t = 1000;
    const c = new Confirmations(() => t);
    const dernier = { texte: "Max, envoie à maman que je rentre", heure: 900 };
    c.preparer("message", "À Maman : « Je rentre »", action("envoi"));
    t = 1100;
    expect(await c.confirmer("message", dernier)).toMatchObject({ ok: false });
    expect(await c.confirmer("message", null)).toMatchObject({ ok: false });
    expect(await c.confirmer("message", { texte: "non", heure: 1050 })).toMatchObject({ ok: false });
    expect(fait).toEqual([]);
    const r = await c.confirmer("message", { texte: "oui vas-y", heure: 1050 });
    expect(r).toEqual({ ok: true, texte: "envoi fait." });
    expect(fait).toEqual(["envoi"]);
    expect(await c.confirmer("message", { texte: "oui", heure: 1060 })).toMatchObject({ ok: false });
  });

  it("garde un seul envoi en attente par type, et l'oublie après 5 minutes", async () => {
    let t = 0;
    const c = new Confirmations(() => t);
    c.preparer("rdv", "Dentiste", action("rdv1"));
    c.preparer("rdv", "Kiné", action("rdv2"));
    expect(c.enAttente("rdv")).toBe("Kiné");
    t = 6 * 60_000;
    expect(await c.confirmer("rdv", { texte: "oui", heure: 5 * 60_000 })).toMatchObject({ ok: false });
    expect(c.enAttente("rdv")).toBeNull();
  });

  it("pour un geste sans risque, accepte le oui dit juste avant la préparation (pas pour un message)", async () => {
    let t = 10_000;
    const c = new Confirmations(() => t);
    const ouiJusteAvant = { texte: "oui range les pubs", heure: 9_000 };
    c.preparer("rangement", "2 mails", action("rangement"), { ouiAvant: true });
    expect(await c.confirmer("rangement", ouiJusteAvant)).toEqual({ ok: true, texte: "rangement fait." });
    c.preparer("message", "à Maman", action("envoi-sans-oui"));
    expect(await c.confirmer("message", { texte: "oui lis mes mails", heure: 9_000 })).toMatchObject({ ok: false });
    t = 500_000;
    c.preparer("rangement", "2 mails", action("rangement-tardif"), { ouiAvant: true });
    expect(await c.confirmer("rangement", ouiJusteAvant)).toMatchObject({ ok: false });
  });

  it("annule ce qui attend", async () => {
    const c = new Confirmations(() => 0);
    c.preparer("message", "x", action("x"));
    expect(c.annuler()).toBe(1);
    expect(c.enAttente("message")).toBeNull();
  });
});
