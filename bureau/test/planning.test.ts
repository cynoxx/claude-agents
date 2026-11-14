import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Planning, creneauEnCours, minutesDuJour, validerCreneaux, type Creneau } from "../server/max/planning.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-planning-"));
const local = (j: string, h: string) => new Date(`${j}T${h}:00`);
const journee: Creneau[] = [
  { debut: "09:00", fin: "11:00", titre: "Biochimie", type: "travail" },
  { debut: "11:00", fin: "11:15", titre: "Pause", type: "pause" },
  { debut: "12:30", fin: "13:30", titre: "Déjeuner", type: "repas" },
  { debut: "23:30", fin: "00:30", titre: "Se préparer à dormir", type: "perso" },
  { debut: "00:30", fin: "07:30", titre: "Dormir", type: "sommeil" },
];

describe("créneaux", () => {
  it("compte la nuit jusqu'à 5 h dans la journée (comme le journal de travail)", () => {
    expect(minutesDuJour("09:30")).toBe(570);
    expect(minutesDuJour("00:30")).toBe(24 * 60 + 30);
    expect(minutesDuJour("04:59")).toBe(28 * 60 + 59);
    expect(minutesDuJour("05:00")).toBe(300);
    expect(minutesDuJour("9h")).toBe(540);
    expect(minutesDuJour("25:00")).toBeNaN();
  });

  it("valide, nettoie et range les créneaux dans l'ordre de la journée", () => {
    const c = validerCreneaux([
      { debut: "14h", fin: "16h", titre: "  Anatomie  ", type: "travail" },
      { debut: "9:00", fin: "10:00", titre: "Sport", type: "inconnu" },
    ]);
    expect(c).toEqual([
      { debut: "09:00", fin: "10:00", titre: "Sport", type: "autre" },
      { debut: "14:00", fin: "16:00", titre: "Anatomie", type: "travail" },
    ]);
    expect(validerCreneaux(journee)).toHaveLength(5);
  });

  it("refuse un créneau qui finit avant de commencer, sans titre, ou des créneaux qui se chevauchent", () => {
    expect(() => validerCreneaux([{ debut: "10:00", fin: "09:00", titre: "x", type: "travail" }])).toThrow(/finit/);
    expect(() => validerCreneaux([{ debut: "10:00", fin: "11:00", titre: " ", type: "travail" }])).toThrow(/titre/);
    expect(() => validerCreneaux([{ debut: "10h", fin: "midi", titre: "x", type: "travail" }])).toThrow(/heure/);
    expect(() =>
      validerCreneaux([
        { debut: "10:00", fin: "11:00", titre: "a", type: "travail" },
        { debut: "10:30", fin: "12:00", titre: "b", type: "travail" },
      ]),
    ).toThrow(/chevauche/);
    expect(() => validerCreneaux([])).toThrow();
    expect(() => validerCreneaux("rien")).toThrow();
  });

  it("trouve le créneau en cours", () => {
    const c = validerCreneaux(journee);
    expect(creneauEnCours(c, local("2026-10-27", "10:15"))).toBe(0);
    expect(creneauEnCours(c, local("2026-10-27", "11:59"))).toBe(-1);
    expect(creneauEnCours(c, local("2026-10-28", "01:00"))).toBe(4);
  });
});

describe("Planning", () => {
  let dossier: string;
  let donnees: string;
  let p: Planning;
  beforeEach(() => {
    vi.useFakeTimers({ now: local("2026-10-27", "08:00") });
    dossier = tmp();
    donnees = tmp();
    p = new Planning({ dossier, dossierDonnees: donnees });
  });
  afterEach(() => {
    p.fermer();
    vi.useRealTimers();
  });

  it("propose l'emploi du temps une seule fois par jour, tant qu'il n'y en a pas", () => {
    expect(p.doitProposer()).toBe(true);
    p.noterPropose();
    expect(p.doitProposer()).toBe(false);
    vi.setSystemTime(local("2026-10-28", "09:00"));
    expect(p.doitProposer()).toBe(true);
    p.enregistrer(journee);
    expect(p.doitProposer()).toBe(false);
  });

  it("enregistre l'emploi du temps du jour dans un fichier lisible, et le relit", () => {
    const r = p.enregistrer(journee);
    expect(r.ok).toBe(true);
    const f = path.join(dossier, "emplois-du-temps", "2026-10-27.json");
    expect(JSON.parse(fs.readFileSync(f, "utf8")).creneaux).toHaveLength(5);
    const p2 = new Planning({ dossier, dossierDonnees: donnees });
    expect(p2.vue()?.creneaux[0].titre).toBe("Biochimie");
    p2.fermer();
    expect(p.decrire()).toContain("09:00–11:00 Biochimie (travail)");
  });

  it("refuse un emploi du temps invalide sans rien écrire", () => {
    expect(p.enregistrer([{ debut: "10:00", fin: "09:00", titre: "x", type: "travail" }]).ok).toBe(false);
    expect(p.vue()).toBeNull();
  });

  it("annonce chaque créneau quand il commence, et montre celui en cours", () => {
    const annonces: string[] = [];
    p.on("creneau", (c: Creneau) => annonces.push(c.titre));
    p.enregistrer(journee);
    expect(p.vue()?.enCours).toBe(-1);
    vi.advanceTimersByTime(60 * 60_000);
    expect(annonces).toEqual(["Biochimie"]);
    expect(p.vue()?.enCours).toBe(0);
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(annonces).toEqual(["Biochimie", "Pause"]);
  });

  it("n'annonce pas les créneaux déjà passés quand on enregistre en cours de journée", () => {
    vi.setSystemTime(local("2026-10-27", "12:00"));
    const annonces: string[] = [];
    p.on("creneau", (c: Creneau) => annonces.push(c.titre));
    p.enregistrer(journee);
    vi.advanceTimersByTime(60 * 60_000);
    expect(annonces).toEqual(["Déjeuner"]);
  });

  it("retient qu'il a été ajouté au Calendrier", () => {
    p.enregistrer(journee);
    expect(p.vue()?.calendrier).toBe(false);
    p.marquerCalendrier();
    expect(p.vue()?.calendrier).toBe(true);
    p.enregistrer(journee);
    expect(p.vue()?.calendrier).toBe(false);
  });
});
