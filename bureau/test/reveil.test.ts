import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Reveil, estReveille, lireHeure, type AppelleurLike } from "../server/max/reveil.ts";
import { Twilio, twimlReveil, type Recuperer } from "../server/max/twilio.ts";
import { dureeWav, preparerAppel, texteReveil } from "../server/max/message-reveil.ts";
import { decalerHeure, quandReveil } from "../web/poles-pur.ts";
import type { EtatAppel } from "../server/max/twilio.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-reveil-"));
const local = (j: string, h: string) => new Date(`${j}T${h}:00`);

class FauxAppelleur implements AppelleurLike {
  appels: { vers: string; twiml: string }[] = [];
  reponses: EtatAppel[] = [];
  async appeler(vers: string, twiml: string) {
    this.appels.push({ vers, twiml });
    return `CA${this.appels.length}`;
  }
  async etat() {
    return this.reponses.shift() ?? { statut: "no-answer", duree: 0, reponduPar: null };
  }
}

describe("heures du réveil", () => {
  it("lit les heures dites ou écrites", () => {
    expect(lireHeure("7h")).toBe("07:00");
    expect(lireHeure("6 h 45")).toBe("06:45");
    expect(lireHeure("07:30")).toBe("07:30");
    expect(lireHeure("25h")).toBeNull();
    expect(decalerHeure("07:00", -15)).toBe("06:45");
    expect(decalerHeure("23:50", 15)).toBe("00:05");
  });

  it("considère réveillé seulement quelqu'un qui a décroché et écouté (pas la messagerie)", () => {
    expect(estReveille({ statut: "completed", duree: 35, reponduPar: "human" })).toBe(true);
    expect(estReveille({ statut: "completed", duree: 35, reponduPar: null })).toBe(true);
    expect(estReveille({ statut: "completed", duree: 6, reponduPar: "human" })).toBe(false);
    expect(estReveille({ statut: "completed", duree: 40, reponduPar: "machine_end_beep" })).toBe(false);
    expect(estReveille({ statut: "no-answer", duree: 0, reponduPar: null })).toBe(false);
  });

  it("affiche le prochain réveil simplement", () => {
    const m = local("2026-10-26", "22:00");
    expect(quandReveil(local("2026-10-27", "07:00").toISOString(), m)).toBe("demain 07:00");
    expect(quandReveil(local("2026-10-26", "23:30").toISOString(), m)).toBe("aujourd'hui 23:30");
    expect(quandReveil(null, m)).toBe("aucun");
  });
});

describe("Reveil", () => {
  let d: string;
  let tel: FauxAppelleur;
  let r: Reveil;
  let preparations: Date[];
  const creer = (o: Partial<ConstructorParameters<typeof Reveil>[0]> = {}) =>
    new Reveil({
      dossierDonnees: d,
      telephone: "+33612345678",
      appelleur: tel,
      heureDefaut: "07:00",
      rappelMinutes: 5,
      essais: 3,
      attentePoll: 10,
      preparer: async (h) => {
        preparations.push(h);
        return "<Response><Say>Debout</Say></Response>";
      },
      ...o,
    });
  beforeEach(() => {
    vi.useFakeTimers({ now: local("2026-10-26", "22:30") });
    d = tmp();
    tel = new FauxAppelleur();
    preparations = [];
    r = creer();
  });
  afterEach(() => {
    r.fermer();
    vi.useRealTimers();
  });

  it("prévoit 7 h par défaut, se règle pour le lendemain, ou pour tous les jours, et s'annule", () => {
    expect(r.prochain()).toEqual(local("2026-10-27", "07:00"));
    expect(r.regler("8h").texte).toContain("Prochain réveil : mardi 27 à 08:00");
    expect(r.prochain()).toEqual(local("2026-10-27", "08:00"));
    // la règle du lendemain ne change pas les jours suivants
    expect(r.prochain(local("2026-10-27", "09:00"))).toEqual(local("2026-10-28", "07:00"));
    r.regler("06:30", { quotidien: true });
    expect(r.prochain(local("2026-10-27", "09:00"))).toEqual(local("2026-10-28", "06:30"));
    expect(r.annulerProchain().ok).toBe(true);
    expect(r.prochain()).toEqual(local("2026-10-28", "06:30"));
    expect(creer().prochain()).toEqual(local("2026-10-28", "06:30")); // gardé dans un fichier
    expect(r.regler("midi").ok).toBe(false);
  });

  it("prépare le message 10 minutes avant, appelle à l'heure, et s'arrête quand il a décroché et écouté", async () => {
    tel.reponses = [{ statut: "in-progress", duree: 0, reponduPar: "human" }, { statut: "completed", duree: 32, reponduPar: "human" }];
    const evenements: string[] = [];
    r.on("reveille", () => evenements.push("reveille"));
    r.demarrer();
    await vi.advanceTimersByTimeAsync(local("2026-10-27", "06:51").getTime() - Date.now());
    expect(preparations).toHaveLength(1);
    expect(tel.appels).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(tel.appels).toEqual([{ vers: "+33612345678", twiml: "<Response><Say>Debout</Say></Response>" }]);
    expect(preparations).toHaveLength(1); // le message préparé est réutilisé
    expect(evenements).toEqual(["reveille"]);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(tel.appels).toHaveLength(1);
  });

  it("rappelle toutes les 5 minutes s'il ne répond pas (la messagerie ne compte pas), puis abandonne", async () => {
    tel.reponses = [{ statut: "completed", duree: 40, reponduPar: "machine_start" }];
    let echecs = 0;
    r.on("echec", () => echecs++);
    vi.setSystemTime(local("2026-10-27", "06:59"));
    r.demarrer();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(tel.appels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(tel.appels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(tel.appels).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(tel.appels).toHaveLength(3);
    expect(echecs).toBe(1);
    expect(r.vue().enCours).toBe(false);
  });

  it("arrête de rappeler dès qu'il parle à Max", async () => {
    vi.setSystemTime(local("2026-10-27", "06:59"));
    r.demarrer();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(tel.appels).toHaveLength(1);
    expect(r.vue().enCours).toBe(true);
    r.confirmer();
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(tel.appels).toHaveLength(1);
  });

  it("n'appelle pas deux fois le même réveil après un redémarrage du Bureau", async () => {
    tel.reponses = [{ statut: "completed", duree: 30, reponduPar: "human" }];
    vi.setSystemTime(local("2026-10-27", "07:00"));
    r.demarrer();
    await vi.advanceTimersByTimeAsync(60_000);
    r.fermer();
    const r2 = creer();
    r2.demarrer();
    await vi.advanceTimersByTimeAsync(60_000);
    r2.fermer();
    expect(tel.appels).toHaveLength(1);
  });

  it("sans numéro ni Twilio : rien n'est appelé, et Max le sait", async () => {
    r = creer({ telephone: null, appelleur: null });
    expect(r.vue()).toMatchObject({ configure: false, heure: "07:00" });
    expect(r.decrire()).toContain("pas configuré");
    expect((await r.essayer()).ok).toBe(false);
  });
});

describe("Twilio", () => {
  it("passe l'appel avec la détection du répondeur, et lit son état", async () => {
    const requetes: { url: string; method: string; body?: string; auth: string }[] = [];
    const recuperer: Recuperer = async (url, init) => {
      requetes.push({ url, method: init.method, body: typeof init.body === "string" ? init.body : undefined, auth: init.headers.authorization });
      return { ok: true, status: 200, json: async () => (init.method === "POST" ? { sid: "CA123" } : { status: "completed", duration: "31", answered_by: "human" }) };
    };
    const t = new Twilio({ compte: "AC1", jeton: "secret", numero: "+15550001111" }, { dossierDonnees: tmp(), recuperer });
    expect(await t.appeler("+33612345678", "<Response/>")).toBe("CA123");
    const corps = new URLSearchParams(requetes[0].body);
    expect(requetes[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json");
    expect(Object.fromEntries(corps)).toMatchObject({ To: "+33612345678", From: "+15550001111", Twiml: "<Response/>", MachineDetection: "Enable" });
    expect(requetes[0].auth).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);
    expect(await t.etat("CA123")).toEqual({ statut: "completed", duree: 31, reponduPar: "human" });
  });

  it("dépose le message audio (service créé une fois) et renvoie son adresse", async () => {
    const d = tmp();
    const mp3 = path.join(d, "reveil.mp3");
    fs.writeFileSync(mp3, "audio");
    const urls: string[] = [];
    const recuperer: Recuperer = async (url, init) => {
      urls.push(`${init.method} ${url.replace(/^https:\/\/[^/]+/, "")}`);
      const j =
        url.endsWith("/Services?PageSize=50") ? { services: [] }
        : url.endsWith("/Services") ? { sid: "ZS1" }
        : url.endsWith("/Environments") && init.method === "GET" ? { environments: [] }
        : url.endsWith("/Environments") ? { sid: "ZE1", domain_name: "max-reveil-1234-reveil.twil.io" }
        : url.endsWith("/Assets") ? { sid: "ZH1" }
        : url.endsWith("/Versions") ? { sid: "ZN1" }
        : url.endsWith("/Builds") ? { sid: "ZB1" }
        : url.endsWith("/Status") ? { status: "completed" }
        : { sid: "ZD1" };
      return { ok: true, status: 200, json: async () => j };
    };
    const t = new Twilio({ compte: "AC1", jeton: "s", numero: "+1" }, { dossierDonnees: d, recuperer, attente: async () => {} });
    const url = await t.deposerAudio(mp3);
    expect(url).toMatch(/^https:\/\/max-reveil-1234-reveil\.twil\.io\/reveil-[0-9a-f]{24}\.mp3$/);
    expect(urls).toContain("POST /v1/Services/ZS1/Assets/ZH1/Versions");
    expect(urls).toContain("POST /v1/Services/ZS1/Environments/ZE1/Deployments");
    urls.length = 0;
    await t.deposerAudio(mp3);
    expect(urls.some((u) => u.includes("PageSize"))).toBe(false); // service retenu
  });

  it("refuse proprement une erreur de Twilio", async () => {
    const t = new Twilio({ compte: "AC1", jeton: "x", numero: "+1" }, { dossierDonnees: tmp(), recuperer: async () => ({ ok: false, status: 401, json: async () => ({ message: "Authenticate" }) }) });
    await expect(t.appeler("+33", "<Response/>")).rejects.toThrow("Twilio (401) : Authenticate");
  });
});

describe("message du réveil", () => {
  it("dit l'heure, l'échéance et la séance du jour", () => {
    const t = texteReveil({ prenom: "Johan", heure: local("2026-10-27", "07:00"), echeance: { nom: "l'examen PASS", jours: 48 }, seance: "Jambes" });
    expect(t).toBe("Debout Johan ! C'est Max. Il est 7 heures. Plus que 48 jours avant l'examen PASS. Chaque matin compte. Aujourd'hui, séance Jambes. Pieds par terre, ouvre les volets et bois un grand verre d'eau. Je t'attends sur le Mac pour lancer la journée.");
    expect(texteReveil({ heure: local("2026-10-27", "06:45"), seance: "Repos" })).toContain("Il est 6 heures 45. Aujourd'hui, c'est repos");
  });

  it("joue la voix de Max sur la musique, sinon lit le texte avec une voix Twilio", async () => {
    const d = tmp();
    const ok = await preparerAppel({
      texte: "Debout & vite",
      voixTwilio: "Polly.Remi-Neural",
      dossier: d,
      outils: { enregistrer: async () => true, mixer: async (_v, _d, s) => s, deposer: async () => "https://x.twil.io/r.mp3" },
    });
    expect(ok).toBe(`<Response><Play>https://x.twil.io/r.mp3</Play><Pause length="1"/><Say language="fr-FR" voice="Polly.Remi-Neural">Allez, debout ! Si tu raccroches trop vite, je te rappelle dans cinq minutes.</Say></Response>`);
    const secours = await preparerAppel({
      texte: "Debout & vite",
      voixTwilio: "Polly.Remi-Neural",
      dossier: d,
      outils: { enregistrer: async () => true, mixer: async () => null, deposer: async () => "x" },
    });
    expect(secours).toContain("<Say language=\"fr-FR\" voice=\"Polly.Remi-Neural\">Debout &amp; vite</Say>");
    const panne = await preparerAppel({ texte: "a", voixTwilio: "v", dossier: d, outils: { enregistrer: async () => { throw new Error("x"); }, mixer: async () => null, deposer: async () => "" } });
    expect(panne).toContain("<Say");
    expect(twimlReveil({ audio: null, texte: "<b>", voix: "v", relance: "r" })).toContain("&lt;b&gt;");
  });

  it("lit la durée d'un WAV", () => {
    const d = tmp();
    const f = path.join(d, "v.wav");
    const donnees = Buffer.alloc(22050 * 2 * 3); // 3 s, 16 bits mono 22,05 kHz
    const h = Buffer.alloc(44);
    h.write("RIFF", 0);
    h.writeUInt32LE(36 + donnees.length, 4);
    h.write("WAVE", 8);
    h.write("fmt ", 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(22050, 24);
    h.writeUInt32LE(44100, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write("data", 36);
    h.writeUInt32LE(donnees.length, 40);
    fs.writeFileSync(f, Buffer.concat([h, donnees]));
    expect(dureeWav(f)).toBeCloseTo(3);
    expect(dureeWav(path.join(d, "absent.wav"))).toBe(0);
  });
});
