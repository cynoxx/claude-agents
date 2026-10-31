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

describe("ton propre fichier de suivi (Mes habitudes / Suivi)", () => {
  it("remplit seulement les cases du jour, en retrouvant tes habitudes par leur nom, et garde tout le reste", async () => {
    const { default: JSZip } = await import("jszip");
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-tableur-"));
    const fichier = path.join(dossier, "Suivi_habitudes.xlsx");
    // un gabarit comme le tien : la liste des habitudes (lignes 5 à 16), puis une ligne par date, colonnes D à O
    const c = new ExcelJS.Workbook();
    const liste = c.addWorksheet("Mes habitudes");
    [["Réveil à 5h", "Case"], ["Prière / temps avec Dieu", "Case"], ["Heures de médecine", "Min"], ["Heures projets annexes (max)", "Max"], ["Boxe / muscu", "Case"], ["Coucher avant 23h", "Case"]].forEach(([n, t], i) => {
      liste.getCell(`C${5 + i}`).value = n;
      liste.getCell(`D${5 + i}`).value = t;
    });
    const suivi = c.addWorksheet("Suivi");
    suivi.getCell("A1").value = "SUIVI";
    for (let i = 0; i < 5; i++) {
      suivi.getCell(`A${5 + i}`).value = new Date(Date.UTC(2026, 10, 2 + i));
      suivi.getCell(`P${5 + i}`).value = { formula: `SUM(D${5 + i}:O${5 + i})`, result: 0 };
    }
    suivi.getCell("H6").value = "garde-moi"; // une case que tu as remplie toi-même, un autre jour
    c.addWorksheet("Bilan").getCell("A1").value = "Bilan";
    await c.xlsx.writeFile(fichier);
    // on y glisse un « graphique » : il doit survivre
    const zip = await JSZip.loadAsync(fs.readFileSync(fichier));
    zip.file("xl/charts/chart1.xml", "<chart>à garder</chart>");
    fs.writeFileSync(fichier, await zip.generateAsync({ type: "nodebuffer" }));

    const h = new Habitudes({
      fichier,
      dossier,
      maintenant: () => new Date("2026-11-02T10:00:00"),
      sources: { regles: () => ({ lever: true, bloc: false, coucher: false }), blocs: () => 7, sport: () => true },
    });
    expect((await h.synchroniser()).texte).toBe("Suivi mis à jour dans ton fichier.");
    await h.noter("priere");
    await h.noter("business", 0.5);
    await h.noter("creatine"); // pas dans ce fichier : gardée par Max
    await h.noter("priere", true, "2026-11-03");

    const lu = new ExcelJS.Workbook();
    await lu.xlsx.readFile(fichier);
    expect(lu.worksheets.map((w) => w.name)).toEqual(["Mes habitudes", "Suivi", "Bilan"]);
    const s = lu.getWorksheet("Suivi")!;
    // 2 novembre = ligne 5 : réveil (D), prière (E), médecine en heures (F), annexes (G), boxe (H), coucher non fait (I)
    expect(["D5", "E5", "F5", "G5", "H5", "I5"].map((r) => s.getCell(r).value)).toEqual(["x", "x", 5.8, 0.5, "x", null]);
    expect(s.getCell("E6").value).toBe("x"); // la prière du 3
    expect(s.getCell("H6").value).toBe("garde-moi");
    expect(s.getCell("P5").value).toMatchObject({ formula: "SUM(D5:O5)" });
    const apres = await JSZip.loadAsync(fs.readFileSync(fichier));
    expect(await apres.file("xl/charts/chart1.xml")!.async("string")).toBe("<chart>à garder</chart>");
    expect(await apres.file("xl/workbook.xml")!.async("string")).toContain('fullCalcOnLoad="1"');
    expect(fs.existsSync(path.join(dossier, "Suivi_habitudes.avant-max.xlsx"))).toBe(true);
    expect(h.vue().cases.find((x) => x.id === "creatine")?.valeur).toBe(true);
  });

  it("retrouve ton fichier dans Téléchargements et le copie à sa place", async () => {
    const { trouverTableur } = await import("../server/max/habitudes.ts");
    const maison = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-maison-"));
    fs.mkdirSync(path.join(maison, "Downloads"));
    fs.writeFileSync(path.join(maison, "Downloads", "Suivi_habitudes.xlsx"), "contenu");
    const cible = path.join(maison, "Documents", "Bureau", "Suivi_habitudes.xlsx");
    expect(trouverTableur(cible, maison)).toBe(path.join(maison, "Downloads", "Suivi_habitudes.xlsx"));
    expect(fs.readFileSync(cible, "utf8")).toBe("contenu");
    expect(trouverTableur(cible, maison)).toBe(cible);
    expect(trouverTableur(path.join(maison, "x", "autre.xlsx"), fs.mkdtempSync(path.join(os.tmpdir(), "vide-")))).toBeNull();
  });
});
