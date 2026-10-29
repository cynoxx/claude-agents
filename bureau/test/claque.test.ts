import { describe, expect, it } from "vitest";
import { DetecteurClaques } from "../server/claque.ts";

const TAUX = 16000;
/** Du bruit de fond doux, avec des événements : [début en ms, durée en ms, amplitude 0-1]. */
function signal(duree: number, evenements: [number, number, number][], fond = 0.01): Buffer {
  const n = Math.round((duree / 1000) * TAUX);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const ms = (i / TAUX) * 1000;
    let a = fond * Math.sin(i * 0.37);
    for (const [d, l, amp] of evenements) if (ms >= d && ms < d + l) a = amp * Math.sin(i * 0.9) * (l <= 60 ? Math.exp(-(ms - d) / 25) : 1);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, a)) * 32767), i * 2);
  }
  return b;
}
const lancer = (b: Buffer, d = new DetecteurClaques()) => {
  let n = 0;
  // par morceaux de 100 ms, comme ffmpeg
  for (let i = 0; i < b.length; i += 3200) if (d.ajouter(b.subarray(i, i + 3200))) n++;
  return n;
};

describe("trois claquements de mains", () => {
  it("se déclenche sur trois claquements rapprochés", () => {
    expect(lancer(signal(3000, [[500, 50, 0.7], [1000, 50, 0.6], [1500, 50, 0.8]]))).toBe(1);
  });

  it("ne se déclenche pas sur deux claquements, ni sur trois trop espacés", () => {
    expect(lancer(signal(3000, [[500, 50, 0.7], [1000, 50, 0.7]]))).toBe(0);
    expect(lancer(signal(9000, [[500, 50, 0.7], [3500, 50, 0.7], [6500, 50, 0.7]]))).toBe(0);
  });

  it("ignore la parole et la musique : des sons forts mais qui durent", () => {
    expect(lancer(signal(4000, [[300, 400, 0.4], [900, 600, 0.4], [1700, 500, 0.4], [2400, 800, 0.4]]))).toBe(0);
  });

  it("ignore un bruit faible, et ne se redéclenche pas pendant 8 secondes", () => {
    expect(lancer(signal(3000, [[500, 50, 0.05], [1000, 50, 0.05], [1500, 50, 0.05]]))).toBe(0);
    const d = new DetecteurClaques();
    const six = [[500, 50, 0.7], [1000, 50, 0.7], [1500, 50, 0.7], [3000, 50, 0.7], [3500, 50, 0.7], [4000, 50, 0.7]] as [number, number, number][];
    expect(lancer(signal(6000, six), d)).toBe(1);
  });
});

describe("changer la musique de Max", () => {
  it("trouve le mp3 le plus récent par un mot de son nom, ou par son chemin", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { trouverMusique } = await import("../server/changer-musique.ts");
    const maison = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-maison-"));
    fs.mkdirSync(path.join(maison, "Downloads"));
    const f = path.join(maison, "Downloads", "Bella_Ciao_Version_Lenta.mp3");
    fs.writeFileSync(f, "x");
    fs.writeFileSync(path.join(maison, "Downloads", "Autre chanson.mp3"), "x");
    expect(trouverMusique("bella ciao", maison)).toBe(f);
    expect(trouverMusique("BELLA", maison)).toBe(f);
    expect(trouverMusique(f, maison)).toBe(f);
    expect(trouverMusique("inconnue", maison)).toBeNull();
  });
});

describe("retours du détecteur", () => {
  it("annonce chaque claquement (1, 2, 3), signale les sons trop longs, et donne la crête", () => {
    const vus: number[] = [];
    const rejets: number[] = [];
    const d = new DetecteurClaques({ surClaque: (n) => vus.push(n), surRejet: (n) => rejets.push(n) });
    const b = signal(4000, [[300, 50, 0.7], [800, 50, 0.7], [1300, 50, 0.7], [2500, 600, 0.4]]);
    for (let i = 0; i < b.length; i += 3200) d.ajouter(b.subarray(i, i + 3200));
    expect(vus).toEqual([1, 2, 3]);
    expect(rejets).toHaveLength(1); // un seul rejet pour tout le son long
    expect(d.crete()).toBeGreaterThan(0.3);
    expect(d.crete()).toBe(0);
  });
});
