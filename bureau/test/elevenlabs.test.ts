import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AvecSecours, ElevenLabs, messageErreur, nettoyerCache, type Recuperer } from "../server/voix/elevenlabs.ts";
import { classerVoix, enregistrerChoix, scoreVoix, type VoixPartagee } from "../server/voix/choix-voix.ts";
import type { PiperLike } from "../server/voix/bouche.ts";
import { DEFAULT_CONFIG, loadConfig } from "../server/config.ts";
import { moteurVoix } from "../server/voix/voix-config.ts";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-el-"));
});

const REGLAGES = { ...DEFAULT_CONFIG.voix.elevenlabs, cle: "sk_test", voix: "VOIX1", nomVoix: "Guillaume" };

function faux(o: { status?: number; corps?: unknown } = {}) {
  const appels: { url: string; body: Record<string, unknown> | null; entetes: Record<string, string> }[] = [];
  const recuperer: Recuperer = async (url, init) => {
    appels.push({ url, body: init.body ? JSON.parse(init.body) : null, entetes: init.headers });
    if (url.includes("/v1/user/subscription")) return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ character_count: 1200, character_limit: 10000 }) };
    const status = o.status ?? 200;
    const pcm = new Int16Array([0, 1000, -1000, 500]);
    return { ok: status === 200, status, arrayBuffer: async () => pcm.buffer, json: async () => o.corps ?? {} };
  };
  return { appels, recuperer };
}

describe("la voix humaine de Max (ElevenLabs)", () => {
  it("transforme une phrase en WAV, avec la bonne voix, le bon modèle et la clé", async () => {
    const f = faux();
    const el = new ElevenLabs(REGLAGES, { dossierCache: path.join(dir, "cache"), recuperer: f.recuperer });
    await el.demarrer();
    expect(el.quota).toMatchObject({ utilises: 1200, limite: 10000 });
    const fichier = path.join(dir, "a.wav");
    await el.synthetiser("Bonjour, ici Max.", fichier);
    const wav = fs.readFileSync(fichier);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.length).toBe(44 + 8);
    const appel = f.appels.at(-1)!;
    expect(appel.url).toContain("/v1/text-to-speech/VOIX1?output_format=pcm_24000");
    expect(appel.entetes["xi-api-key"]).toBe("sk_test");
    expect(appel.body).toMatchObject({ text: "Bonjour, ici Max.", model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, speed: 1 } });
    // multilingual v2 refuse language_code
    expect(appel.body).not.toHaveProperty("language_code");
  });

  it("donne la phrase d'avant pour garder le même ton, et le français aux modèles rapides", async () => {
    const f = faux();
    const el = new ElevenLabs({ ...REGLAGES, modele: "eleven_flash_v2_5" }, { dossierCache: path.join(dir, "cache"), recuperer: f.recuperer });
    await el.synthetiser("Première phrase, un peu plus longue que les autres pour ne pas être gardée en cache ce coup-ci, voilà voilà voilà.", path.join(dir, "1.wav"));
    await el.synthetiser("Deuxième.", path.join(dir, "2.wav"));
    expect(f.appels[1].body).toMatchObject({ language_code: "fr", previous_text: expect.stringContaining("Première phrase") });
  });

  it("garde les phrases courtes en cache : la même phrase ne coûte qu'une fois", async () => {
    const f = faux();
    const el = new ElevenLabs(REGLAGES, { dossierCache: path.join(dir, "cache"), recuperer: f.recuperer });
    await el.synthetiser("Je t'écoute.", path.join(dir, "1.wav"));
    await el.synthetiser("Je t'écoute.", path.join(dir, "2.wav"));
    expect(f.appels.filter((a) => a.url.includes("text-to-speech"))).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, "2.wav"))).toEqual(fs.readFileSync(path.join(dir, "1.wav")));
  });

  it("dit clairement ce qui ne va pas", () => {
    expect(messageErreur(401, { detail: { status: "quota_exceeded", message: "…" } })).toBe("le quota du mois est épuisé");
    expect(messageErreur(401, { detail: { status: "invalid_api_key" } })).toBe("la clé API est refusée");
    expect(messageErreur(404, null)).toBe("la voix est introuvable dans ton compte");
  });

  it("refuse de démarrer sans clé ou sans voix", async () => {
    await expect(new ElevenLabs({ ...REGLAGES, cle: "" }, { dossierCache: dir, recuperer: faux().recuperer }).demarrer()).rejects.toThrow(/clé/);
    await expect(new ElevenLabs({ ...REGLAGES, voix: null }, { dossierCache: dir, recuperer: faux().recuperer }).demarrer()).rejects.toThrow(/voix-humaine/);
  });

  it("quota épuisé : la voix de secours prend le relais, et on n'insiste pas à chaque phrase", async () => {
    const f = faux({ status: 401, corps: { detail: { status: "quota_exceeded" } } });
    const el = new ElevenLabs(REGLAGES, { dossierCache: path.join(dir, "cache"), recuperer: f.recuperer });
    const dits: string[] = [];
    const secours: PiperLike = { demarrer: async () => {}, arreter: () => {}, synthetiser: async (t, fichier) => (dits.push(t), fs.writeFileSync(fichier, "x")) };
    const journal: string[] = [];
    const avec = new AvecSecours(el, [secours], { journal: (m) => journal.push(m) });
    await avec.synthetiser("Une phrase un peu longue pour ne pas passer par le cache, voilà, et encore un peu plus de texte ici même.", path.join(dir, "1.wav"));
    await avec.synthetiser("Une autre phrase un peu longue pour ne pas passer par le cache, voilà, et encore un peu plus de texte ici.", path.join(dir, "2.wav"));
    expect(dits).toHaveLength(2);
    expect(f.appels.filter((a) => a.url.includes("text-to-speech"))).toHaveLength(1);
    expect(avec.panne).toBe("le quota du mois est épuisé");
    expect(journal).toHaveLength(1);
  });

  it("démarre quand même avec la voix de secours si ElevenLabs refuse la clé", async () => {
    const recuperer: Recuperer = async () => ({ ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0), json: async () => ({ detail: { status: "invalid_api_key" } }) });
    const el = new ElevenLabs(REGLAGES, { dossierCache: dir, recuperer });
    const secours: PiperLike = { demarrer: async () => {}, arreter: () => {}, synthetiser: async (_t, f) => fs.writeFileSync(f, "x") };
    const avec = new AvecSecours(el, [secours], { journal: () => {} });
    await avec.demarrer();
    expect(avec.panne).toMatch(/clé API est refusée/);
    await avec.synthetiser("Salut.", path.join(dir, "s.wav"));
    expect(fs.existsSync(path.join(dir, "s.wav"))).toBe(true);
  });

  it("le cache ne grossit pas sans fin", () => {
    for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, `${i}.wav`), "x");
    nettoyerCache(dir, 4);
    expect(fs.readdirSync(dir)).toHaveLength(4);
  });
});

describe("le choix de la voix", () => {
  const v = (x: Partial<VoixPartagee>): VoixPartagee => ({ public_owner_id: "p", voice_id: x.name ?? "v", name: "v", preview_url: "https://x/p.mp3", ...x });

  it("préfère un homme français, grave et posé, à une voix jeune ou de dessin animé", () => {
    const grave = v({ name: "Guillaume", gender: "male", language: "fr", descriptive: "deep", age: "middle_aged", use_case: "narrative_story" });
    const jeune = v({ name: "Léo", gender: "male", language: "fr", descriptive: "excited", age: "young" });
    const femme = v({ name: "Claire", gender: "female", language: "fr", descriptive: "calm" });
    expect(scoreVoix(grave)).toBeGreaterThan(scoreVoix(femme));
    expect(scoreVoix(grave)).toBeGreaterThan(scoreVoix(jeune));
    const sans = v({ name: "Sans extrait", gender: "male", language: "fr", descriptive: "deep", preview_url: null });
    const payante = v({ name: "Payante", gender: "male", language: "fr", descriptive: "deep", free_users_allowed: false });
    expect(classerVoix([jeune, grave, femme, sans, payante, grave], { gratuit: true }).map((x) => x.name)).toEqual(["Guillaume", "Claire", "Léo"]);
    expect(classerVoix([payante], { gratuit: false }).map((x) => x.name)).toEqual(["Payante"]);
  });

  it("retient la clé et la voix dans bureau.config.json, sans toucher au reste", () => {
    const f = path.join(dir, "bureau.config.json");
    fs.writeFileSync(f, JSON.stringify({ port: 4800, voix: { debit: 190 }, reveil: { heure: "07:00" } }));
    enregistrerChoix(f, { cle: "sk_x", voix: "ID9", nomVoix: "Guillaume" });
    const c = loadConfig(dir);
    expect(c.port).toBe(4800);
    expect(c.voix.debit).toBe(190);
    expect(c.voix.elevenlabs).toMatchObject({ cle: "sk_x", voix: "ID9", nomVoix: "Guillaume", modele: "eleven_multilingual_v2" });
    expect(moteurVoix(c)).toBe("elevenlabs");
    // sans clé ni voix : la voix d'avant
    expect(moteurVoix(loadConfig(fs.mkdtempSync(path.join(os.tmpdir(), "vide-"))))).not.toBe("elevenlabs");
  });
});
