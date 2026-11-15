import { describe, expect, it } from "vitest";
import type { EtatBureau } from "../shared/protocol.ts";
import { arc, carteEcheance, carteMission, carteMoment, dureeOuverture, nomPole, poles, salutOuverture } from "../web/presence/presence-pur.ts";

const base = (): EtatBureau =>
  ({
    claude: { ok: true },
    mission: null,
    assistant: {
      etat: "ecoute",
      phrase: "",
      messages: [],
      oreille: { ok: true },
      bouche: { ok: true },
      cerveau: { ok: true },
      coach: { minuteur: null, aujourdhui: 100, total: 100, serie: 1, echeance: { nom: "Partiel de maths (rattrapage)", jours: 2 } },
    },
    poles: [{ id: "etudes", aujourdhui: 100, semaine: 600, jours: [], limite: null, objectif: 300, notes: [] }],
    conseillers: [
      { id: "etudes", nom: "Prof", emoji: "🎓", couleur: "#f00", domaine: "Études", statut: "libre" },
      { id: "sante", nom: "Coach", emoji: "💪", couleur: "#0f0", domaine: "Sport & santé", statut: "libre" },
    ],
  }) as unknown as EtatBureau;

const samedi10h = new Date(2026, 10, 14, 10, 0);

describe("l'écran Présence", () => {
  it("la mission du jour : les blocs d'études faits sur l'objectif", () => {
    const m = carteMission(base(), samedi10h);
    expect(m.titre).toBe("6 blocs d'études");
    expect(m.blocs).toEqual({ faits: 2, total: 6 });
    expect(m.sous).toBe("Bloc 3 à lancer");
    expect(m.lignes).toContainEqual({ gauche: "Études aujourd'hui", droite: "1 h 40 / 5 h" });
  });

  it("la mission montre la session en cours, puis le créneau suivant de l'emploi du temps", () => {
    const e = base();
    e.assistant!.coach!.minuteur = { type: "travail", sujet: "Dérivées", fin: "2026-11-14T10:50:00" };
    e.planning = { jour: "2026-11-14", enCours: 0, calendrier: false, creneaux: [
      { debut: "09:00", fin: "11:00", titre: "Maths", type: "travail" },
      { debut: "11:15", fin: "13:00", titre: "Électricité", type: "travail" },
    ] };
    const m = carteMission(e, samedi10h);
    expect(m.titre).toBe("Dérivées");
    expect(m.lignes[0]).toEqual({ gauche: "Électricité", droite: "11:15" });
  });

  it("l'échéance en grand, en braise pour un examen dans la semaine", () => {
    expect(carteEcheance(base())).toEqual({ grand: "J-2", nom: "Partiel de maths (rattrapage)", sous: "dans 2 jours", urgent: true });
    const e = base();
    e.assistant!.coach!.echeance = { nom: "Rendu du TP", jours: 0 };
    expect(carteEcheance(e)).toMatchObject({ grand: "JOUR J", urgent: false });
  });

  it("la carte du moment : la sanction d'abord, sinon rien quand il ne se passe rien", () => {
    expect(carteMoment(base())).toBeNull();
    const e = base();
    e.plan = { jour: 3, semaine: 1, blocs: 6, reveil: "06:00", reveilDemain: "06:00", regles: [], aujourdhui: { lever: false, bloc: false, coucher: false }, serie: 0, identite: "",
      sanction: { niveau: 3, texte: "Zone de pénalité : 20 pompes avant le premier bloc.", motif: ["Lever", "Coucher"], statut: "en-cours" } };
    expect(carteMoment(e)).toMatchObject({ etiquette: "Sanction en cours", titre: "20 pompes avant le premier bloc.", ton: "braise", sanction: true });
  });

  it("les études s'appellent MT2E, et l'arc du pôle passe en braise avant l'examen", () => {
    expect(nomPole("etudes", "Études")).toBe("MT2E");
    const [mt2e, sport] = poles(base());
    expect(mt2e).toMatchObject({ nom: "MT2E", ton: "braise", ligne: "Partiel de maths (rattrapage) · J-2" });
    expect(mt2e.avance).toBeCloseTo(600 / 2100);
    expect(sport.nom).toBe("Sport & santé");
  });

  it("un arc SVG part de midi", () => {
    expect(arc(0)).toBe("");
    expect(arc(0.25)).toBe("M 50 8 A 42 42 0 0 1 92.00 50.00");
    expect(arc(0.75)).toContain(" 1 1 ");
  });

  it("l'ouverture longue le premier lancement du jour, courte ensuite, et le bonjour selon l'heure", () => {
    expect(dureeOuverture(null, "2026-11-14")).toBe("longue");
    expect(dureeOuverture("2026-11-14", "2026-11-14")).toBe("courte");
    expect(salutOuverture(samedi10h)).toBe("Bonjour chef");
    expect(salutOuverture(new Date(2026, 10, 14, 20), "Johan")).toBe("Bonsoir Johan");
  });
});
