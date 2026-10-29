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
