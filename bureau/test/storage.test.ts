import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  slugify,
  missionDirName,
  createMissionDir,
  writeEtat,
  appendJournal,
  listMissions,
  markInterrupted,
} from "../server/storage.ts";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-storage-"));
});

describe("slugify", () => {
  it("enlève accents et ponctuation", () => {
    expect(slugify("Compare 5 mutuelles à Paris !")).toBe("compare-5-mutuelles-a-paris");
  });
  it("garde au plus 6 mots", () => {
    expect(slugify("un deux trois quatre cinq six sept huit")).toBe("un-deux-trois-quatre-cinq-six");
  });
  it("gère guillemets et retours à la ligne", () => {
    expect(slugify('Écris "10 posts"\npour Lifforge')).toBe("ecris-10-posts-pour-lifforge");
  });
  it("renvoie « mission » pour un texte vide de lettres", () => {
    expect(slugify("!!! ???")).toBe("mission");
  });
});

describe("missionDirName", () => {
  it("formate date, heure et slug", () => {
    expect(missionDirName(new Date(2026, 9, 25, 14, 32), "x")).toBe("2026-10-25 14h32 - x");
  });
});

describe("createMissionDir", () => {
  it("crée le dossier et ajoute -2 si le nom existe déjà", () => {
    const d = new Date(2026, 9, 25, 14, 32);
    const a = createMissionDir(root, "x", d);
    const b = createMissionDir(root, "x", d);
    expect(fs.existsSync(a)).toBe(true);
    expect(path.basename(a)).toBe("2026-10-25 14h32 - x");
    expect(path.basename(b)).toBe("2026-10-25 14h32 - x-2");
  });
});

describe("journal, état et historique", () => {
  it("écrit l'état, ajoute au journal et liste les missions récentes d'abord", () => {
    const a = createMissionDir(root, "a", new Date(2026, 9, 25, 10, 0));
    const b = createMissionDir(root, "b", new Date(2026, 9, 25, 11, 0));
    writeEtat(a, { statut: "terminee", titre: "A", texte: "a", debut: "2026-10-25T10:00:00.000Z" });
    writeEtat(b, { statut: "en-cours", titre: "B", texte: "b", debut: "2026-10-25T11:00:00.000Z" });
    appendJournal(a, { qui: "max", texte: "un" });
    appendJournal(a, { qui: "max", texte: "deux" });
    const lignes = fs.readFileSync(path.join(a, "journal.jsonl"), "utf8").trim().split("\n");
    expect(lignes).toHaveLength(2);
    expect(JSON.parse(lignes[1]).texte).toBe("deux");

    const liste = listMissions(root);
    expect(liste.map((m) => m.titre)).toEqual(["B", "A"]);
    expect(liste[0].statut).toBe("en-cours");
  });

  it("ignore les dossiers sans etat.json et un root absent", () => {
    fs.mkdirSync(path.join(root, "pas une mission"));
    expect(listMissions(root)).toEqual([]);
    expect(listMissions(path.join(root, "absent"))).toEqual([]);
  });

  it("marque les missions en cours comme interrompues", () => {
    const a = createMissionDir(root, "a", new Date());
    writeEtat(a, { statut: "en-cours", titre: "A", texte: "a", debut: new Date().toISOString() });
    expect(markInterrupted(root)).toBe(1);
    expect(listMissions(root)[0].statut).toBe("interrompue");
  });
});
