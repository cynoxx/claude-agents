import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Assistant, type OptionsAssistant } from "../server/max/assistant.ts";
import { Cerveau } from "../server/max/cerveau.ts";
import { Bouche } from "../server/voix/bouche.ts";
import type { EtatBureau, MissionVue } from "../shared/protocol.ts";

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function jusqua(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fin) throw new Error("délai dépassé");
    await attendre(5);
  }
}

class FausseOreille extends EventEmitter {
  muet = false;
  active = false;
  demarrages = 0;
  demarrer() {
    this.active = true;
    this.demarrages++;
  }
  arreter() {
    this.active = false;
    this.emit("arret");
  }
}

/** Fausse bouche : chaque phrase dure `dureeMs`. */
class FausseBouche extends EventEmitter {
  dites: string[] = [];
  private file: string[] = [];
  private timer?: NodeJS.Timeout;
  constructor(private dureeMs = 20) {
    super();
  }
  get parle() {
    return !!this.timer || this.file.length > 0;
  }
  dire(p: string) {
    if (!p.trim()) return;
    const silencieux = !this.parle;
    this.file.push(p);
    if (silencieux) {
      this.emit("debut");
      this.suivante();
    }
  }
  taire() {
    if (!this.parle) return;
    this.file = [];
    clearTimeout(this.timer);
    this.timer = undefined;
    this.emit("fin");
  }
  private suivante() {
    const p = this.file.shift();
    if (p === undefined) {
      this.timer = undefined;
      this.emit("fin");
      return;
    }
    this.dites.push(p);
    this.emit("phrase", p);
    this.timer = setTimeout(() => this.suivante(), this.dureeMs);
  }
}

class FauxCerveau extends EventEmitter {
  actif = false;
  recus: string[] = [];
  consigne = "";
  demarrer() {
    this.actif = true;
  }
  envoyer(t: string) {
    if (!this.actif) return false;
    this.recus.push(t);
    return true;
  }
  arreter() {
    if (!this.actif) return;
    this.actif = false;
    this.emit("arret", { code: 0 });
  }
  repondre(texte: string, morceaux = 5) {
    for (let i = 0; i < texte.length; i += morceaux) this.emit("texte", texte.slice(i, i + morceaux));
    this.emit("fin", { texte, ok: true, quota: false });
  }
}

class FauxManager extends EventEmitter {
  mission: MissionVue | null = null;
  snapshot(): EtatBureau {
    return { claude: { ok: true }, mission: this.mission };
  }
  changer(m: MissionVue) {
    this.mission = m;
    this.emit("etat", this.snapshot());
  }
}

const missionVue = (o: Partial<MissionVue>): MissionVue => ({
  nom: "m1",
  texte: "t",
  titre: "Comparatif mutuelles",
  phase: "travail",
  etape: 0,
  totalEtapes: 1,
  debut: "2026-10-26T10:00:00.000Z",
  max: { bulle: "", actions: [] },
  robots: [],
  ...o,
});

let oreille: FausseOreille;
let bouche: FausseBouche;
let cerveaux: FauxCerveau[];
let manager: FauxManager;
let a: Assistant;
const cerveau = () => cerveaux.at(-1)!;

function creer(o: Partial<OptionsAssistant> = {}) {
  oreille = new FausseOreille();
  bouche = new FausseBouche();
  cerveaux = [];
  manager = new FauxManager();
  a = new Assistant({
    oreille,
    bouche,
    creerCerveau: (consigne) => {
      const c = new FauxCerveau();
      c.consigne = consigne;
      cerveaux.push(c);
      return c;
    },
    manager,
    carnet: () => ["- [2026-10-26] Prénom : Johan"],
    missions: () => [],
    motCle: "max",
    suiteMs: 300,
    veilleMs: 60_000,
    dispos: { oreille: { ok: true }, bouche: { ok: true } },
    ...o,
  });
}
beforeEach(() => creer());
afterEach(() => a.veille());

describe("Assistant — réveil", () => {
  it("dort au départ", () => {
    expect(a.vue().etat).toBe("veille");
    expect(oreille.active).toBe(false);
  });

  it("se réveille : micro allumé, cerveau démarré avec le carnet, et accueil immédiat", async () => {
    a.reveiller();
    expect(oreille.active).toBe(true);
    expect(cerveau().actif).toBe(true);
    expect(cerveau().consigne).toContain("Prénom : Johan");
    expect(bouche.dites).toEqual(["Salut, je t'écoute."]);
    await jusqua(() => a.vue().etat === "ecoute");
    expect(a.vue().messages.map((m) => [m.de, m.texte])).toEqual([["max", "Salut, je t'écoute."]]);
  });

  it("ne refait rien si on le réveille alors qu'il est déjà réveillé", () => {
    a.reveiller();
    a.reveiller();
    expect(cerveaux).toHaveLength(1);
    expect(oreille.demarrages).toBe(1);
    expect(bouche.dites).toHaveLength(1);
  });
});

describe("Assistant — écoute", () => {
  beforeEach(async () => {
    a.reveiller();
    await jusqua(() => a.vue().etat === "ecoute");
    await attendre(400); // fin de la fenêtre de suite après l'accueil
  });

  it("transmet à Max ce qui commence par « Max »", () => {
    oreille.emit("phrase", "Max, quelle heure est-il ?");
    expect(cerveau().recus).toEqual(["quelle heure est-il ?"]);
    expect(a.vue().etat).toBe("reflechit");
    expect(a.vue().messages.at(-1)).toMatchObject({ de: "toi", texte: "quelle heure est-il ?" });
  });

  it("ignore ce qui ne lui est pas adressé", () => {
    oreille.emit("phrase", "Tu peux baisser la télé ?");
    expect(cerveau().recus).toEqual([]);
    expect(a.vue().messages).toHaveLength(1);
  });

  it("répond « Oui ? » quand on l'appelle sans rien dire d'autre, puis écoute la suite sans son nom", async () => {
    oreille.emit("phrase", "Max ?");
    expect(bouche.dites.at(-1)).toBe("Oui ?");
    await jusqua(() => a.vue().etat === "ecoute");
    oreille.emit("phrase", "Quel temps fait-il ?");
    expect(cerveau().recus).toEqual(["Quel temps fait-il ?"]);
  });

  it("dit la réponse phrase par phrase pendant qu'elle s'écrit, puis l'affiche en entier", async () => {
    oreille.emit("phrase", "Max, quelle heure est-il ?");
    cerveau().repondre("Il est midi. Bonne journée !");
    await jusqua(() => a.vue().etat === "ecoute");
    expect(bouche.dites.slice(1)).toEqual(["Il est midi.", "Bonne journée !"]);
    expect(a.vue().messages.at(-1)).toMatchObject({ de: "max", texte: "Il est midi. Bonne journée !" });
  });

  it("enlève le markdown et les emojis avant de parler", async () => {
    oreille.emit("phrase", "Max, liste ?");
    cerveau().repondre("**Voici** la liste ✅\n- un\n- deux");
    await jusqua(() => a.vue().etat === "ecoute");
    expect(bouche.dites.slice(1)).toEqual(["Voici la liste.", "un.", "deux."]);
  });

  it("a l'oreille coupée pendant qu'il parle, puis la rouvre", async () => {
    oreille.emit("phrase", "Max, raconte");
    cerveau().repondre("Une phrase. Une autre.");
    expect(oreille.muet).toBe(true);
    oreille.emit("phrase", "Max, coucou");
    expect(cerveau().recus).toEqual(["raconte"]);
    await jusqua(() => !oreille.muet);
    expect(a.vue().etat).toBe("ecoute");
  });

  it("écoute la suite sans son nom pendant quelques secondes après sa réponse, puis plus", async () => {
    oreille.emit("phrase", "Max, ça va ?");
    cerveau().repondre("Oui, et toi ?");
    await jusqua(() => !oreille.muet);
    oreille.emit("phrase", "Très bien merci");
    expect(cerveau().recus).toEqual(["ça va ?", "Très bien merci"]);
    cerveau().repondre("Super.");
    await jusqua(() => !oreille.muet);
    await attendre(400);
    oreille.emit("phrase", "Et la télé alors");
    expect(cerveau().recus).toHaveLength(2);
  });

  it("se tait sur demande et ne dit pas la fin de la réponse en cours", async () => {
    oreille.emit("phrase", "Max, raconte une histoire");
    cerveau().emit("texte", "Il était une fois. ");
    a.taire();
    cerveau().emit("texte", "Un roi. ");
    cerveau().emit("fin", { texte: "Il était une fois. Un roi.", ok: true, quota: false });
    await jusqua(() => a.vue().etat === "ecoute");
    expect(bouche.dites).not.toContain("Un roi.");
    oreille.emit("phrase", "Max, encore");
    cerveau().repondre("Deuxième réponse.");
    await jusqua(() => bouche.dites.includes("Deuxième réponse."));
  });

  it("prévient quand le quota est atteint", async () => {
    oreille.emit("phrase", "Max, bonjour");
    cerveau().emit("fin", { texte: "usage limit", ok: false, quota: true });
    await jusqua(() => a.vue().etat === "ecoute");
    expect(bouche.dites.at(-1)).toBe("Mon quota Claude est atteint. Réessaie un peu plus tard.");
  });

  it("raconte les outils qu'il utilise", () => {
    oreille.emit("phrase", "Max, lance une recherche");
    cerveau().emit("outil", { nom: "mcp__bureau__lancer_mission", entree: { texte: "x" } });
    cerveau().emit("outil", { nom: "mcp__bureau__memoriser", entree: { note: "Aime le café" } });
    cerveau().emit("outil", { nom: "WebSearch", entree: { query: "météo Paris" } });
    expect(a.vue().messages.slice(-3).map((m) => [m.de, m.texte])).toEqual([
      ["bureau", "🛠 Max lance une mission"],
      ["bureau", "📝 Max note dans son carnet : Aime le café"],
      ["bureau", "🔎 Max cherche sur le web : météo Paris"],
    ]);
  });

  it("se relance au message suivant si son cerveau s'arrête", async () => {
    cerveau().actif = false;
    cerveau().emit("arret", { code: 1, erreur: "erreur interne" });
    expect(a.vue().cerveau).toEqual({ ok: false, detail: "erreur interne" });
    expect(a.vue().messages.at(-1)?.texte).toContain("Max a eu un problème");
    a.ecrire("Tu es là ?");
    expect(cerveaux).toHaveLength(2);
    expect(cerveau().recus).toEqual(["Tu es là ?"]);
    expect(a.vue().cerveau.ok).toBe(true);
  });
});

describe("Assistant — veille", () => {
  it("se met en veille après sa phrase quand Max le demande", async () => {
    a.reveiller();
    await jusqua(() => a.vue().etat === "ecoute");
    oreille.emit("phrase", "Max, bonne nuit");
    a.veilleApresParole();
    expect(a.vue().etat).not.toBe("veille");
    cerveau().repondre("Bonne nuit !");
    await jusqua(() => a.vue().etat === "veille");
    expect(bouche.dites.at(-1)).toBe("Bonne nuit !");
    // l'oreille reste ouverte : il suffit de dire « Max » pour le réveiller
    expect(oreille.active).toBe(true);
    // son cerveau reste allumé : le prochain « Max » a une réponse tout de suite
    expect(cerveau().actif).toBe(true);
    oreille.emit("phrase", "Max, tu es là ?");
    expect(cerveaux).toHaveLength(1);
    expect(cerveau().recus.at(-1)).toContain("tu es là");
  });

  it("se met en veille tout seul après un long silence", async () => {
    creer({ veilleMs: 300 });
    a.reveiller();
    await jusqua(() => a.vue().etat === "veille", 3000);
    expect(bouche.dites).not.toContain("Je me mets en veille.");
    expect(oreille.active).toBe(true);
  });

  it("en veille, se réveille quand on l'appelle « Max »", async () => {
    a.reveiller();
    a.veille();
    expect(oreille.active).toBe(true);
    oreille.emit("phrase", "bonjour tout le monde");
    expect(a.vue().etat).toBe("veille");
    expect(a.vue().entendu?.texte).toBe("bonjour tout le monde");
    expect(a.vue().entendu?.pourMax).toBe(false);
    oreille.emit("phrase", "Max, quelle heure est-il ?");
    expect(a.vue().etat).not.toBe("veille");
    expect(cerveau().recus.at(-1)).toContain("quelle heure est-il");
  });

  it("se réveille sans accueil quand on lui écrit pendant qu'il dort", () => {
    a.ecrire("Bonjour Max");
    expect(a.vue().etat).toBe("reflechit");
    expect(bouche.dites).toEqual([]);
    expect(cerveau().recus).toEqual(["Bonjour Max"]);
  });

  it("relance le micro tout seul s'il s'arrête sans qu'on le demande", async () => {
    a.reveiller();
    const avant = oreille.demarrages;
    oreille.active = false;
    oreille.emit("arret");
    expect(a.vue().oreille.ok).toBe(false);
    await jusqua(() => oreille.demarrages > avant, 3000);
    expect(oreille.active).toBe(true);
    oreille.emit("phrase", "bla");
    expect(a.vue().oreille.ok).toBe(true);
  });

  it("marche sans micro (écrit seulement) et le dit", () => {
    creer({ oreille: null, dispos: { oreille: { ok: false, detail: "whisper-cli introuvable" }, bouche: { ok: true } } });
    a.reveiller();
    expect(a.vue().oreille).toEqual({ ok: false, detail: "whisper-cli introuvable" });
    a.ecrire("Salut");
    expect(cerveau().recus).toEqual(["Salut"]);
  });
});

describe("Assistant — missions", () => {
  it("annonce une mission terminée avec son résumé", async () => {
    a.reveiller();
    await jusqua(() => a.vue().etat === "ecoute");
    manager.changer(missionVue({ phase: "relecture" }));
    manager.changer(missionVue({ phase: "termine", resultat: "# R\n## En 3 lignes\n- La MAIF est la moins chère.\n## Détail\nlong" }));
    const recu = cerveau().recus.at(-1)!;
    expect(recu.startsWith("[Bureau] La mission « Comparatif mutuelles » est terminée.")).toBe(true);
    expect(recu).toContain("La MAIF est la moins chère.");
    expect(a.vue().messages.at(-1)).toMatchObject({ de: "bureau", texte: "✅ Mission terminée : Comparatif mutuelles" });
  });

  it("prévient d'une pause ou d'un échec, une seule fois", async () => {
    a.reveiller();
    await jusqua(() => a.vue().etat === "ecoute");
    manager.changer(missionVue({ phase: "travail" }));
    manager.changer(missionVue({ phase: "pause" }));
    manager.changer(missionVue({ phase: "pause" }));
    expect(cerveau().recus.filter((r) => r.includes("en pause"))).toHaveLength(1);
    manager.changer(missionVue({ nom: "m2", phase: "planification" }));
    manager.changer(missionVue({ nom: "m2", phase: "echec", erreur: "plan invalide" }));
    expect(cerveau().recus.at(-1)).toContain("a échoué : plan invalide");
  });

  it("ne dit rien des missions pendant qu'il dort", () => {
    manager.changer(missionVue({ phase: "relecture" }));
    manager.changer(missionVue({ phase: "termine", resultat: "# R\n\nFini." }));
    expect(cerveaux).toHaveLength(0);
  });
});

class FauxCoach extends EventEmitter {
  vue() {
    return { minuteur: null, aujourdhui: 50, total: 50, serie: 1, echeance: { nom: "Examen PASS", jours: 49 } };
  }
  contexte() {
    return "Nous sommes le lundi 26 octobre 2026.";
  }
  accueil() {
    return "Salut ! Déjà 50 minutes de travail aujourd'hui. Je t'écoute.";
  }
}

describe("Assistant — coach", () => {
  let coach: FauxCoach;
  beforeEach(() => {
    coach = new FauxCoach();
    creer({ coach, profil: () => "Je suis en PASS.", conseillers: () => "- etudes : 🩺 Prof (Études)", phraseSiri: "Max au rapport" });
  });

  it("met le profil, le contexte du jour et les conseillers dans sa consigne, et adapte son accueil", () => {
    a.reveiller();
    expect(cerveau().consigne).toContain("Je suis en PASS.");
    expect(cerveau().consigne).toContain("Nous sommes le lundi 26 octobre 2026.");
    expect(cerveau().consigne).toContain("- etudes : 🩺 Prof (Études)");
    expect(bouche.dites).toEqual(["Salut, je t'écoute."]);
    expect(a.vue().coach).toEqual(coach.vue());
  });

  it("se réveille à la fin d'une session et la fait annoncer par Max", () => {
    coach.emit("fin", { type: "travail", sujet: "Anatomie", minutes: 25, aujourdhui: 75 });
    expect(a.vue().etat).not.toBe("veille");
    expect(oreille.active).toBe(true);
    expect(cerveau().recus.at(-1)).toContain("La session de travail de 25 minutes sur « Anatomie » est terminée. Aujourd'hui : 1 heure 15");
    expect(a.vue().messages.at(-1)?.texte).toBe("⏱ Session terminée : Anatomie (25 minutes) · aujourd'hui 1 heure 15");
    expect(bouche.dites).toEqual([]);
  });

  it("annonce la fin d'une pause", () => {
    a.reveiller();
    coach.emit("fin", { type: "pause", sujet: "", minutes: 5, aujourdhui: 0 });
    expect(cerveau().recus.at(-1)).toContain("La pause est finie");
  });

  it("dit un rappel tel quel, en se réveillant s'il dormait", async () => {
    coach.emit("rappel", "Il est 23 heures, au lit !");
    expect(bouche.dites).toEqual(["Il est 23 heures, au lit !"]);
    expect(a.vue().messages.at(-1)).toMatchObject({ de: "max", texte: "🔔 Il est 23 heures, au lit !" });
    await jusqua(() => a.vue().etat === "ecoute");
  });

  it("rappelle la phrase Siri quand il s'endort", () => {
    a.reveiller();
    a.veille();
    expect(a.vue().messages.at(-1)?.texte).toContain("Dis « Max » pour le réveiller");
  });

  it("transmet avec le message suivant ce qui s'est passé depuis la page", () => {
    a.informer("Depuis la page : Session arrêtée : 18 minutes sur « Anatomie ».");
    a.ecrire("Je reprends");
    expect(cerveau().recus).toEqual(["[Bureau, pour info] Depuis la page : Session arrêtée : 18 minutes sur « Anatomie ».\nJe reprends"]);
    a.ecrire("Et après ?");
    expect(cerveau().recus.at(-1)).toBe("Et après ?");
  });

  it("commence sur l'écran Jarvis, change d'écran à la demande, et retient le dernier message de l'utilisateur", () => {
    expect(a.vue().vue).toBe("jarvis");
    let changements = 0;
    a.on("etat", () => changements++);
    a.allerA("bureau");
    a.allerA("bureau");
    expect(a.vue().vue).toBe("bureau");
    expect(changements).toBe(1);
    expect(a.dernierMessageUtilisateur()).toBeNull();
    a.ecrire("oui vas-y");
    expect(a.dernierMessageUtilisateur()).toMatchObject({ texte: "oui vas-y" });
    coach.emit("fin", { type: "pause", sujet: "", minutes: 5, aujourdhui: 0 });
    expect(a.dernierMessageUtilisateur()).toMatchObject({ texte: "oui vas-y" });
  });

  it("prévient quand une session fait atteindre la limite d'un pôle, sans rien arrêter", () => {
    coach.emit("limite", { pole: "business", limite: 60, sujet: "Boutique" });
    expect(cerveau().recus.at(-1)).toContain("Limite du pôle business atteinte : 1 heure aujourd'hui (session « Boutique » en cours)");
    expect(cerveau().recus.at(-1)).toContain("Ne l'arrête pas toi-même");
    expect(a.vue().messages.at(-1)?.texte).toBe("⏳ Limite business atteinte (1 heure)");
  });

  it("annonce son arrivée (pour trier les mails) au réveil avec accueil seulement", () => {
    let arrivees = 0;
    a.on("arrivee", () => arrivees++);
    a.ecrire("salut"); // réveil sans accueil
    expect(arrivees).toBe(0);
    a.veille();
    a.reveiller();
    expect(arrivees).toBe(1);
  });

  it("ouvre la fiche d'un pôle (sur l'écran de Max) et la ferme en allant au bureau", () => {
    a.allerA("bureau");
    a.ouvrirPole("sante", "corps");
    expect(a.vue()).toMatchObject({ vue: "jarvis", pole: "sante", focus: "corps" });
    a.ouvrirPole("business");
    expect(a.vue()).toMatchObject({ pole: "business", focus: null });
    a.allerA("bureau");
    expect(a.vue()).toMatchObject({ vue: "bureau", pole: null });
  });

  it("joue l'intro au lancement, puis salue quand la musique a baissé", async () => {
    let intros = 0;
    creer({ coach, intro: () => (intros++, 40) });
    a.reveiller();
    expect(intros).toBe(1);
    expect(bouche.dites).toEqual([]);
    await jusqua(() => bouche.dites.length > 0);
    expect(bouche.dites[0]).toContain("Salut");
    a.veille();
    a.reveiller(false);
    expect(intros).toBe(1); // pas d'intro pour un réveil sans accueil
  });

  it("met le sport dans le contexte du jour", () => {
    creer({ coach, sport: { decrire: () => "Sport — séance du jour (lundi) : Pec-Dos" } });
    a.reveiller();
    expect(cerveau().consigne).toContain("Sport — séance du jour (lundi) : Pec-Dos");
  });

  it("ajoute l'heure devant les messages de l'utilisateur quand on le lui demande", () => {
    creer({ horodater: true });
    a.ecrire("Bonjour");
    expect(cerveau().recus[0]).toMatch(/^\[\d{2}:\d{2}\] Bonjour$/);
    expect(a.vue().messages.at(-1)?.texte).toBe("Bonjour");
  });
});

class FauxPlanning extends EventEmitter {
  propose = false;
  aUnPlanning = false;
  doitProposer() {
    return !this.propose && !this.aUnPlanning;
  }
  noterPropose() {
    this.propose = true;
  }
  decrire() {
    return this.aUnPlanning ? "Emploi du temps : 09:00–11:00 Biochimie (travail)" : "Pas encore d'emploi du temps aujourd'hui.";
  }
}

describe("Assistant — emploi du temps", () => {
  let planning: FauxPlanning;
  beforeEach(() => {
    planning = new FauxPlanning();
    creer({ planning });
  });

  it("au premier réveil du jour, propose l'emploi du temps à l'écran, sans lancer la conversation", () => {
    a.reveiller();
    expect(cerveau().recus).toEqual([]);
    expect(cerveau().consigne).toContain("Pas encore d'emploi du temps aujourd'hui.");
    expect(a.vue().messages.at(-1)?.texte).toContain("on fait ma journée");
  });

  it("si on lui écrit en premier, lui glisse de proposer l'emploi du temps avec le message", () => {
    a.ecrire("Salut");
    expect(cerveau().recus[0]).toContain("premier échange de la journée");
    expect(cerveau().recus[0]).toMatch(/Salut$/);
    a.ecrire("Encore");
    expect(cerveau().recus[1]).toBe("Encore");
  });

  it("ne propose rien s'il y a déjà un emploi du temps", () => {
    planning.aUnPlanning = true;
    a.reveiller();
    expect(cerveau().recus).toEqual([]);
    expect(cerveau().consigne).toContain("09:00–11:00 Biochimie");
  });

  it("affiche le début d'un créneau sans parler, par défaut", () => {
    planning.emit("creneau", { debut: "09:00", fin: "11:00", titre: "Biochimie", type: "travail" });
    expect(a.vue().etat).toBe("veille");
    expect(cerveaux).toHaveLength(0);
    expect(a.vue().messages.at(-1)?.texte).toBe("🗓 09:00 · Biochimie");
  });

  it("annonce le début d'un créneau (et se réveille pour ça) si on le lui demande", () => {
    creer({ planning, annoncesCreneaux: true });
    planning.emit("creneau", { debut: "09:00", fin: "11:00", titre: "Biochimie", type: "travail" });
    expect(a.vue().etat).not.toBe("veille");
    expect(cerveau().recus.at(-1)).toContain("Début du créneau « Biochimie » (09:00–11:00, travail)");
    expect(a.vue().messages.at(-1)?.texte).toBe("🗓 09:00 · Biochimie");
  });
});

class FauxVerrou extends EventEmitter {
  verrouille = true;
  verrouiller() {
    this.verrouille = true;
  }
  ouvrir(prenom = "Johan") {
    this.verrouille = false;
    this.emit("deverrouille", prenom);
  }
}

describe("Assistant — verrou par le visage", () => {
  let verrou: FauxVerrou;
  let coach: FauxCoach;
  beforeEach(() => {
    verrou = new FauxVerrou();
    coach = new FauxCoach();
    creer({ verrou, coach });
  });

  it("ne se réveille pas et n'écoute rien tant qu'il est verrouillé", () => {
    a.reveiller();
    a.ecrire("Lis mes mails");
    expect(a.vue().etat).toBe("veille");
    expect(oreille.active).toBe(false);
    expect(cerveaux).toHaveLength(0);
  });

  it("se réveille et salue par son prénom quand le visage est reconnu", () => {
    verrou.ouvrir("Johan");
    expect(a.vue().etat).not.toBe("veille");
    expect(oreille.active).toBe(true);
    expect(bouche.dites).toEqual(["Salut Johan, je t'écoute."]);
  });

  it("verrouillé, entend « Max » mais demande le visage au lieu de répondre", () => {
    let demandes = 0;
    Object.assign(verrou, { demander: () => demandes++ });
    a.ecouterEnPermanence();
    expect(oreille.active).toBe(true);
    oreille.emit("phrase", "Max, lis mes mails");
    expect(demandes).toBe(1);
    expect(a.vue().etat).toBe("veille");
    expect(a.vue().entendu ?? null).toBeNull();
    expect(cerveaux).toHaveLength(0);
  });

  it("se reverrouille en s'endormant", () => {
    verrou.ouvrir();
    a.veille();
    expect(verrou.verrouille).toBe(true);
  });

  it("verrouillé, note un créneau sans parler ni se réveiller", () => {
    const planning = new FauxPlanning();
    creer({ verrou, coach, planning, annoncesCreneaux: true });
    planning.emit("creneau", { debut: "12:30", fin: "13:30", titre: "Déjeuner", type: "repas" });
    expect(bouche.dites).toEqual([]);
    expect(a.vue().etat).toBe("veille");
    expect(cerveaux).toHaveLength(0);
  });

  it("verrouillé, dit un rappel ou la fin d'une session sans se réveiller", async () => {
    coach.emit("rappel", "Au lit !");
    coach.emit("fin", { type: "travail", sujet: "Anatomie", minutes: 25, aujourdhui: 75 });
    await jusqua(() => bouche.dites.length === 2 && !bouche.parle);
    expect(bouche.dites).toEqual(["Au lit !", "Ta session de 25 minutes est finie, bravo ! Dis « Max au rapport » pour me réveiller."]);
    expect(a.vue().etat).toBe("veille");
    expect(oreille.active).toBe(false);
    expect(cerveaux).toHaveLength(0);
  });
});

describe("Assistant — intégration avec un vrai cerveau et une vraie bouche (faux binaires)", () => {
  const envAvant = { ...process.env };
  afterEach(() => {
    process.env = { ...envAvant };
  });

  it("entend « Max, bonjour », fait répondre le faux claude et le fait dire au faux say", async () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-assistant-"));
    process.env.FAKE_SAY_LOG = path.join(dossier, "say.jsonl");
    process.env.FAKE_DELAY = "1";
    oreille = new FausseOreille();
    const vraieBouche = new Bouche({ bin: path.join(__dirname, "fake-say.mjs"), voix: "Thomas", debit: 185 });
    await vraieBouche.preparer();
    a = new Assistant({
      oreille,
      bouche: vraieBouche,
      creerCerveau: (consigne) => new Cerveau({ bin: path.join(__dirname, "fake-claude.mjs"), modele: "opus", consigne, mcpConfig: "/m.json", cwd: dossier }),
      manager: new FauxManager(),
      carnet: () => [],
      missions: () => [],
      motCle: "max",
      suiteMs: 300,
      veilleMs: 60_000,
      dispos: { oreille: { ok: true }, bouche: { ok: true } },
    });
    a.reveiller();
    await jusqua(() => a.vue().etat === "ecoute");
    await attendre(400);
    oreille.emit("phrase", "Max, bonjour");
    await jusqua(() => a.vue().messages.some((m) => m.de === "max" && m.texte.startsWith("Bien reçu")), 5000);
    await jusqua(() => a.vue().etat === "ecoute");
    const dits = fs.readFileSync(process.env.FAKE_SAY_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l).at(-1));
    expect(dits).toEqual(["Salut, je t'écoute.", "Bien reçu : bonjour.", "Autre chose ?"]);
  }, 15_000);
});

describe("Assistant — Max Ultime (mode obscur)", () => {
  it("bascule en mode obscur, le dit (bouton), prévient son cerveau, et en ressort", async () => {
    const { PHRASES_OBSCUR } = await import("../server/max/assistant.ts");
    a.reveiller();
    a.ouvrirPole("sante");
    const evts: boolean[] = [];
    a.on("obscur", (x: boolean) => evts.push(x));
    expect(a.modeObscur(true, true)).toContain("Max Ultime");
    expect(a.vue().obscur).toBeGreaterThan(0);
    // la fiche se ferme : place à la concentration
    expect(a.vue().pole).toBeNull();
    expect(PHRASES_OBSCUR.entree).toContain(bouche.dites.at(-1));
    expect(a.modeObscur(true)).toBe("Le mode obscur est déjà actif.");
    a.modeObscur(false, true);
    expect(a.vue().obscur).toBeNull();
    expect(PHRASES_OBSCUR.sortie).toContain(bouche.dites.at(-1));
    expect(evts).toEqual([true, false]);
    // au message suivant, son cerveau sait ce qui s'est passé
    a.ecrire("Max, on fait quoi ?");
    expect(cerveau().recus.at(-1)).toContain("mode obscur");
  });

  it("par la voix, c'est le cerveau qui répond : Max ne dit rien de lui-même", () => {
    a.reveiller();
    const avant = bouche.dites.length;
    a.modeObscur(true);
    expect(bouche.dites).toHaveLength(avant);
  });
});

describe("Assistant — parle peu", () => {
  it("ne dit que le début d'une longue réponse (la suite reste à l'écran), et coupe une longue première phrase", async () => {
    a.reveiller();
    await jusqua(() => a.vue().etat === "ecoute");
    bouche.dites = [];
    oreille.emit("phrase", "Max, explique-moi tout");
    const longue = "Alors voilà ce que je te propose pour aujourd'hui, en commençant par la biochimie ce matin. " + "Ensuite une autre phrase assez longue pour remplir. ".repeat(10);
    cerveau().repondre(longue);
    await jusqua(() => a.vue().etat === "ecoute", 3000);
    expect(bouche.dites[0]).toBe("Alors voilà ce que je te propose pour aujourd'hui.");
    expect(bouche.dites.join(" ").length).toBeLessThan(420);
    expect(a.vue().messages.at(-1)?.texte).toBe(longue.trim());
  });
});
