import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { focusDuJour, idProjet, PROJETS_DEPART, Vie } from "../server/max/vie.ts";
import type { ProjetVie } from "../shared/protocol.ts";

let dossier: string;
let maintenant: Date;
const creer = () => new Vie({ dossier, maintenant: () => maintenant });

beforeEach(() => {
  dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-vie-"));
  maintenant = new Date("2026-11-02T09:30:00");
});

describe("Vie — projets", () => {
  it("part des projets de départ et les garde dans vie/projets.json", () => {
    const v = creer();
    expect(v.vue().projets).toHaveLength(PROJETS_DEPART.length);
    expect(fs.existsSync(path.join(dossier, "vie", "projets.json"))).toBe(true);
    expect(v.vue().domaines.map((d) => d.id)).toEqual(["etudes", "sante", "business", "apps", "vie", "esprit"]);
  });

  it("met à jour un projet trouvé par un bout de son nom, et efface un champ vide", () => {
    const v = creer();
    expect(v.projet({ nom: "fruit tv", prochaineAction: "Clip du match", echeance: "2026-11-05" }).ok).toBe(true);
    const p = v.vue().projets.find((x) => x.nom.startsWith("Fruit TV"))!;
    expect(p).toMatchObject({ prochaineAction: "Clip du match", echeance: "2026-11-05", maj: "2026-11-02" });
    v.projet({ id: p.id, echeance: "" });
    expect(creer().vue().projets.find((x) => x.id === p.id)?.echeance).toBeUndefined();
  });

  it("crée un projet avec un nom et un domaine, refuse le reste", () => {
    const v = creer();
    expect(v.projet({ nom: "Permis B", domaine: "vie" })).toMatchObject({ ok: true, texte: "Projet créé : Permis B." });
    expect(v.vue().projets.at(-1)).toMatchObject({ id: "permis-b", categorie: "Autre", statut: "actif" });
    expect(v.projet({ nom: "X", domaine: "astrologie" }).ok).toBe(false);
    expect(v.projet({ nom: "Nouveau" }).ok).toBe(false);
    expect(v.projet({ id: "permis-b", echeance: "demain" }).ok).toBe(false);
  });

  it("met en avant les actions actives, l'échéance la plus proche d'abord", () => {
    const p = (id: string, o: Partial<ProjetVie>): ProjetVie => ({ id, nom: id, domaine: "vie", categorie: "x", statut: "actif", maj: "2026-11-01", prochaineAction: "a", ...o });
    const f = focusDuJour([p("sans", {}), p("tard", { echeance: "2026-12-01" }), p("tot", { echeance: "2026-11-03" }), p("pause", { statut: "pause", echeance: "2026-11-02" }), p("rien", { prochaineAction: undefined })]);
    expect(f.map((x) => x.id)).toEqual(["tot", "tard", "sans"]);
  });

  it("donne des identifiants lisibles et uniques", () => {
    expect(idProjet("Asclepium — vidéos « Loi N »", new Set())).toBe("asclepium-videos-loi-n");
    expect(idProjet("Permis", new Set(["permis"]))).toBe("permis-2");
  });
});

describe("Vie — journal", () => {
  it("écrit les notes et le bilan du jour, avec l'humeur", () => {
    const v = creer();
    v.ecrire("Bio le matin");
    maintenant = new Date("2026-11-02T22:10:00");
    v.ecrire("Journée solide", { bilan: true, humeur: 4 });
    const j = creer().vue().journal!;
    expect(j).toEqual({ jour: "2026-11-02", notes: [{ heure: "09:30", texte: "Bio le matin" }], bilan: "Journée solide", humeur: 4 });
    expect(v.decrire()).toContain("1 note(s), bilan écrit");
  });

  it("range les jours passés à part, du plus récent au plus ancien", () => {
    const v = creer();
    v.ecrire("lundi");
    maintenant = new Date("2026-11-03T10:00:00");
    v.ecrire("mardi");
    maintenant = new Date("2026-11-04T10:00:00");
    expect(v.vue().journal).toBeNull();
    expect(v.vue().recents.map((j) => j.jour)).toEqual(["2026-11-03", "2026-11-02"]);
    expect(v.ecrire("   ").ok).toBe(false);
  });
});
