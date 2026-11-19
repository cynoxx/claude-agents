import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../server/config.ts";
import { grouperMots, legende, lireMotsWhisper, sousTitresAss, titreDepuisFichier } from "../server/studio/montage.ts";
import { jourLibre, Studio, type Executer } from "../server/studio/studio.ts";

const aFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const comptes = DEFAULT_CONFIG.studio.comptes;
const asclepium = comptes[0];

describe("Studio — montage", () => {
  it("lit les mots minutés de Whisper", () => {
    const j = JSON.stringify({ transcription: [{ offsets: { from: 0, to: 400 }, text: " Bonjour" }, { offsets: { from: 400, to: 500 }, text: " [Musique]" }, { offsets: { from: 500, to: 900 }, text: " toi." }] });
    expect(lireMotsWhisper(j)).toEqual([
      { texte: "Bonjour", debut: 0, fin: 0.4 },
      { texte: "toi.", debut: 0.5, fin: 0.9 },
    ]);
  });

  it("groupe les mots par trois, coupe à la ponctuation et aux blancs", () => {
    const m = (texte: string, debut: number) => ({ texte, debut, fin: debut + 0.2 });
    const g = grouperMots([m("Un", 0), m("deux", 0.2), m("trois", 0.4), m("quatre.", 0.6), m("Cinq", 0.8), m("six", 2)]);
    expect(g.map((x) => x.map((y) => y.texte).join(" "))).toEqual(["Un deux trois", "quatre.", "Cinq", "six"]);
  });

  it("écrit des sous-titres ASS : accroche, titre, mot dit en couleur, appel final", () => {
    const ass = sousTitresAss([{ texte: "discipline", debut: 1.5, fin: 2 }], 6, { titre: "Loi 9", bandeau: "48 lois", appel: "Lien en bio", couleur: "#FFD23F" });
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toMatch(/Dialogue: 0,0:00:01\.20,0:00:06\.00,Titre,,0,0,0,,\{\\fad\(250,0\)\}LOI 9/);
    expect(ass).toContain("{\\c&H3FD2FF&}DISCIPLINE{\\c&HFFFFFF&}");
    expect(ass).toMatch(/0:00:03\.50,0:00:06\.00,Appel,.*Lien en bio/);
  });

  it("fait la légende et le titre depuis le nom du fichier", () => {
    expect(legende(asclepium.legende, "Loi 9", "La discipline bat le talent. Toujours.")).toMatch(/^Loi 9 — La discipline bat le talent\.\n\nLe livre complet/);
    expect(titreDepuisFichier("loi_9 - final.m4a")).toBe("Loi 9");
  });

  it("prévoit une vidéo par jour et par compte, demain si les heures du jour sont passées", () => {
    const soir = new Date("2026-11-02T22:00:00");
    const matin = new Date("2026-11-02T09:00:00");
    expect(jourLibre([], asclepium, matin)).toBe("2026-11-02");
    expect(jourLibre([], asclepium, soir)).toBe("2026-11-03");
    expect(jourLibre([{ compte: "asclepium", jour: "2026-11-02", publiee: {} }, { compte: "fruit-tv", jour: "2026-11-03", publiee: {} }], asclepium, matin)).toBe("2026-11-03");
  });
});

describe("Studio — dossier surveillé", () => {
  let racine: string;
  let maintenant: Date;
  let studio: Studio;
  let commandes: string[][];
  beforeEach(() => {
    racine = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-studio-"));
    maintenant = new Date("2026-11-02T10:00:00");
    commandes = [];
  });
  afterEach(() => studio?.arreter());

  const creer = (executer?: Executer) => {
    const modele = path.join(racine, "modele.bin");
    fs.writeFileSync(modele, "");
    studio = new Studio({
      config: { dossier: path.join(racine, "Max Studio"), rappels: true, comptes },
      ffmpeg: "ffmpeg",
      whisper: { bin: path.join(__dirname, "fake-whisper-mots.mjs"), modele },
      dossierEtat: path.join(racine, "etat"),
      maintenant: () => maintenant,
      intervalleMs: 1e9,
      ...(executer ? { executer } : {}),
    });
    studio.demarrer();
    return studio;
  };

  it.skipIf(!aFfmpeg)("monte une vidéo verticale sous-titrée à partir de ta voix déposée", async () => {
    const s = creer();
    const voix = path.join(racine, "Max Studio", "Asclepium", "voix", "Loi 9.m4a");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=220:d=2", voix]);
    const pretes: string[] = [];
    s.on("prete", (t: string) => pretes.push(t));
    await s.scanner(); // vu une première fois : on attend qu'il ne bouge plus
    expect(s.vue().videos).toHaveLength(0);
    await s.scanner();
    const v = s.vue().videos[0];
    expect(pretes[0]).toBe("🎬 Vidéo prête : Asclepium — Loi 9, prévue le 2026-11-02.");
    expect(v).toMatchObject({ titre: "Loi 9", statut: "prete", jour: "2026-11-02" });
    const sortie = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", v.fichier!]).toString().trim();
    expect(sortie).toBe("1080,1920");
    expect(fs.readFileSync(path.join(racine, "Max Studio", "Prêtes", "Asclepium", "Loi 9.txt"), "utf8")).toContain("Loi 9 — La discipline bat le talent.");
    // le même fichier n'est pas remonté
    await s.scanner();
    await s.scanner();
    expect(s.vue().videos).toHaveLength(1);
    expect(s.vue().prochaines.map((p) => `${p.plateforme} ${p.quand}`)).toEqual(["youtube 2026-11-02 16:30", "tiktok 2026-11-02 19:30", "instagram 2026-11-02 21:00"]);
  }, 60_000);

  it("rappelle l'heure, prépare la publication, et suit ce qui est posté", async () => {
    const s = creer(async (bin, args, o) => {
      commandes.push([bin, ...args, ...(o?.entree ? [`<${o.entree}`] : [])]);
      if (bin === "ffprobe") return { ok: true, sortie: "3.2\n", erreur: "" };
      if (bin.endsWith(".mjs")) execFileSync(bin, args);
      return { ok: true, sortie: "", erreur: "" };
    });
    const voix = path.join(racine, "Max Studio", "Asclepium", "voix", "Loi 10.m4a");
    fs.writeFileSync(voix, "audio");
    await s.scanner();
    await s.scanner();
    expect(s.vue().videos[0]).toMatchObject({ titre: "Loi 10", statut: "prete" });
    expect(s.decrire()).toContain("Loi 10 (Asclepium) sur YouTube Shorts le 2026-11-02 16:30");

    const rappels: string[] = [];
    s.on("rappel", (t: string) => rappels.push(t));
    maintenant = new Date("2026-11-02T16:30:05");
    (s as unknown as { verifierHeure(): void }).verifierHeure();
    (s as unknown as { verifierHeure(): void }).verifierHeure();
    expect(rappels).toEqual(["C'est l'heure de poster « Loi 10 » sur YouTube Shorts (Asclepium). Dis-moi « publie-la » et je te prépare tout."]);

    commandes = [];
    const r = await s.publier("", "youtube");
    expect(r.ok).toBe(true);
    expect(commandes[0][0]).toBe("pbcopy");
    expect(commandes[0].at(-1)).toMatch(/^<Loi 10 — /);
    expect(commandes.slice(1).map((c) => c.slice(0, 2).join(" "))).toEqual(["open -R", "open https://studio.youtube.com"]);
    expect(s.marquerPubliee("loi 10", "youtube").texte).toBe("« Loi 10 » publiée sur YouTube Shorts. Reste : TikTok, Instagram Reels.");
    expect(s.vue().prochaines.map((p) => p.plateforme)).toEqual(["tiktok", "instagram"]);
    expect(s.script("asclepium", "Loi 11", "Le texte.").ok).toBe(true);
    expect(fs.readFileSync(path.join(racine, "Max Studio", "Asclepium", "scripts", "Loi 11.txt"), "utf8")).toBe("Le texte.\n");
    expect(s.script("netflix", "x", "y").ok).toBe(false);
  });

  it("met un clip horizontal au format vertical et dit quand ça rate", async () => {
    const s = creer(async (bin, args) => {
      commandes.push([bin, ...args]);
      if (bin === "ffprobe") return { ok: true, sortie: "1920,1080\n", erreur: "" };
      return { ok: false, sortie: "", erreur: "Invalid data found" };
    });
    fs.writeFileSync(path.join(racine, "Max Studio", "Fruit TV", "clips", "But incroyable.mp4"), "x");
    const msgs: string[] = [];
    s.on("prete", (t: string) => msgs.push(t));
    await s.scanner();
    await s.scanner();
    expect(commandes.some((c) => c[0] === "ffmpeg" && c.join(" ").includes("boxblur"))).toBe(true);
    expect(msgs[0]).toContain("⚠️ Studio : Fruit TV — But incroyable");
    expect(s.vue().videos[0].statut).toBe("erreur");
  });
});
