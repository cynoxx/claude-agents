import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { Habitudes, nomFeuille } from "../server/max/habitudes.ts";
import { ouvrirLien } from "../server/max/liens.ts";

describe("le suivi d'habitudes dans Excel", () => {
  it("remplit les cases du mois, garde tes propres modifications, et ajoute les jours suivants", async () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-hab-"));
    const fichier = path.join(dossier, "Suivi.xlsx");
    let maintenant = new Date("2026-11-04T10:00:00");
    let etat = { lever: true, bloc: true, coucher: false, blocs: 3, sport: true };
    const h = new Habitudes({
      fichier,
      dossier,
      maintenant: () => maintenant,
      sources: { regles: () => ({ lever: etat.lever, bloc: etat.bloc, coucher: etat.coucher }), blocs: () => etat.blocs, sport: () => etat.sport },
    });
    expect((await h.synchroniser()).ok).toBe(true);
    expect((await h.noter("prière")).texte).toBe("Prière : ✓ le 2026-11-04.");
    expect((await h.noter("blocs", 5)).ok).toBe(true);
    expect((await h.noter("yoga")).ok).toBe(false);

    const lire = async () => {
      const c = new ExcelJS.Workbook();
      await c.xlsx.readFile(fichier);
      return c.getWorksheet(nomFeuille("2026-11-04"))!;
    };
    let f = await lire();
    expect(f.getRow(1).getCell(1).value).toBe("Novembre 2026");
    expect(f.getRow(1).getCell(5).value).toBe(4); // la colonne du 4
    const ligne = (nom: string) => {
      let n = 0;
      f.getColumn(1).eachCell((c, i) => String(c.value) === nom && (n = i));
      return f.getRow(n);
    };
    expect(ligne("Levé à l'heure, téléphone hors de la chambre").getCell(5).value).toBe("✓");
    expect(ligne("Couché à l'heure, sans écran au lit").getCell(5).value).toBeNull();
    expect(ligne("Blocs de médecine (50 min)").getCell(5).value).toBe(5);
    expect(ligne("Prière").getCell(5).value).toBe("✓");
    expect(ligne("Salle / sport").getCell(5).value).toBe("✓");

    // tu coches toi-même une case dans Excel, puis Max remplit le lendemain : ta case reste
    const c = new ExcelJS.Workbook();
    await c.xlsx.readFile(fichier);
    const feuille = c.getWorksheet("Novembre 2026")!;
    feuille.getRow(8).getCell(2).value = "✓"; // « Créatine », le 1er
    await c.xlsx.writeFile(fichier);
    maintenant = new Date("2026-11-05T10:00:00");
    etat = { lever: true, bloc: false, coucher: true, blocs: 0, sport: false };
    await h.synchroniser();
    f = await lire();
    expect(f.getRow(8).getCell(2).value).toBe("✓");
    expect(ligne("Couché à l'heure, sans écran au lit").getCell(6).value).toBe("✓");
    expect(ligne("Levé à l'heure, téléphone hors de la chambre").getCell(5).value).toBe("✓");
    expect(h.vue().cases.find((x) => x.id === "lever")?.valeur).toBe(true);
    expect(h.decrire()).toContain("Levé à l'heure");
  });
});

describe("les raccourcis directs", () => {
  const mac = (journal: string[], appExiste: boolean) => ({
    ouvrirApp: async (n: string) => (journal.push(`app:${n}`), appExiste ? { ok: true, texte: "ok" } : { ok: false, texte: "non" }),
    ouvrirSite: async (u: string) => (journal.push(`site:${u}`), { ok: true, texte: "ok" }),
    ouvrirFichier: async (f: string) => (journal.push(`fichier:${f}`), { ok: true, texte: "ok" }),
  });
  const r = { notion: "", superProductivity: "", habitudes: "/x/Suivi.xlsx" };

  it("ouvre l'appli, sinon la page web, ou l'adresse que tu as donnée", async () => {
    const j: string[] = [];
    await ouvrirLien("notion", mac(j, true), r);
    await ouvrirLien("notion", mac(j, false), r);
    await ouvrirLien("super-productivity", mac(j, false), r);
    await ouvrirLien("notion", mac(j, true), { ...r, notion: "https://www.notion.so/ma-page" });
    expect(j).toEqual(["app:Notion", "app:Notion", "site:https://www.notion.so", "app:Super Productivity", "site:https://app.super-productivity.com", "site:https://www.notion.so/ma-page"]);
  });

  it("met à jour Excel puis l'ouvre", async () => {
    const j: string[] = [];
    expect((await ouvrirLien("excel", mac(j, true), r, async () => j.push("sync"))).ok).toBe(true);
    expect(j).toEqual(["sync", "fichier:/x/Suivi.xlsx"]);
    expect((await ouvrirLien("agenda", mac(j, true), r)).ok).toBe(false);
  });
});
