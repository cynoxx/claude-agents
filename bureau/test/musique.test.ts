import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Musique, PAROLE_APRES_MS, argsIntro, argsMixReveil } from "../server/max/musique.ts";
import { introAJouer, lignesIntro } from "../web/intro.ts";
import type { EtatBureau } from "../shared/protocol.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-musique-"));

describe("musique de Max", () => {
  afterEach(() => vi.useRealTimers());

  it("prépare l'intro : forte au début, puis baissée sous la voix, fondu final", () => {
    const a = argsIntro("/m.mp3", "/o.wav");
    expect(a).toContain("/m.mp3");
    expect(a.join(" ")).toMatch(/atrim=0:60.*if\(lt\(t,5\),1.*0\.15.*afade=t=out/);
    const r = argsMixReveil("/m.mp3", "/v.wav", "/r.mp3", 20);
    expect(r.join(" ")).toContain("adelay=4000|4000");
    expect(r.join(" ")).toContain("atrim=0:28");
    expect(r.slice(-1)[0]).toBe("/r.mp3");
  });

  it("joue l'intro avec le fichier (préparé une seule fois) et dit quand Max peut parler", async () => {
    const d = tmp();
    const source = path.join(d, "max.mp3");
    fs.writeFileSync(source, "mp3");
    const appels: string[][] = [];
    const m = new Musique({
      source,
      dossier: path.join(d, "cache"),
      ffmpeg: "ffmpeg",
      lecteur: "true",
      executer: async (_bin, args) => {
        appels.push(args);
        fs.writeFileSync(args.at(-1)!, "wav");
        return { code: 0, stderr: "" };
      },
    });
    const intros: number[] = [];
    m.on("intro", (t) => intros.push(t));
    expect(m.jouerIntro()).toBe(PAROLE_APRES_MS);
    await new Promise((r) => setTimeout(r, 30));
    m.jouerIntro();
    await new Promise((r) => setTimeout(r, 30));
    expect(intros).toHaveLength(2);
    expect(appels).toHaveLength(1); // l'extrait est gardé
  });

  it("retrouve ton mp3 par son nom (Téléchargements…), le copie à sa place, et prend le plus récent", async () => {
    const maison = tmp();
    fs.mkdirSync(path.join(maison, "Downloads"));
    fs.mkdirSync(path.join(maison, "Desktop"));
    fs.writeFileSync(path.join(maison, "Downloads", "Cars_1_Real_Gone.mp3"), "ancien");
    fs.writeFileSync(path.join(maison, "Downloads", "autre-chanson.mp3"), "non");
    fs.writeFileSync(path.join(maison, "Desktop", "Real Gone (1).mp3"), "recent");
    fs.utimesSync(path.join(maison, "Downloads", "Cars_1_Real_Gone.mp3"), new Date("2026-01-01"), new Date("2026-01-01"));
    const source = path.join(maison, "Documents", "Bureau", "musique", "max.mp3");
    const m = new Musique({ source, recherche: "real.?gone", maison, dossier: tmp(), ffmpeg: "ffmpeg", lecteur: null });
    expect(m.disponible).toBe(false);
    expect(await m.chercher()).toBe(path.join(maison, "Desktop", "Real Gone (1).mp3"));
    expect(fs.readFileSync(source, "utf8")).toBe("recent");
    expect(m.disponible).toBe(true);
    expect(await m.chercher()).toBe(source); // déjà en place : rien à refaire
  });

  it("cherche avec Spotlight quand il n'est dans aucun dossier habituel, et dit quand il ne trouve rien", async () => {
    const maison = tmp();
    const ailleurs = path.join(tmp(), "Cars_1_Real_Gone.mp3");
    fs.writeFileSync(ailleurs, "mp3");
    const source = path.join(maison, "max.mp3");
    const rien = new Musique({ source, recherche: "real.?gone", maison, dossier: tmp(), ffmpeg: "ffmpeg", lecteur: null, recherchePar: async () => [] });
    expect(await rien.chercher()).toBeNull();
    const spot = new Musique({ source, recherche: "real.?gone", maison, dossier: tmp(), ffmpeg: "ffmpeg", lecteur: null, recherchePar: async () => [ailleurs, "/x/autre.mp3"] });
    expect(await spot.chercher()).toBe(ailleurs);
    expect(spot.disponible).toBe(true);
  });

  it("sans fichier de musique : l'animation seule, et Max parle presque tout de suite", () => {
    const m = new Musique({ source: "/nexiste/pas.mp3", dossier: tmp(), ffmpeg: "ffmpeg", lecteur: "afplay" });
    const intros: number[] = [];
    m.on("intro", (t) => intros.push(t));
    expect(m.disponible).toBe(false);
    expect(m.jouerIntro()).toBe(1200);
    expect(intros).toHaveLength(1);
  });
});

describe("intro de la page", () => {
  it("ne joue qu'un lancement nouveau et récent", () => {
    expect(introAJouer(undefined, 0, 1000)).toBe(false);
    expect(introAJouer(10_000, 0, 12_000)).toBe(true);
    expect(introAJouer(10_000, 10_000, 12_000)).toBe(false);
    expect(introAJouer(10_000, 0, 30_000)).toBe(false);
  });

  it("annonce l'état réel de ses systèmes", () => {
    const e = {
      claude: { ok: true },
      mission: null,
      assistant: { bouche: { ok: true }, oreille: { ok: false }, cerveau: { ok: true } },
      jarvis: { meteo: null, agenda: [] },
      conseillers: [{}, {}, {}, {}, {}],
    } as unknown as EtatBureau;
    expect(lignesIntro({ ...e, musique: true })[0]).toEqual({ texte: "Musique", ok: true });
    expect(lignesIntro(e)).toEqual([
      { texte: "Voix", ok: true },
      { texte: "Oreille", ok: false },
      { texte: "Cerveau", ok: true },
      { texte: "Agenda", ok: true },
      { texte: "5 pôles", ok: true },
    ]);
  });
});
