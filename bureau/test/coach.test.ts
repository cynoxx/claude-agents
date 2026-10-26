import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Coach,
  ajouterEcheance,
  bilan,
  decrireBilan,
  dureeParlee,
  echeances,
  heureCible,
  jourDe,
  lireIdees,
  lireJournal,
  lireProfil,
  noterIdee,
  type SessionTravail,
} from "../server/max/coach.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-coach-"));
const local = (j: string, h = "12:00") => new Date(`${j}T${h}:00`);
const session = (jour: string, minutes: number, h = "10:00"): SessionTravail => ({
  debut: local(jour, h).toISOString(),
  fin: new Date(local(jour, h).getTime() + minutes * 60_000).toISOString(),
  minutes,
  sujet: "Anatomie",
});

describe("durées et jours", () => {
  it("dit une durée comme à l'oral", () => {
    expect(dureeParlee(0)).toBe("rien");
    expect(dureeParlee(1)).toBe("1 minute");
    expect(dureeParlee(45)).toBe("45 minutes");
    expect(dureeParlee(60)).toBe("1 heure");
    expect(dureeParlee(75)).toBe("1 heure 15");
    expect(dureeParlee(120)).toBe("2 heures");
    expect(dureeParlee(367)).toBe("6 heures 7");
  });

  it("compte la nuit jusqu'à 5 h dans la journée de la veille", () => {
    expect(jourDe(local("2026-10-26", "14:00"))).toBe("2026-10-26");
    expect(jourDe(local("2026-10-27", "02:30"))).toBe("2026-10-26");
    expect(jourDe(local("2026-10-27", "05:00"))).toBe("2026-10-27");
  });
});

describe("bilan", () => {
  it("additionne aujourd'hui, hier, les 7 derniers jours et la série", () => {
    const b = bilan(
      [
        session("2026-10-19", 30), // plus de 7 jours avant : hors bilan
        session("2026-10-23", 50),
        session("2026-10-25", 25),
        session("2026-10-25", 25, "23:00"),
        session("2026-10-26", 50),
        { ...session("2026-10-27", 25, "01:00") }, // 1 h du matin : compte pour le 26
      ],
      local("2026-10-27", "03:00"),
    );
    expect(b.aujourdhui).toBe(75);
    expect(b.sessionsAujourdhui).toBe(2);
    expect(b.hier).toBe(50);
    expect(b.semaine).toBe(175);
    expect(b.jours).toHaveLength(7);
    expect(b.jours.at(-1)).toEqual({ jour: "2026-10-26", minutes: 75 });
    expect(b.serie).toBe(2);
  });

  it("garde la série si on n'a pas encore travaillé aujourd'hui", () => {
    const b = bilan([session("2026-10-24", 25), session("2026-10-25", 25)], local("2026-10-26", "09:00"));
    expect(b.aujourdhui).toBe(0);
    expect(b.serie).toBe(2);
  });

  it("raconte le bilan en phrases", () => {
    const t = decrireBilan(bilan([session("2026-10-25", 40), session("2026-10-26", 75)], local("2026-10-26", "18:00")));
    expect(t).toContain("Aujourd'hui : 1 heure 15 (1 session).");
    expect(t).toContain("Hier : 40 minutes.");
    expect(t).toContain("7 derniers jours : 1 heure 55");
    expect(t).toContain("Série : 2 jours d'affilée");
  });

  it("dit qu'il n'y a rien quand rien n'est noté", () => {
    expect(decrireBilan(bilan([], local("2026-10-26")))).toContain("Aucune session de travail notée");
  });
});

describe("profil et échéances", () => {
  it("lit moi.md et ses échéances à venir, avec le nombre de jours", () => {
    const d = tmp();
    fs.writeFileSync(
      path.join(d, "moi.md"),
      "# Moi\n\nJe suis en PASS.\n\n## Échéances\n- 2026-12-14 : Examen PASS\n- 01/10/2026 : déjà passé\n- 05/11/2026 : Colle d'anatomie\n",
    );
    expect(lireProfil(d)).toContain("Je suis en PASS.");
    expect(echeances(lireProfil(d), local("2026-10-26", "23:30"))).toEqual([
      { nom: "Colle d'anatomie", date: "2026-11-05", jours: 10 },
      { nom: "Examen PASS", date: "2026-12-14", jours: 49 },
    ]);
  });

  it("ajoute une échéance dans moi.md (et crée la section si besoin)", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "moi.md"), "# Moi\n\nJe suis en PASS.\n");
    ajouterEcheance(d, "2026-12-14", "Examen PASS");
    ajouterEcheance(d, "2026-11-05", "Colle");
    const p = lireProfil(d);
    expect(p).toContain("## Échéances\n- 2026-12-14 : Examen PASS\n- 2026-11-05 : Colle");
    expect(echeances(p, local("2026-10-26"))).toHaveLength(2);
    expect(() => ajouterEcheance(d, "14 décembre", "x")).toThrow(/date/);
  });

  it("renvoie un profil vide sans moi.md", () => {
    expect(lireProfil(tmp())).toBe("");
  });
});

describe("idées", () => {
  it("met les idées au parking, datées", () => {
    const d = tmp();
    noterIdee(d, "Une box de fruits pour Asclepium", local("2026-10-26"));
    expect(lireIdees(d)).toEqual(["- [2026-10-26] Une box de fruits pour Asclepium"]);
    expect(() => noterIdee(d, "  ")).toThrow();
  });
});

describe("heure d'un rappel", () => {
  it("comprend « dans N minutes » et « à HH:MM » (demain si l'heure est passée)", () => {
    const m = local("2026-10-26", "22:10");
    expect(heureCible({ dansMinutes: 20 }, m)).toEqual(new Date(m.getTime() + 20 * 60_000));
    expect(heureCible({ heure: "23:00" }, m)).toEqual(local("2026-10-26", "23:00"));
    expect(heureCible({ heure: "7h30" }, m)).toEqual(local("2026-10-27", "07:30"));
    expect(heureCible({ heure: "25:00" }, m)).toBeNull();
    expect(heureCible({}, m)).toBeNull();
  });
});

describe("Coach — minuteur de travail", () => {
  let d: string;
  let donnees: string;
  let c: Coach;
  beforeEach(() => {
    vi.useFakeTimers({ now: local("2026-10-26", "14:00") });
    d = tmp();
    donnees = tmp();
    c = new Coach({ dossier: d, dossierDonnees: donnees });
  });
  afterEach(() => {
    c.fermer();
    vi.useRealTimers();
  });

  it("lance une session, l'annonce à la fin et la note dans le journal", () => {
    const fins: unknown[] = [];
    c.on("fin", (f) => fins.push(f));
    const r = c.demarrerSession("Anatomie", 25);
    expect(r.ok).toBe(true);
    expect(r.texte).toContain("25 minutes");
    expect(c.vue().minuteur).toMatchObject({ type: "travail", sujet: "Anatomie", fin: local("2026-10-26", "14:25").toISOString() });
    vi.advanceTimersByTime(25 * 60_000);
    expect(fins).toEqual([{ type: "travail", sujet: "Anatomie", minutes: 25, aujourdhui: 25 }]);
    expect(lireJournal(d)).toMatchObject([{ sujet: "Anatomie", minutes: 25 }]);
    expect(c.vue().minuteur).toBeNull();
    expect(c.vue()).toMatchObject({ aujourdhui: 25, total: 25, serie: 1 });
  });

  it("refuse une deuxième session en même temps, et des durées absurdes", () => {
    c.demarrerSession("Anatomie", 25);
    expect(c.demarrerSession("Chimie", 25)).toMatchObject({ ok: false });
    c.arreterSession();
    expect(c.demarrerSession("Chimie", 0).ok).toBe(false);
    expect(c.demarrerSession("Chimie", 500).ok).toBe(false);
  });

  it("note seulement le temps réellement fait quand on arrête avant la fin", () => {
    c.demarrerSession("Biochimie", 50);
    vi.advanceTimersByTime(18 * 60_000);
    const r = c.arreterSession("fini le chapitre 2");
    expect(r.ok).toBe(true);
    expect(r.texte).toContain("18 minutes");
    expect(lireJournal(d)).toMatchObject([{ sujet: "Biochimie", minutes: 18, note: "fini le chapitre 2" }]);
    expect(c.arreterSession().ok).toBe(false);
  });

  it("ne note rien pour une session arrêtée en moins d'une minute", () => {
    c.demarrerSession("Biochimie", 50);
    vi.advanceTimersByTime(20_000);
    c.arreterSession();
    expect(lireJournal(d)).toEqual([]);
  });

  it("gère les pauses (non comptées) et une session qui remplace la pause", () => {
    const fins: unknown[] = [];
    c.on("fin", (f) => fins.push(f));
    c.demarrerPause(5);
    expect(c.vue().minuteur?.type).toBe("pause");
    vi.advanceTimersByTime(5 * 60_000);
    expect(fins).toEqual([{ type: "pause", sujet: "", minutes: 5, aujourdhui: 0 }]);
    c.demarrerPause(5);
    expect(c.demarrerSession("Physique", 25).ok).toBe(true);
    expect(c.vue().minuteur?.type).toBe("travail");
    expect(lireJournal(d)).toEqual([]);
  });

  it("retrouve une session en cours après un redémarrage du Bureau", () => {
    c.demarrerSession("Anatomie", 25);
    c.fermer();
    vi.advanceTimersByTime(10 * 60_000);
    const fins: unknown[] = [];
    const c2 = new Coach({ dossier: d, dossierDonnees: donnees });
    c2.on("fin", (f) => fins.push(f));
    expect(c2.vue().minuteur?.sujet).toBe("Anatomie");
    vi.advanceTimersByTime(15 * 60_000);
    expect(fins).toHaveLength(1);
    expect(lireJournal(d)).toMatchObject([{ minutes: 25 }]);
    c2.fermer();
  });

  it("note une session finie pendant que le Bureau était fermé", () => {
    c.demarrerSession("Anatomie", 25);
    c.fermer();
    vi.advanceTimersByTime(60 * 60_000);
    const c2 = new Coach({ dossier: d, dossierDonnees: donnees });
    expect(c2.vue().minuteur).toBeNull();
    expect(lireJournal(d)).toMatchObject([{ minutes: 25, sujet: "Anatomie" }]);
    c2.fermer();
  });
});

describe("Coach — rappels", () => {
  let d: string;
  let donnees: string;
  let c: Coach;
  beforeEach(() => {
    vi.useFakeTimers({ now: local("2026-10-26", "22:10") });
    d = tmp();
    donnees = tmp();
    c = new Coach({ dossier: d, dossierDonnees: donnees });
  });
  afterEach(() => {
    c.fermer();
    vi.useRealTimers();
  });

  it("programme un rappel, le déclenche à l'heure et l'oublie ensuite", () => {
    const dits: string[] = [];
    c.on("rappel", (t) => dits.push(t));
    expect(c.programmerRappel("Il est 23 heures, au lit !", { heure: "23:00" })).toMatchObject({ ok: true });
    expect(c.listeRappels()).toContain("23 h 00");
    vi.advanceTimersByTime(49 * 60_000);
    expect(dits).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(dits).toEqual(["Il est 23 heures, au lit !"]);
    expect(c.listeRappels()).toBe("Aucun rappel programmé.");
  });

  it("annule un rappel par un mot de son texte", () => {
    c.programmerRappel("Boire de l'eau", { dansMinutes: 30 });
    c.programmerRappel("Appeler maman", { dansMinutes: 60 });
    expect(c.annulerRappel("maman")).toMatchObject({ ok: true });
    expect(c.listeRappels()).not.toContain("maman");
    expect(c.annulerRappel("rien")).toMatchObject({ ok: false });
  });

  it("refuse un rappel sans heure valide", () => {
    expect(c.programmerRappel("x", { heure: "plus tard" }).ok).toBe(false);
  });

  it("garde les rappels après un redémarrage", () => {
    c.programmerRappel("Au lit", { heure: "23:00" });
    c.fermer();
    const dits: string[] = [];
    const c2 = new Coach({ dossier: d, dossierDonnees: donnees });
    c2.on("rappel", (t) => dits.push(t));
    vi.advanceTimersByTime(50 * 60_000);
    expect(dits).toEqual(["Au lit"]);
    c2.fermer();
  });
});

describe("Coach — contexte pour Max", () => {
  it("donne la date, l'heure, les échéances, le travail du jour et le minuteur", () => {
    vi.useFakeTimers({ now: local("2026-10-26", "14:32") });
    const d = tmp();
    fs.writeFileSync(path.join(d, "moi.md"), "## Échéances\n- 2026-12-14 : Examen PASS\n");
    const c = new Coach({ dossier: d, dossierDonnees: tmp() });
    noterIdee(d, "idée 1");
    c.demarrerSession("Anatomie", 25);
    const t = c.contexte();
    expect(t).toContain("lundi 26 octobre 2026");
    expect(t).toContain("14 h 32");
    expect(t).toContain("Examen PASS : le 14 décembre 2026, dans 49 jours");
    expect(t).toContain("Session de travail en cours : « Anatomie », fin à 14 h 57");
    expect(t).toContain("Idées au parking : 1");
    expect(c.vue().echeance).toEqual({ nom: "Examen PASS", jours: 49 });
    c.fermer();
    vi.useRealTimers();
  });
});
