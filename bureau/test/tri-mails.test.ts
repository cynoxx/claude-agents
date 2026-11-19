import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mac, lireMails, type Executer } from "../server/max/mac.ts";
import { TriMails } from "../server/max/tri-mails.ts";

const SORTIE =
  "101\tScolarité <scol@univ.fr>\tPlanning des partiels\tlundi 26 octobre 2026 à 09:12:00\tfalse\tBonjour, voici le planning…\n" +
  "102\tShein <promo@shein.com>\t-70 % ce week-end !\tlundi 26 octobre 2026 à 08:00:00\tfalse\tProfitez de nos offres\n" +
  "103\tMaman <maman@icloud.com>\tDimanche\tdimanche 25 octobre 2026 à 20:00:00\ttrue\tTu viens manger ?\n" +
  "pas un mail\n";

describe("lire les mails", () => {
  it("lit la sortie de Mail (une ligne par mail, avec son identifiant)", () => {
    const mails = lireMails(SORTIE);
    expect(mails).toHaveLength(3);
    expect(mails[0]).toEqual({ id: 101, de: "Scolarité <scol@univ.fr>", sujet: "Planning des partiels", date: "lundi 26 octobre 2026 à 09:12:00", lu: false, extrait: "Bonjour, voici le planning…" });
    expect(mails[2].lu).toBe(true);
  });

  it("liste les mails et range ceux demandés, nom du dossier et identifiants en arguments", async () => {
    const appels: string[][] = [];
    const executer: Executer = async (_bin, args) => {
      appels.push(args);
      return { code: 0, stdout: appels.length === 1 ? SORTIE : "2", stderr: "" };
    };
    const mac = new Mac({ actif: true, executer, dossierCaptures: fs.mkdtempSync(path.join(os.tmpdir(), "m-")) });
    const l = await mac.listerMails(20, true);
    expect(l.mails.map((m) => m.id)).toEqual([101, 102, 103]);
    expect(l.texte).toContain("[102] Shein <promo@shein.com> — -70 % ce week-end !");
    const r = await mac.rangerMails([102, 0, 103], "Max - Pubs");
    expect(r).toEqual({ ok: true, texte: "2 mails rangés dans « Max - Pubs »." });
    const dernier = appels.at(-1)!;
    expect(dernier.slice(-3)).toEqual(["Max - Pubs", "102", "103"]);
    expect((await mac.rangerMails([5], 'x" & do shell script "rm')).ok).toBe(false);
  });
});

describe("TriMails", () => {
  it("affiche le classement de Max (seulement des mails lus, chacun une fois), sans l'adresse des expéditeurs", () => {
    const t = new TriMails();
    expect(t.afficher({}, "x").ok).toBe(false);
    t.retenir(lireMails(SORTIE));
    let changements = 0;
    t.on("etat", () => changements++);
    const r = t.afficher({ a_traiter: [101], pubs: [102, 999], perso: [103, 101], inconnue: [103] }, "  Un mail urgent de la fac.  ");
    expect(r.texte).toBe("3 mails classés et affichés à l'écran.");
    const v = t.vue()!;
    expect(v.resume).toBe("Un mail urgent de la fac.");
    expect(v.categories.map((c) => [c.id, c.mails.map((m) => m.id)])).toEqual([
      ["a_traiter", [101]],
      ["perso", [103]],
      ["pubs", [102]],
    ]);
    expect(v.categories[0]).toMatchObject({ nom: "À traiter", emoji: "🔴", mails: [{ de: "Scolarité", sujet: "Planning des partiels", lu: false }] });
    expect(changements).toBe(1);
    expect(t.ids("pubs")).toEqual([102]);
    expect(t.connus([102, 555, "103"])).toEqual([102, 103]);
  });

  it("dit combien de mails n'ont pas été classés", () => {
    const t = new TriMails();
    t.retenir(lireMails(SORTIE));
    expect(t.afficher({ pubs: [102] }, "").texte).toContain("2 n'ont pas été classés");
  });
});
