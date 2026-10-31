import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Oreille, argsFfmpegFichier, argsFfmpegMicro } from "../server/voix/oreille.ts";
import { transcrire } from "../server/voix/whisper.ts";

const FAKE_FFMPEG = path.join(__dirname, "fake-ffmpeg.mjs");
const FIXTURE = path.join(__dirname, "fixtures", "max-italie.wav");
const envAvant = { ...process.env };
afterEach(() => {
  process.env = { ...envAvant };
});

function ecouter(o: Oreille) {
  const phrases: string[] = [];
  const erreurs: string[] = [];
  o.on("phrase", (t: string) => phrases.push(t));
  o.on("erreur", (m: string) => erreurs.push(m));
  const fin = new Promise<void>((r) => o.once("arret", () => r()));
  return { phrases, erreurs, fin };
}
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("arguments d'ffmpeg", () => {
  it("lit le micro choisi en PCM 16 bits mono 16 kHz", () => {
    expect(argsFfmpegMicro(":2")).toEqual(["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", ":2", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]);
  });
  it("peut lire un fichier (essais), en temps réel ou non", () => {
    expect(argsFfmpegFichier("/a.wav", false)).toEqual(["-hide_banner", "-loglevel", "error", "-i", "/a.wav", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]);
    expect(argsFfmpegFichier("/a.wav", true)).toContain("-re");
  });
});

describe("Oreille", () => {
  it("entend une phrase, l'envoie à Whisper en WAV et la transmet", async () => {
    const recus: Buffer[] = [];
    const o = new Oreille({
      commande: { bin: process.execPath, args: [FAKE_FFMPEG] },
      transcrire: async (wav) => {
        recus.push(wav);
        return "Max, bonjour";
      },
    });
    const { phrases, erreurs, fin } = ecouter(o);
    o.demarrer();
    await fin;
    await attendre(50);
    expect(erreurs).toEqual([]);
    expect(phrases).toEqual(["Max, bonjour"]);
    expect(recus).toHaveLength(1);
    expect(recus[0].toString("ascii", 0, 4)).toBe("RIFF");
  });

  it("ne transcrit rien quand elle est muette (Max parle)", async () => {
    let appels = 0;
    const o = new Oreille({ commande: { bin: process.execPath, args: [FAKE_FFMPEG] }, transcrire: async () => (appels++, "Max, bonjour") });
    const { phrases, fin } = ecouter(o);
    o.muet = true;
    o.demarrer();
    await fin;
    expect(appels).toBe(0);
    expect(phrases).toEqual([]);
  });

  it("jette ce que Whisper invente sur du bruit", async () => {
    const o = new Oreille({ commande: { bin: process.execPath, args: [FAKE_FFMPEG] }, transcrire: async () => "Sous-titres réalisés par la communauté d'Amara.org" });
    const { phrases, fin } = ecouter(o);
    o.demarrer();
    await fin;
    await attendre(50);
    expect(phrases).toEqual([]);
  });

  it("signale une transcription qui échoue sans s'arrêter", async () => {
    const o = new Oreille({
      commande: { bin: process.execPath, args: [FAKE_FFMPEG] },
      transcrire: async () => {
        throw new Error("modèle introuvable");
      },
    });
    const { erreurs, fin } = ecouter(o);
    o.demarrer();
    await fin;
    await attendre(50);
    expect(erreurs).toEqual(["Transcription impossible : modèle introuvable"]);
  });

  it("explique quand le micro est refusé", async () => {
    process.env.FAKE_FFMPEG = "erreur";
    const o = new Oreille({ commande: { bin: process.execPath, args: [FAKE_FFMPEG] }, transcrire: async () => "" });
    const { erreurs, fin } = ecouter(o);
    o.demarrer();
    await fin;
    expect(erreurs[0]).toContain("accès au micro refusé");
    expect(o.active).toBe(false);
  });

  it("explique quand ffmpeg n'est pas installé", async () => {
    const o = new Oreille({ commande: { bin: "/nexiste/pas/ffmpeg", args: [] }, transcrire: async () => "" });
    const { erreurs, fin } = ecouter(o);
    o.demarrer();
    await fin;
    expect(erreurs[0]).toMatch(/ffmpeg introuvable/);
  });

  it("coupe vraiment le micro quand on l'arrête", async () => {
    process.env.FAKE_FFMPEG = "infini";
    const o = new Oreille({ commande: { bin: process.execPath, args: [FAKE_FFMPEG] }, transcrire: async () => "" });
    const { fin } = ecouter(o);
    o.demarrer();
    await attendre(200);
    expect(o.active).toBe(true);
    o.arreter();
    await fin;
    expect(o.active).toBe(false);
  });
});

describe("transcrire", () => {
  it("explique quand whisper-cli n'est pas installé", async () => {
    await expect(transcrire({ bin: "/nexiste/pas/whisper-cli", modele: "/m.bin" }, Buffer.alloc(44))).rejects.toThrow(/whisper-cli introuvable/);
  });
});

// Essai réel : ffmpeg + whisper-cli sur une vraie phrase en français, si les outils sont là.
const WHISPER_BIN = process.env.WHISPER_BIN;
const WHISPER_MODELE = process.env.WHISPER_MODELE;
const reel = !!WHISPER_BIN && !!WHISPER_MODELE && fs.existsSync(WHISPER_BIN) && fs.existsSync(WHISPER_MODELE);

describe.skipIf(!reel)("Oreille réelle (ffmpeg + whisper-cli)", () => {
  it("entend « Max, quelle est la capitale de l'Italie ? » dans un vrai fichier audio", async () => {
    const o = new Oreille({
      commande: { bin: "ffmpeg", args: argsFfmpegFichier(FIXTURE, false) },
      transcrire: (wav) => transcrire({ bin: WHISPER_BIN!, modele: WHISPER_MODELE! }, wav),
    });
    const { phrases, erreurs, fin } = ecouter(o);
    o.demarrer();
    await fin;
    for (let i = 0; i < 100 && !phrases.length && !erreurs.length; i++) await attendre(100);
    expect(erreurs).toEqual([]);
    expect(phrases).toHaveLength(1);
    expect(phrases[0].toLowerCase()).toContain("max");
    expect(phrases[0].toLowerCase()).toContain("italie");
  }, 60_000);
});
