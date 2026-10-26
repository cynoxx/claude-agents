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
    expect(a.join(" ")).toMatch(/atrim=0:14.*if\(lt\(t,5\),1.*0\.25.*afade=t=out/);
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
    expect(lignesIntro(e)).toEqual([
      { texte: "Voix", ok: true },
      { texte: "Oreille", ok: false },
      { texte: "Cerveau", ok: true },
      { texte: "Agenda", ok: true },
      { texte: "5 pôles", ok: true },
    ]);
  });
});
