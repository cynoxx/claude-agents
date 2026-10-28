import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { creerJeton, lireJeton } from "../server/jeton.ts";
import { createBureauServer, type AssistantApi } from "../server/http.ts";
import { MissionManager } from "../server/mission.ts";
import { DEFAULT_CONFIG } from "../server/config.ts";
import { decrireEtat, decrireHistorique } from "../server/max/descriptions.ts";
import { ecrireConfigMcp } from "../server/max/mcp-config.ts";
import { lireCarnet } from "../server/max/carnet.ts";
import { Coach, lireIdees, lireJournal, lireProfil } from "../server/max/coach.ts";
import { CONSEILLERS_DEFAUT, Conseillers } from "../server/max/conseillers.ts";
import { Mac, type Executer } from "../server/max/mac.ts";
import { Verrou } from "../server/max/verrou.ts";
import { Planning } from "../server/max/planning.ts";
import { TriMails } from "../server/max/tri-mails.ts";
import { Sport } from "../server/max/sport.ts";
import { Vie } from "../server/max/vie.ts";
import { Reveil } from "../server/max/reveil.ts";
import { Visage } from "../server/max/visage.ts";
import type { AssistantVue, EtatBureau, MissionVue, ServerMessage } from "../shared/protocol.ts";

const FAKE = path.join(__dirname, "fake-claude.mjs");
const RACINE = path.resolve(__dirname, "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-outils-"));
const envAvant = { ...process.env };

class FauxAssistant extends EventEmitter implements AssistantApi {
  appels: string[] = [];
  vue(): AssistantVue {
    return { etat: "ecoute", phrase: "", messages: [], oreille: { ok: true }, bouche: { ok: true }, cerveau: { ok: true } };
  }
  reveiller() {
    this.appels.push("reveiller");
  }
  veille() {
    this.appels.push("veille");
  }
  veilleApresParole() {
    this.appels.push("veilleApresParole");
  }
  taire() {
    this.appels.push("taire");
  }
  ecrire(texte: string) {
    this.appels.push(`ecrire:${texte}`);
  }
  informer(texte: string) {
    this.appels.push(`informer:${texte}`);
  }
  dernier: { texte: string; heure: number } | null = null;
  dernierMessageUtilisateur() {
    return this.dernier;
  }
  modeObscur(actif: boolean, dire = false) {
    this.appels.push(`obscur:${actif}:${dire}`);
    return actif ? "Mode obscur activé" : "Mode obscur terminé";
  }
  ouvrirPole(pole: string | null, focus?: string | null) {
    this.appels.push(`pole:${pole}${focus ? `:${focus}` : ""}`);
  }
  allerA(vue: string) {
    this.appels.push(`vue:${vue}`);
  }
}

describe("jeton", () => {
  it("crée un jeton aléatoire lisible par l'utilisateur seul", () => {
    const dir = path.join(tmp(), "donnees");
    const j = creerJeton(dir);
    expect(j).toMatch(/^[0-9a-f]{64}$/);
    expect(lireJeton(dir)).toBe(j);
    expect(fs.statSync(path.join(dir, "jeton")).mode & 0o777).toBe(0o600);
    expect(creerJeton(dir)).not.toBe(j);
  });
  it("renvoie null sans jeton", () => {
    expect(lireJeton(tmp())).toBeNull();
  });
});

const mission = (o: Partial<MissionVue> = {}): MissionVue => ({
  nom: "2026-10-26 10h00 - x",
  texte: "Compare les mutuelles",
  titre: "Comparatif mutuelles",
  phase: "travail",
  etape: 0,
  totalEtapes: 2,
  debut: "2026-10-26T10:00:00.000Z",
  max: { bulle: "", actions: [] },
  robots: [
    { id: "chercheur-1", role: "chercheur", nom: "Chercheur", tache: "Prix MAIF", etape: 0, statut: "travail", bulle: "Je lis maif.fr…", actions: [] },
    { id: "analyste-1", role: "analyste", nom: "Analyste", tache: "Tableau", etape: 1, statut: "attente", bulle: "", actions: [] },
  ],
  ...o,
});

describe("descriptions pour Max", () => {
  it("décrit l'absence de mission", () => {
    expect(decrireEtat(null)).toBe("Aucune mission en cours.");
  });
  it("décrit une mission en cours, robot par robot", () => {
    const d = decrireEtat(mission());
    expect(d).toContain("Mission « Comparatif mutuelles » : l'équipe travaille (étape 1 sur 2)");
    expect(d).toContain("Chercheur (Prix MAIF) : travaille — Je lis maif.fr…");
    expect(d).toContain("Analyste (Tableau) : attend son tour");
  });
  it("indique qu'un résultat est disponible et les erreurs", () => {
    expect(decrireEtat(mission({ phase: "termine", resultat: "# R" }))).toContain("Le résultat est prêt");
    expect(decrireEtat(mission({ phase: "echec", erreur: "Max n'a pas réussi à planifier" }))).toContain("Erreur : Max n'a pas réussi à planifier");
  });
  it("résume l'historique", () => {
    expect(decrireHistorique([])).toBe("Aucune mission pour l'instant.");
    expect(decrireHistorique([{ nom: "n1", titre: "T1", statut: "terminee", debut: "2026-10-25T10:00:00.000Z" }])).toBe("- 2026-10-25 · T1 (terminée) · nom : n1");
  });
});

describe("configuration MCP de Max", () => {
  it("lance le serveur d'outils avec tsx et lui donne l'adresse du Bureau et le fichier du jeton", () => {
    const dir = tmp();
    const fichier = ecrireConfigMcp({ racine: RACINE, port: 4747, dossierDonnees: dir });
    const c = JSON.parse(fs.readFileSync(fichier, "utf8"));
    expect(c.mcpServers.bureau.command).toBe(path.join(RACINE, "node_modules", ".bin", "tsx"));
    expect(c.mcpServers.bureau.args).toEqual([path.join(RACINE, "server", "max", "outils-mcp.ts")]);
    expect(c.mcpServers.bureau.env).toEqual({ BUREAU_URL: "http://127.0.0.1:4747", BUREAU_JETON_FICHIER: path.join(dir, "jeton") });
    expect(fs.statSync(fichier).mode & 0o777).toBe(0o600);
  });
});

describe("routes et WebSocket de Max", () => {
  let root: string;
  let donnees: string;
  let jeton: string;
  let assistant: FauxAssistant;
  let manager: MissionManager;
  let coach: Coach;
  let conseillers: Conseillers;
  let gestes: { bin: string; args: string[] }[];
  let planning: Planning;
  let triMails: TriMails;
  let sport: Sport;
  let vie: Vie;
  let server: ReturnType<typeof createBureauServer>;
  let base: string;

  beforeEach(async () => {
    root = tmp();
    donnees = tmp();
    jeton = creerJeton(donnees);
    process.env.FAKE_DELAY = "5";
    const config = { ...DEFAULT_CONFIG, dossierMissions: root, dossierDonnees: donnees };
    assistant = new FauxAssistant();
    manager = new MissionManager(config, FAKE);
    coach = new Coach({ dossier: root, dossierDonnees: donnees, limites: { business: 60 } });
    conseillers = new Conseillers({ defs: CONSEILLERS_DEFAUT, bin: FAKE, modele: "sonnet", dossier: root, timeoutMs: 10_000, profil: () => "", contexte: () => "" });
    gestes = [];
    const executer: Executer = async (bin, args) => {
      gestes.push({ bin, args });
      const script = args.join("\n");
      if (script.includes('tell application "Contacts"')) return { code: 0, stdout: "Maman\t+33 6 12 34 56 78\t_$!<Mobile>!$_\n", stderr: "" };
      if (bin === "icalBuddy") return { code: 0, stdout: "Anatomie\t2026-10-27 at 08:30\n", stderr: "" };
      if (script.includes("my propre(sender of m)"))
        return { code: 0, stdout: "101\tScolarité <scol@univ.fr>\tPlanning des partiels\tlundi\tfalse\tBonjour\n102\tShein <promo@shein.com>\t-70 %\tlundi\tfalse\tPromo\n", stderr: "" };
      if (script.includes("move m to boite")) return { code: 0, stdout: String(args.length - args.lastIndexOf("-e") - 3), stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const mac = new Mac({ actif: true, executer, dossierCaptures: tmp(), maintenant: () => new Date("2026-10-27T07:00:00") });
    planning = new Planning({ dossier: root, dossierDonnees: donnees });
    triMails = new TriMails();
    sport = new Sport({ dossier: root });
    vie = new Vie({ dossier: root });
    const reveil = new Reveil({ dossierDonnees: donnees, telephone: null, appelleur: null, heureDefaut: "07:00", rappelMinutes: 5, essais: 4, preparer: async () => "" });
    server = createBureauServer({ config, manager, webDir: tmp(), jeton, assistant, coach, conseillers, mac, planning, triMails, sport, vie, reveil });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    process.env = { ...envAvant };
    await manager.attendreFin();
    coach.fermer();
    planning.fermer();
    conseillers.arreterTout();
    await new Promise((r) => server.close(r));
  });

  const avecJeton = (j = jeton) => ({ "x-bureau-jeton": j, "content-type": "application/json" });

  it("répond à /api/sante sans jeton (pour le script Siri)", async () => {
    expect(await (await fetch(base + "/api/sante")).json()).toEqual({ bureau: true });
  });

  it("refuse les outils sans jeton ou avec un mauvais jeton", async () => {
    expect((await fetch(base + "/api/outils/etat")).status).toBe(403);
    expect((await fetch(base + "/api/outils/etat", { headers: avecJeton("0".repeat(64)) })).status).toBe(403);
    expect((await fetch(base + "/api/outils/lancer", { method: "POST", body: JSON.stringify({ texte: "x" }) })).status).toBe(403);
    expect((await fetch(base + "/api/reveil", { method: "POST" })).status).toBe(403);
    expect(manager.snapshot().mission).toBeNull();
  });

  it("réveille Max avec le jeton", async () => {
    const r = await fetch(base + "/api/reveil", { method: "POST", headers: avecJeton() });
    expect(r.status).toBe(200);
    expect(assistant.appels).toEqual(["reveiller", "vue:jarvis"]);
  });

  it("envoie l'état de Max avec celui du Bureau, et transmet les messages pour Max", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    for (const m of [{ type: "parler-max", texte: "Salut Max" }, { type: "reveil" }, { type: "veille" }, { type: "taire" }]) ws.send(JSON.stringify(m));
    for (let i = 0; i < 100 && assistant.appels.length < 4; i++) await new Promise((r) => setTimeout(r, 10));
    expect(assistant.appels).toEqual(["ecrire:Salut Max", "reveiller", "veille", "taire"]);
    const premier = messages[0];
    expect(premier.type === "etat" && premier.etat.assistant?.etat).toBe("ecoute");
    assistant.emit("etat");
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.filter((m) => m.type === "etat").length).toBeGreaterThanOrEqual(2);
    ws.close();
  });

  it("Max pilote le Bureau avec ses outils MCP (vrai client MCP)", async () => {
    const transport = new StdioClientTransport({
      command: path.join(RACINE, "node_modules", ".bin", "tsx"),
      args: [path.join(RACINE, "server", "max", "outils-mcp.ts")],
      env: { ...(process.env as Record<string, string>), BUREAU_URL: base, BUREAU_JETON_FICHIER: path.join(donnees, "jeton") },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const texte = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
      return { texte: r.content.map((c) => c.text).join("\n"), erreur: !!r.isError };
    };
    try {
      const outils = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(outils).toEqual(
        [
          "arreter_mission", "etat_bureau", "historique_missions", "lancer_mission", "lire_resultat", "memoriser", "mettre_en_veille", "oublier", "reprendre_mission",
          "demarrer_session", "demarrer_pause", "arreter_session", "bilan_travail", "ajouter_echeance", "noter_idee", "lire_idees",
          "programmer_rappel", "liste_rappels", "annuler_rappel", "consulter_conseiller", "noter_pour_conseiller",
          "ouvrir_app", "fermer_app", "ouvrir_site", "chercher_youtube", "regler_volume", "regler_luminosite", "capture_ecran", "verrouiller_ecran",
          "musique", "chercher_contact", "preparer_message", "envoyer_message", "lire_mails", "agenda", "preparer_rdv", "creer_rdv", "meteo",
          "aller_au_bureau", "retour_jarvis",
          "enregistrer_planning", "lire_planning", "preparer_planning_calendrier", "ajouter_planning_calendrier",
          "trier_mails", "afficher_mails", "preparer_rangement", "ranger_mails",
          "ouvrir_pole", "mode_obscur", "noter_seance", "lire_sport", "changer_semaine_sport", "projet", "ecrire_journal", "lire_journal", "lire_studio", "script_video", "publier_video", "video_publiee", "planifier_video", "ouvrir_artefact",
          "regler_reveil", "annuler_reveil", "etat_reveil", "essayer_reveil",
        ].sort(),
      );
      expect((await texte("etat_bureau")).texte).toBe("Aucune mission en cours.");
      expect((await texte("memoriser", { note: "Projet Cynox Fitness : app de fitness" })).texte).toContain("Noté");
      expect(lireCarnet(root)).toHaveLength(1);
      expect((await texte("oublier", { texte: "cynox" })).texte).toContain("1 note");
      expect(lireCarnet(root)).toEqual([]);

      expect((await texte("lancer_mission", { texte: "Compare deux mutuelles" })).texte).toContain("Mission lancée");
      expect((await texte("lancer_mission", { texte: "Une autre" })).erreur).toBe(true);
      await manager.attendreFin();
      expect((await texte("etat_bureau")).texte).toContain("Le résultat est prêt");
      expect((await texte("lire_resultat")).texte).toContain("Synthèse de test");
      expect((await texte("historique_missions")).texte).toContain("Mission test");
      expect((await texte("reprendre_mission")).erreur).toBe(true);
      expect((await texte("mettre_en_veille")).texte).toContain("veille");
      expect(assistant.appels).toContain("veilleApresParole");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("Max coache et consulte ses conseillers avec ses outils MCP (vrai client MCP)", async () => {
    const transport = new StdioClientTransport({
      command: path.join(RACINE, "node_modules", ".bin", "tsx"),
      args: [path.join(RACINE, "server", "max", "outils-mcp.ts")],
      env: { ...(process.env as Record<string, string>), BUREAU_URL: base, BUREAU_JETON_FICHIER: path.join(donnees, "jeton") },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const texte = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
      return { texte: r.content.map((c) => c.text).join("\n"), erreur: !!r.isError };
    };
    try {
      expect((await texte("demarrer_session", { sujet: "Anatomie" })).texte).toContain("25 minutes");
      expect(coach.vue().minuteur?.sujet).toBe("Anatomie");
      expect((await texte("demarrer_session", { sujet: "Chimie" })).erreur).toBe(true);
      expect((await texte("arreter_session", { note: "chapitre 1" })).texte).toContain("Session arrêtée");
      expect(lireJournal(root)).toEqual([]);
      expect((await texte("demarrer_pause", {})).texte).toContain("Pause de 5 minutes");
      expect((await texte("arreter_session")).texte).toBe("Pause arrêtée.");
      expect((await texte("bilan_travail")).texte).toContain("Aucune session");

      expect((await texte("ajouter_echeance", { date: "2026-12-14", nom: "Examen PASS" })).texte).toContain("Échéance ajoutée");
      expect(lireProfil(root)).toContain("- 2026-12-14 : Examen PASS");
      expect((await texte("ajouter_echeance", { date: "demain", nom: "x" })).erreur).toBe(true);
      expect((await texte("noter_idee", { idee: "Box de fruits" })).texte).toContain("parking");
      expect(lireIdees(root)).toHaveLength(1);
      expect((await texte("lire_idees")).texte).toContain("Box de fruits");

      expect((await texte("programmer_rappel", { texte: "Au lit !", dans_minutes: 30 })).texte).toContain("Rappel programmé");
      expect((await texte("liste_rappels")).texte).toContain("Au lit !");
      expect((await texte("annuler_rappel", { texte: "lit" })).texte).toContain("1 rappel");
      expect((await texte("programmer_rappel", { texte: "x" })).erreur).toBe(true);

      const conseil = await texte("consulter_conseiller", { conseiller: "etudes", question: "Comment réviser ?" });
      expect(conseil.texte).toContain("Prof répond :");
      expect(conseil.texte).toContain("Comment réviser ?");
      expect((await texte("consulter_conseiller", { conseiller: "plombier", question: "?" })).erreur).toBe(true);
      expect((await texte("noter_pour_conseiller", { conseiller: "sante", note: "Se couche à 3 h" })).texte).toContain("Noté pour Coach");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("Max pilote le Mac, et n'envoie un message ou n'ajoute un rendez-vous qu'après un oui (vrai client MCP)", async () => {
    const transport = new StdioClientTransport({
      command: path.join(RACINE, "node_modules", ".bin", "tsx"),
      args: [path.join(RACINE, "server", "max", "outils-mcp.ts")],
      env: { ...(process.env as Record<string, string>), BUREAU_URL: base, BUREAU_JETON_FICHIER: path.join(donnees, "jeton") },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const texte = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
      return { texte: r.content.map((c) => c.text).join("\n"), erreur: !!r.isError };
    };
    try {
      expect((await texte("ouvrir_app", { nom: "Notes" })).texte).toBe("Notes est ouvert.");
      expect(gestes.at(-1)).toEqual({ bin: "open", args: ["-a", "Notes"] });
      expect((await texte("ouvrir_site", { url: "file:///etc/passwd" })).erreur).toBe(true);
      expect((await texte("regler_volume", { niveau: "30" })).erreur).toBe(false);
      expect((await texte("agenda", { jour: "aujourdhui" })).texte).toContain("08:30 Anatomie");

      // message : préparé, refusé sans oui, envoyé après un oui dit après la préparation
      assistant.dernier = { texte: "envoie à maman que je rentre à 20 h", heure: Date.now() - 1000 };
      const prep = await texte("preparer_message", { destinataire: "maman", texte: "Je rentre à 20 h" });
      expect(prep.texte).toContain("Message prêt pour Maman (+33612345678)");
      expect(prep.texte).toContain("PAS encore envoyé");
      const avant = gestes.length;
      expect((await texte("envoyer_message")).erreur).toBe(true);
      assistant.dernier = { texte: "non attends", heure: Date.now() + 10 };
      expect((await texte("envoyer_message")).erreur).toBe(true);
      expect(gestes.slice(avant).some((g) => g.args.join("\n").includes('tell application "Messages"'))).toBe(false);
      assistant.dernier = { texte: "oui vas-y", heure: Date.now() + 20 };
      expect((await texte("envoyer_message")).texte).toBe("Message envoyé.");
      const envoi = gestes.at(-1)!;
      expect(envoi.args.join("\n")).toContain('tell application "Messages"');
      expect(envoi.args.slice(-2)).toEqual(["+33612345678", "Je rentre à 20 h"]);
      expect((await texte("envoyer_message")).erreur).toBe(true);

      // rendez-vous : pareil
      assistant.dernier = { texte: "ajoute le dentiste mercredi à 17 h 30", heure: Date.now() - 1000 };
      const rdv = await texte("preparer_rdv", { titre: "Dentiste", date: "2026-11-04", heure: "17:30", minutes: 45 });
      expect(rdv.texte).toContain("PAS encore ajouté");
      expect((await texte("creer_rdv")).erreur).toBe(true);
      assistant.dernier = { texte: "ok", heure: Date.now() + 30 };
      expect((await texte("creer_rdv")).texte).toContain("Rendez-vous « Dentiste » ajouté le 2026-11-04 à 17:30");
      expect((await texte("preparer_rdv", { titre: "X", date: "bientôt", heure: "17:30" })).erreur).toBe(true);

      // écran
      expect((await texte("aller_au_bureau")).texte).toBe("Direction le bureau.");
      expect((await texte("retour_jarvis")).texte).toBe("Retour à l'écran de Max.");
      expect(assistant.appels.filter((a) => a.startsWith("vue:"))).toEqual(["vue:bureau", "vue:jarvis"]);
    } finally {
      await client.close();
    }
  }, 30_000);

  it("Max construit l'emploi du temps, trie les mails, et n'écrit dans Calendrier ou Mail qu'après un oui (vrai client MCP)", async () => {
    const transport = new StdioClientTransport({
      command: path.join(RACINE, "node_modules", ".bin", "tsx"),
      args: [path.join(RACINE, "server", "max", "outils-mcp.ts")],
      env: { ...(process.env as Record<string, string>), BUREAU_URL: base, BUREAU_JETON_FICHIER: path.join(donnees, "jeton") },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    const texte = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
      return { texte: r.content.map((c) => c.text).join("\n"), erreur: !!r.isError };
    };
    const ecrituresCalendrier = () => gestes.filter((g) => g.args.join("\n").includes("make new event")).length;
    try {
      // l'emploi du temps
      expect((await texte("lire_planning")).texte).toContain("Pas encore d'emploi du temps");
      const creneaux = [
        { debut: "09:00", fin: "11:00", titre: "Biochimie", type: "travail" },
        { debut: "12:30", fin: "13:30", titre: "Déjeuner", type: "repas" },
      ];
      expect((await texte("enregistrer_planning", { creneaux })).texte).toContain("Emploi du temps enregistré (2 créneaux)");
      expect((await texte("lire_planning")).texte).toContain("09:00–11:00 Biochimie (travail)");
      expect((await texte("enregistrer_planning", { creneaux: [{ debut: "11:00", fin: "10:00", titre: "x", type: "travail" }] })).erreur).toBe(true);
      assistant.dernier = { texte: "fais-moi mon emploi du temps", heure: Date.now() - 1000 };
      expect((await texte("preparer_planning_calendrier")).texte).toContain("Rien n'est encore ajouté");
      expect((await texte("ajouter_planning_calendrier")).erreur).toBe(true);
      expect(ecrituresCalendrier()).toBe(0);
      assistant.dernier = { texte: "oui", heure: Date.now() + 10 };
      expect((await texte("ajouter_planning_calendrier")).texte).toBe("Les 2 créneaux sont dans ton Calendrier.");
      expect(ecrituresCalendrier()).toBe(2);
      expect(planning.vue()?.calendrier).toBe(true);
      expect((await texte("preparer_planning_calendrier")).texte).toContain("déjà dans le Calendrier");

      // les mails
      expect((await texte("afficher_mails", { categories: {}, resume: "" })).erreur).toBe(true);
      const tri = await texte("trier_mails", { nombre: 10 });
      expect(tri.texte).toContain("[101] Scolarité <scol@univ.fr> — Planning des partiels");
      expect(tri.texte).toContain("afficher_mails");
      expect((await texte("afficher_mails", { categories: { a_traiter: [101], pubs: [102] }, resume: "Un mail de la fac." })).texte).toContain("2 mails classés");
      expect(triMails.vue()?.categories.map((c) => c.id)).toEqual(["a_traiter", "pubs"]);
      assistant.dernier = { texte: "trie mes mails", heure: Date.now() - 1000 };
      expect((await texte("preparer_rangement", {})).texte).toContain("Prêt à ranger 1 mail(s) dans le dossier « Max - Pubs »");
      expect((await texte("ranger_mails")).erreur).toBe(true);
      expect(gestes.some((g) => g.args.join("\n").includes("move m to boite"))).toBe(false);
      // « oui, range les pubs » dit juste avant la préparation suffit pour ranger ses propres mails
      assistant.dernier = { texte: "oui range les pubs", heure: Date.now() - 1000 };
      expect((await texte("preparer_rangement", {})).texte).toContain("Prêt à ranger");
      expect((await texte("ranger_mails")).texte).toBe("1 mail rangé dans « Max - Pubs ».");

      // les pôles et le sport
      expect((await texte("ouvrir_pole", { pole: "sante", focus: "corps" })).texte).toContain("Son corps en 3D est affiché en grand");
      expect((await texte("ouvrir_pole", { pole: "l'Associé" })).texte).toContain("Fiche Business");
      expect((await texte("ouvrir_pole", { pole: "cuisine" })).erreur).toBe(true);
      expect((await texte("ouvrir_pole", { pole: "accueil" })).texte).toBe("Retour à l'accueil.");
      expect(assistant.appels.filter((a) => a.startsWith("pole:"))).toEqual(["pole:sante:corps", "pole:business", "pole:null"]);
      // Max Ultime, par la voix
      expect((await texte("mode_obscur", { actif: true })).texte).toBe("Mode obscur activé");
      expect((await texte("mode_obscur", { actif: false })).texte).toBe("Mode obscur terminé");
      expect(assistant.appels.filter((a) => a.startsWith("obscur:"))).toEqual(["obscur:true:false", "obscur:false:false"]);
      expect((await texte("noter_seance", { seance: "jambes", note: "squat 80 kg" })).texte).toContain("Séance Jambes notée aujourd'hui");
      expect(sport.vue().faite).toBe("jambes");
      expect((await texte("noter_seance", { seance: "yoga" })).erreur).toBe(true);
      expect((await texte("changer_semaine_sport", { changements: [{ jour: "dimanche", seance: "jambes" }] })).texte).toContain("dimanche : Jambes");
      expect((await texte("lire_sport")).texte).toContain("Quadriceps ×1");
      // ses projets et son journal
      expect((await texte("projet", { nom: "Asclepium", prochaineAction: "Monter la loi 9" })).texte).toContain("Projet mis à jour : Asclepium — vidéos « Loi N » → Monter la loi 9");
      expect((await texte("projet", { nom: "Permis", domaine: "vie", categorie: "Administratif" })).texte).toContain("Projet créé : Permis");
      expect((await texte("projet", { id: "inconnu" })).erreur).toBe(true);
      expect((await texte("ecrire_journal", { texte: "Bonne séance de bio", humeur: 4 })).texte).toBe("Noté dans ton journal.");
      expect((await texte("lire_journal")).texte).toContain("Bonne séance de bio");
      expect(vie.vue().journal?.humeur).toBe(4);
      expect((await texte("demarrer_session", { sujet: "Boutique", minutes: 90, pole: "business" })).texte).toContain("Il reste 1 heure avant la limite du pôle business");
      expect(coach.temps().get("business")?.limite).toBe(60);
      expect((await texte("arreter_session")).erreur).toBe(false);
      expect((await texte("demarrer_session", { sujet: "x", pole: "astrologie" })).erreur).toBe(true);

      // le réveil (pas configuré ici : l'heure se règle quand même, l'essai est refusé)
      expect((await texte("regler_reveil", { heure: "8h" })).texte).toMatch(/Prochain réveil : .*08:00.*pas encore configuré/);
      expect((await texte("etat_reveil")).texte).toContain("pas configuré");
      expect((await texte("essayer_reveil")).erreur).toBe(true);
      expect((await texte("annuler_reveil")).texte).toContain("annulé");
    } finally {
      await client.close();
    }
  }, 30_000);

  it("ouvre les fiches des pôles, note les séances et envoie le sport et le temps par pôle à la page", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const etats: EtatBureau[] = [];
    ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMessage;
      if (m.type === "etat") etats.push(m.etat);
    });
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "pole", pole: "sante", focus: "corps" }));
    ws.send(JSON.stringify({ type: "pole", pole: "cuisine" }));
    ws.send(JSON.stringify({ type: "seance", seance: "pec_dos" }));
    ws.send(JSON.stringify({ type: "semaine-sport", jour: 6, seance: "jambes" }));
    ws.send(JSON.stringify({ type: "session", sujet: "Asclepium", minutes: 20, pole: "business" }));
    for (let i = 0; i < 100 && !coach.vue().minuteur; i++) await new Promise((r) => setTimeout(r, 10));
    expect(assistant.appels.filter((a) => a.startsWith("pole:"))).toEqual(["pole:sante:corps"]);
    expect(sport.vue().faite).toBe("pec_dos");
    expect(sport.semaine()[6]).toBe("jambes");
    expect(coach.vue().minuteur?.pole).toBe("business");
    expect(assistant.appels.some((a) => a.startsWith("informer:Depuis la page : Séance Pec-Dos notée"))).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    const dernier = etats.at(-1)!;
    expect(dernier.sport?.faite).toBe("pec_dos");
    expect(dernier.poles?.map((p) => p.id)).toEqual(["etudes", "sante", "business", "apps", "vie"]);
    expect(dernier.poles?.find((p) => p.id === "business")?.limite).toBe(60);
    ws.close();
  });

  it("change d'écran depuis la page, et revient sur Jarvis au réveil par Siri", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "vue", vue: "bureau" }));
    ws.send(JSON.stringify({ type: "vue", vue: "cuisine" }));
    for (let i = 0; i < 100 && !assistant.appels.includes("vue:bureau"); i++) await new Promise((r) => setTimeout(r, 10));
    await fetch(base + "/api/reveil", { method: "POST", headers: avecJeton() });
    expect(assistant.appels.filter((a) => a.startsWith("vue:") || a === "reveiller")).toEqual(["vue:bureau", "reveiller", "vue:jarvis"]);
    ws.close();
  });

  it("démarre et arrête une session depuis la page", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ type: "session", minutes: 25 }));
    for (let i = 0; i < 100 && !coach.vue().minuteur; i++) await new Promise((r) => setTimeout(r, 10));
    expect(coach.vue().minuteur).toMatchObject({ type: "travail", sujet: "Révisions" });
    ws.send(JSON.stringify({ type: "fin-session" }));
    for (let i = 0; i < 100 && coach.vue().minuteur; i++) await new Promise((r) => setTimeout(r, 10));
    expect(coach.vue().minuteur).toBeNull();
    expect(assistant.appels.filter((x) => x.startsWith("informer:"))).toHaveLength(2);
    const dernier = messages.filter((m) => m.type === "etat").at(-1);
    expect(dernier?.type === "etat" && dernier.etat.conseillers?.map((c) => c.id)).toEqual(["etudes", "sante", "business", "apps", "vie"]);
    ws.close();
  });

  it("les outils MCP sont refusés sans le bon jeton", async () => {
    const mauvais = path.join(tmp(), "jeton");
    fs.writeFileSync(mauvais, "0".repeat(64));
    const transport = new StdioClientTransport({
      command: path.join(RACINE, "node_modules", ".bin", "tsx"),
      args: [path.join(RACINE, "server", "max", "outils-mcp.ts")],
      env: { ...(process.env as Record<string, string>), BUREAU_URL: base, BUREAU_JETON_FICHIER: mauvais },
      stderr: "ignore",
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const r = (await client.callTool({ name: "lancer_mission", arguments: { texte: "x" } })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("Accès refusé");
      expect(manager.snapshot().mission).toBeNull();
    } finally {
      await client.close();
    }
  }, 30_000);
});

describe("verrou par le visage (serveur)", () => {
  const desc = (base: number) => Array.from({ length: 128 }, (_, i) => Math.sin(i * base) * 0.3);
  let root: string;
  let donnees: string;
  let jeton: string;
  let assistant: FauxAssistant;
  let manager: MissionManager;
  let verrou: Verrou;
  let server: ReturnType<typeof createBureauServer>;
  let base: string;
  let modeles: string;

  beforeEach(async () => {
    root = tmp();
    donnees = tmp();
    modeles = tmp();
    fs.writeFileSync(path.join(modeles, "tiny_face_detector_model-weights_manifest.json"), "[]");
    jeton = creerJeton(donnees);
    const config = { ...DEFAULT_CONFIG, dossierMissions: root, dossierDonnees: donnees };
    assistant = new FauxAssistant();
    manager = new MissionManager(config, FAKE);
    const visage = new Visage(donnees);
    visage.enregistrer([desc(1), desc(1), desc(1)], "Johan");
    verrou = new Verrou({ visage, actif: true });
    server = createBureauServer({ config, manager, webDir: tmp(), jeton, assistant, verrou, modelesVisage: modeles });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });
  const avecJeton = () => ({ "x-bureau-jeton": jeton, "content-type": "application/json" });

  async function connecter() {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const messages: ServerMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(String(d))));
    await new Promise((r) => ws.on("open", r));
    const attendre = async (cond: () => boolean) => {
      for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
    };
    return { ws, messages, attendre };
  }

  it("verrouillé : la page ne reçoit rien de personnel et ne peut rien commander", async () => {
    const { ws, messages, attendre } = await connecter();
    await attendre(() => messages.length > 0);
    const premier = messages[0];
    expect(premier.type === "etat" && premier.etat.verrou).toMatchObject({ verrouille: true, enregistre: true, prenom: "Johan" });
    expect(premier.type === "etat" && premier.etat.assistant?.messages).toEqual([]);
    expect(premier.type === "etat" && premier.etat.conseillers).toBeUndefined();
    ws.send(JSON.stringify({ type: "parler-max", texte: "lis mes mails" }));
    ws.send(JSON.stringify({ type: "lancer", texte: "mission" }));
    await attendre(() => messages.filter((m) => m.type === "erreur").length >= 2);
    expect(messages.filter((m) => m.type === "erreur").every((m) => m.type === "erreur" && m.message.includes("verrouillé"))).toBe(true);
    expect(assistant.appels).toEqual([]);
    expect(manager.snapshot().mission).toBeNull();
    expect((await fetch(base + "/api/missions")).status).toBe(423);
    const outil = await fetch(base + "/api/outils/etat", { headers: avecJeton() });
    expect(outil.status).toBe(423);
    ws.close();
  });

  it("Siri ne réveille pas Max verrouillé mais demande la caméra à la page", async () => {
    const r = await (await fetch(base + "/api/reveil", { method: "POST", headers: avecJeton() })).json();
    expect(r.texte).toContain("caméra");
    expect(assistant.appels).toEqual([]);
    expect(verrou.vue().demande).toBeGreaterThan(0);
  });

  it("s'ouvre avec le bon visage qui bouge, puis tout remarche", async () => {
    const { ws, messages, attendre } = await connecter();
    ws.send(JSON.stringify({ type: "visage-verifier", descripteur: desc(7), vivant: true }));
    await attendre(() => messages.some((m) => m.type === "visage"));
    expect(messages.find((m) => m.type === "visage")).toMatchObject({ ok: false, texte: "Je ne te reconnais pas." });
    ws.send(JSON.stringify({ type: "visage-verifier", descripteur: desc(1), vivant: false }));
    ws.send(JSON.stringify({ type: "visage-verifier", descripteur: desc(1), vivant: true }));
    await attendre(() => messages.filter((m) => m.type === "visage").length >= 3);
    expect(messages.filter((m) => m.type === "visage").map((m) => m.type === "visage" && m.ok)).toEqual([false, false, true]);
    expect(verrou.verrouille).toBe(false);
    await attendre(() => messages.some((m) => m.type === "etat" && m.etat.verrou?.verrouille === false && !!m.etat.assistant));
    ws.send(JSON.stringify({ type: "parler-max", texte: "Salut" }));
    await attendre(() => assistant.appels.includes("ecrire:Salut"));
    expect(assistant.appels).toContain("ecrire:Salut");
    expect((await fetch(base + "/api/missions")).status).toBe(200);
    ws.send(JSON.stringify({ type: "verrouiller" }));
    await attendre(() => verrou.verrouille);
    expect(assistant.appels).toContain("veille");
    ws.close();
  });

  it("sert les modèles de reconnaissance, même verrouillé, et rien d'autre", async () => {
    expect((await fetch(base + "/modeles-visage/tiny_face_detector_model-weights_manifest.json")).status).toBe(200);
    expect((await fetch(base + "/modeles-visage/../jeton")).status).not.toBe(200);
    expect((await fetch(base + "/modeles-visage/absent.bin")).status).toBe(404);
  });
});
