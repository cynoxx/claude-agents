import { describe, it, expect } from "vitest";
import { argsFenetre, detecterEcrans, ouvrirFenetre } from "../server/fenetre.ts";

const installes = (p: string) => p === "/Applications/Google Chrome.app";
// la sortie de l'script : un écran principal (le Mac, 1440x900 en haut), et un autre à sa droite, plus haut de 200 px
const sortieOsascript = JSON.stringify([
  [0, 0, 1440, 900],
  [1440, 200, 1920, 1080],
]);

describe("les écrans (Mac)", () => {
  it("lit les écrans et les convertit dans le repère de Chrome (haut-gauche de l'écran principal)", () => {
    const e = detecterEcrans(() => sortieOsascript);
    expect(e).toEqual([
      { x: 0, y: 0, l: 1440, h: 900, principal: true },
      // Cocoa : bas de l'écran à y = 200, haut à 1280 ; Chrome : haut à 900 - (200 + 1080) = -380
      { x: 1440, y: -380, l: 1920, h: 1080, principal: false },
    ]);
  });

  it("sans réponse lisible : aucun écran (une seule fenêtre, comme avant)", () => {
    expect(detecterEcrans(() => "pas du json")).toEqual([]);
    expect(detecterEcrans(() => "[]")).toEqual([]);
  });

  it("place la fenêtre sur son écran, en plein écran", () => {
    const a = argsFenetre("Google Chrome", "http://x/?ecran=bureau", { profil: "/d/b", pleinEcran: true, ecran: { x: 1440, y: -380, l: 1920, h: 1080, principal: false } });
    expect(a).toContain("--window-position=1440,-380");
    expect(a).toContain("--window-size=1920,1080");
    expect(a).toContain("--start-fullscreen");
  });

  it("deux écrans : Jarvis sur le principal, le Bureau sur l'autre (par défaut), chacun avec son profil", () => {
    const lances: { bin: string; args: string[] }[] = [];
    const lancer = (bin: string, args: string[]) => void lances.push({ bin, args });
    const ecrans = detecterEcrans(() => sortieOsascript);
    const r = ouvrirFenetre("http://localhost:4747", { config: { mode: "plein-ecran", navigateur: null }, dossierDonnees: "/d", plateforme: "darwin", existe: installes, lancer, ecrans });
    expect(r).toBe("Google Chrome, 2 fenêtres");
    expect(lances).toHaveLength(2);
    const jarvis = lances[0].args;
    const bureau = lances[1].args;
    expect(jarvis).toContain("--app=http://localhost:4747/?ecran=jarvis");
    expect(jarvis).toContain("--window-position=0,0");
    expect(jarvis).toContain("--user-data-dir=/d/fenetre");
    expect(bureau).toContain("--app=http://localhost:4747/?ecran=bureau");
    expect(bureau).toContain("--window-position=1440,-380");
    expect(bureau).toContain("--user-data-dir=/d/fenetre-bureau");
  });

  it("le Bureau peut être sur l'écran principal, et on peut couper les deux fenêtres", () => {
    const lances: string[][] = [];
    const lancer = (_: string, args: string[]) => void lances.push(args);
    const ecrans = detecterEcrans(() => sortieOsascript);
    ouvrirFenetre("http://x", { config: { mode: "plein-ecran", navigateur: null, ecranBureau: "principal" }, dossierDonnees: "/d", plateforme: "darwin", existe: installes, lancer, ecrans });
    expect(lances[1]).toContain("--window-position=0,0");
    expect(lances[0]).toContain("--window-position=1440,-380");

    lances.length = 0;
    const r = ouvrirFenetre("http://x", { config: { mode: "plein-ecran", navigateur: null, ecrans: "un" }, dossierDonnees: "/d", plateforme: "darwin", existe: installes, lancer, ecrans });
    expect(r).toBe("Google Chrome");
    expect(lances).toHaveLength(1);
    expect(lances[0]).toContain("--user-data-dir=/d/fenetre");
  });

  it("un seul écran : une seule fenêtre, comme avant", () => {
    const lances: string[][] = [];
    ouvrirFenetre("http://x", { config: { mode: "plein-ecran", navigateur: null }, dossierDonnees: "/d", plateforme: "darwin", existe: installes, lancer: (_, a) => void lances.push(a), ecrans: [{ x: 0, y: 0, l: 1440, h: 900, principal: true }] });
    expect(lances).toHaveLength(1);
    expect(lances[0]).toContain("--start-fullscreen");
  });
});
