import { describe, it, expect } from "vitest";
import { argsFenetre, ouvrirFenetre, trouverNavigateurApp } from "../server/fenetre.ts";

const installes = (...apps: string[]) => (p: string) => apps.some((a) => p === `/Applications/${a}.app`);

describe("la fenêtre de Max", () => {
  it("trouve le navigateur qui sait ouvrir une app, dans l'ordre de préférence", () => {
    expect(trouverNavigateurApp(null, installes("Brave Browser", "Google Chrome"))).toBe("Google Chrome");
    expect(trouverNavigateurApp(null, installes("Microsoft Edge"))).toBe("Microsoft Edge");
    expect(trouverNavigateurApp("Brave Browser", installes("Brave Browser", "Google Chrome"))).toBe("Brave Browser");
    // le navigateur demandé n'est pas là : le suivant
    expect(trouverNavigateurApp("Arc", installes("Google Chrome"))).toBe("Google Chrome");
    expect(trouverNavigateurApp(null, installes())).toBeNull();
    // installé dans ~/Applications
    expect(trouverNavigateurApp(null, (p) => p === "/Users/jo/Applications/Google Chrome.app", "/Users/jo")).toBe("Google Chrome");
  });

  it("ouvre une fenêtre d'app, avec son propre profil, sans onglets", () => {
    const a = argsFenetre("Google Chrome", "http://localhost:4747", { profil: "/d/fenetre", pleinEcran: false });
    expect(a.slice(0, 3)).toEqual(["-na", "Google Chrome", "--args"]);
    expect(a).toContain("--app=http://localhost:4747");
    expect(a).toContain("--user-data-dir=/d/fenetre");
    expect(a).toContain("--window-size=1440,900");
    expect(argsFenetre("Google Chrome", "u", { profil: "p", pleinEcran: true })).toContain("--start-fullscreen");
  });

  it("sur Mac : la fenêtre si un navigateur sait le faire, sinon le navigateur habituel (Safari)", () => {
    const lances: { bin: string; args: string[] }[] = [];
    const lancer = (bin: string, args: string[]) => void lances.push({ bin, args });
    const base = { dossierDonnees: "/d", plateforme: "darwin" as const, lancer };
    expect(ouvrirFenetre("http://x", { ...base, config: { mode: "app", navigateur: null }, existe: installes("Google Chrome") })).toBe("Google Chrome");
    expect(lances[0].args).toContain("--app=http://x");
    expect(ouvrirFenetre("http://x", { ...base, config: { mode: "app", navigateur: null }, existe: installes() })).toBe("navigateur");
    expect(lances[1]).toEqual({ bin: "open", args: ["http://x"] });
    // il préfère son navigateur : pas de fenêtre à part
    expect(ouvrirFenetre("http://x", { ...base, config: { mode: "navigateur", navigateur: null }, existe: installes("Google Chrome") })).toBe("navigateur");
    expect(lances[2]).toEqual({ bin: "open", args: ["http://x"] });
  });

  it("hors Mac : le navigateur", () => {
    const lances: string[] = [];
    expect(ouvrirFenetre("http://x", { config: { mode: "app", navigateur: null }, dossierDonnees: "/d", plateforme: "linux", lancer: (b) => void lances.push(b) })).toBe("navigateur");
    expect(lances).toEqual(["xdg-open"]);
  });
});
