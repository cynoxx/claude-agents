import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Automatismes, estDu } from "../server/max/automatismes.ts";
import { automatismesDeMax, ligneLoi, loiSuivante, type Dependances } from "../server/max/automatismes-actions.ts";
import { Vie } from "../server/max/vie.ts";

let dossier: string;
let maintenant: Date;
beforeEach(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-auto-"));
  maintenant = new Date("2026-11-02T09:05:00");
});

describe("Automatismes — l'horloge", () => {
  it("tourne une fois par jour, à partir de son heure, jusqu'à 3 h de retard, les bons jours", () => {
    const e = { actif: true };
    expect(estDu({ heure: "09:00" }, e, new Date("2026-11-02T08:59:00"))).toBe(false);
    expect(estDu({ heure: "09:00" }, e, new Date("2026-11-02T09:00:00"))).toBe(true);
    expect(estDu({ heure: "09:00" }, e, new Date("2026-11-02T12:30:00"))).toBe(false);
    expect(estDu({ heure: "09:00" }, { actif: true, dernier: "2026-11-02" }, new Date("2026-11-02T09:10:00"))).toBe(false);
    expect(estDu({ heure: "09:00" }, { actif: false }, new Date("2026-11-02T09:10:00"))).toBe(false);
    expect(estDu({ heure: "18:00", jours: [0] }, e, new Date("2026-11-02T18:10:00"))).toBe(false); // lundi
    expect(estDu({ heure: "18:00", jours: [0] }, e, new Date("2026-11-01T18:10:00"))).toBe(true); // dimanche
  });

  it("lance, retient, se coupe, et dit ce qu'il a fait", async () => {
    let n = 0;
    const a = new Automatismes([{ id: "x", nom: "X", description: "", heure: "09:00", faire: async () => `fait ${++n}` }], { dossier, maintenant: () => maintenant });
    const res: string[] = [];
    a.on("resultat", (t: string) => res.push(t));
    await a.verifier();
    await a.verifier();
    expect(res).toEqual(["fait 1"]);
    expect(a.vue()[0]).toMatchObject({ faitAujourdhui: true, resultat: "fait 1", actif: true });
    a.activer("x", false);
    const b = new Automatismes([{ id: "x", nom: "X", description: "", heure: "09:00", faire: async () => "y" }], { dossier, maintenant: () => new Date("2026-11-03T09:05:00") });
    await b.verifier();
    expect(b.vue()[0].actif).toBe(false);
    expect(await b.lancer("x")).toBe("y");
  });
});

describe("Automatismes — ce qu'ils font", () => {
  const deps = (o: Partial<Dependances> = {}): Dependances & { demandes: string[]; prompts: string[] } => {
    const demandes: string[] = [];
    const prompts: string[] = [];
    return {
      vie: new Vie({ dossier, maintenant: () => maintenant }),
      studio: null,
      travail: () => ({ aujourdhui: 30, objectif: 360 }),
      seance: () => "Jambes",
      profil: () => "PASS",
      rediger: async (p) => (prompts.push(p), "Texte écrit."),
      demander: (t) => demandes.push(t),
      dossier,
      maintenant: () => maintenant,
      demandes,
      prompts,
      ...o,
    };
  };
  const faire = (d: Dependances, id: string) => automatismesDeMax(d).find((a) => a.id === id)!.faire();

  it("trouve la loi suivante et sa ligne dans lois.md", () => {
    expect(loiSuivante(["Loi 8", "Loi 9", "But incroyable", "loi 3"])).toBe(10);
    expect(loiSuivante([])).toBe(1);
    expect(ligneLoi("# titre\n9. Ne surpassez jamais le maître — en stage\n10) Autre", 9)).toBe("Ne surpassez jamais le maître — en stage");
    expect(ligneLoi("Loi 10 : Cachez vos intentions", 10)).toBe("Cachez vos intentions");
    expect(ligneLoi("1. a", 2)).toBeNull();
  });

  it("donne le cap du matin, relance les études s'il est loin de l'objectif, et lance le bilan du soir", async () => {
    const d = deps();
    expect(await faire(d, "cap-matin")).toMatch(/^☀️ Cap : 1\) .* · Sport : Jambes$/);
    expect(await faire(d, "relance-etudes")).toContain("30 min de travail");
    expect(d.demandes[0]).toBe("Il est 15 heures : 30 min de travail aujourd'hui. On lance 50 minutes ?");
    expect(await faire(deps({ travail: () => ({ aujourdhui: 200, objectif: 360 }) }), "relance-etudes")).toBeNull();
    expect(await faire(d, "bilan-soir")).toBe("🌙 Bilan du soir lancé.");
    d.vie.ecrire("ok", { bilan: true });
    expect(await faire(d, "bilan-soir")).toBeNull();
  });

  it("propose 3 idées du jour (une fois) et écrit la revue de la semaine dans le journal", async () => {
    const d = deps({ rediger: async () => JSON.stringify({ idees: [{ titre: "A", accroche: "a", premierPas: "p" }] }) });
    expect(await faire(d, "idees-jour")).toBe("💡 1 idées du jour dans la fiche Business : A");
    expect(await faire(d, "idees-jour")).toBeNull();
    const r = deps();
    expect(await faire(r, "revue-semaine")).toBe("📊 Revue de la semaine écrite dans ton journal.");
    expect(r.vie.vue().journal?.notes[0].texte).toBe("Revue de la semaine : Texte écrit.");
  });
});

describe("Automatismes — script vidéo", () => {
  it("crée lois.md la première fois, puis écrit chaque jour le script de la loi suivante", async () => {
    const { Studio } = await import("../server/studio/studio.ts");
    const { DEFAULT_CONFIG } = await import("../server/config.ts");
    const st = new Studio({ config: { dossier: path.join(dossier, "Max Studio"), rappels: false, comptes: DEFAULT_CONFIG.studio.comptes }, ffmpeg: "ffmpeg", whisper: { bin: "x", modele: "x" }, dossierEtat: dossier });
    const prompts: string[] = [];
    const d: Dependances = {
      vie: new Vie({ dossier }),
      studio: st,
      travail: () => ({ aujourdhui: 0, objectif: 0 }),
      seance: () => null,
      profil: () => "",
      rediger: async (p) => (prompts.push(p), "Et si ton pire ennemi, c'était toi ?"),
      demander: () => {},
      dossier,
    };
    const script = automatismesDeMax(d).find((a) => a.id === "script-video")!;
    expect(await script.faire()).toContain("lois.md");
    const lois = path.join(dossier, "Max Studio", "Asclepium", "lois.md");
    fs.appendFileSync(lois, "1. Maîtrisez votre temps — le temps est la ressource rare\n2. Autre loi\n");
    expect(await script.faire()).toContain("Script « Loi 1 » prêt");
    expect(prompts[0]).toContain("Loi 1 : Maîtrisez votre temps");
    expect(fs.readFileSync(path.join(dossier, "Max Studio", "Asclepium", "scripts", "Loi 1.txt"), "utf8")).toContain("pire ennemi");
    expect(await script.faire()).toContain("Loi 2");
    expect(await script.faire()).toBeNull(); // loi 3 pas dans la liste : rien d'inventé
  });
});
