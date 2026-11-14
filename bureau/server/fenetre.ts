// La fenêtre de Max : une vraie fenêtre à part, sans onglets ni barre d'adresse (le mode « app » de Chrome, Brave,
// Edge…), avec son propre profil (la caméra n'est autorisée qu'une fois, et rien ne se mélange avec ta navigation).
// Sur Mac avec deux écrans (ou plus) : Jarvis en plein écran sur un écran, le Bureau en plein écran sur l'autre.
// Sans navigateur de ce genre, ou si tu préfères, la page s'ouvre dans ton navigateur habituel (Safari).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ModeFenetre = "app" | "plein-ecran" | "navigateur";

export interface FenetreConfig {
  /** app = fenêtre à part ; plein-ecran = fenêtre à part, en plein écran ; navigateur = un onglet de ton navigateur. */
  mode: ModeFenetre;
  /** Le navigateur pour la fenêtre (« Google Chrome », « Brave Browser »…) ; null = le premier trouvé. */
  navigateur: string | null;
  /** auto (défaut) : une fenêtre par écran si tu en as deux ; un : toujours une seule fenêtre. */
  ecrans?: "auto" | "un";
  /** Sur deux écrans : le Bureau sur l'autre écran (défaut), ou sur l'écran principal (celui de la barre de menu). */
  ecranBureau?: "autre" | "principal";
}

/** Un écran, en coordonnées de Chrome (origine en haut à gauche de l'écran principal). */
export interface Ecran {
  x: number;
  y: number;
  l: number;
  h: number;
  principal: boolean;
}

/** Les navigateurs qui savent ouvrir une page comme une app, par ordre de préférence. */
export const NAVIGATEURS_APP = ["Google Chrome", "Brave Browser", "Microsoft Edge", "Chromium", "Vivaldi", "Opera"];

/** Le navigateur installé pour la fenêtre de Max, ou null (pas de Chrome & co : Safari). */
export function trouverNavigateurApp(prefere: string | null, existe: (p: string) => boolean = fs.existsSync, maison = os.homedir()): string | null {
  const candidats = prefere ? [prefere, ...NAVIGATEURS_APP.filter((n) => n !== prefere)] : NAVIGATEURS_APP;
  for (const n of candidats) {
    if (existe(path.join("/Applications", `${n}.app`)) || existe(path.join(maison, "Applications", `${n}.app`))) return n;
  }
  return null;
}

// NSScreen donne la géométrie de chaque écran (origine en bas à gauche, écran principal en premier).
const SCRIPT_ECRANS = `ObjC.import("AppKit");
const e = $.NSScreen.screens; const out = [];
for (let i = 0; i < e.count; i++) { const f = e.objectAtIndex(i).frame; out.push([f.origin.x, f.origin.y, f.size.width, f.size.height]); }
JSON.stringify(out);`;

/**
 * Les écrans branchés (sur Mac), dans les coordonnées de Chrome. Vide si on ne sait pas les lire : on ouvre alors
 * une seule fenêtre, comme avant.
 */
export function detecterEcrans(lire: (bin: string, args: string[]) => string = (bin, args) => execFileSync(bin, args, { encoding: "utf8", timeout: 5000 })): Ecran[] {
  let brut: unknown;
  try {
    brut = JSON.parse(lire("osascript", ["-l", "JavaScript", "-e", SCRIPT_ECRANS]).trim());
  } catch {
    return [];
  }
  if (!Array.isArray(brut) || !brut.length) return [];
  const rectangles = brut as number[][];
  // Chrome compte le haut depuis le haut de l'écran principal : on retourne la hauteur de Cocoa
  const hauteurPrincipale = rectangles[0][3];
  return rectangles.map(([x, y, l, h], i) => ({
    x: Math.round(x),
    y: Math.round(hauteurPrincipale - (y + h)),
    l: Math.round(l),
    h: Math.round(h),
    principal: i === 0,
  }));
}

/** Les arguments de `open` pour ouvrir la page en fenêtre d'app (sur l'écran donné, si on le précise). */
export function argsFenetre(navigateur: string, url: string, o: { profil: string; pleinEcran: boolean; ecran?: Ecran }): string[] {
  const e = o.ecran;
  return [
    "-na", navigateur, "--args",
    `--app=${url}`,
    `--user-data-dir=${o.profil}`,
    "--no-first-run",
    "--no-default-browser-check",
    // les sons de Max (intro, interface) sans attendre un premier clic
    "--autoplay-policy=no-user-gesture-required",
    ...(e ? [`--window-position=${e.x},${e.y}`, `--window-size=${e.l},${e.h}`] : ["--window-size=1440,900"]),
    ...(o.pleinEcran ? ["--start-fullscreen"] : []),
  ];
}

/**
 * Ouvre la page de Max : en fenêtre à part si possible (sur Mac), sinon dans le navigateur habituel. Avec deux écrans,
 * Jarvis (`?ecran=jarvis`) et le Bureau (`?ecran=bureau`) s'ouvrent chacun en plein écran sur le sien, chacun avec
 * son propre profil (Chrome ouvre alors une vraie fenêtre par écran). Renvoie ce qui a été ouvert (pour le journal).
 */
export function ouvrirFenetre(
  url: string,
  o: {
    config: FenetreConfig;
    dossierDonnees: string;
    plateforme?: NodeJS.Platform;
    existe?: (p: string) => boolean;
    lancer?: (bin: string, args: string[]) => void;
    ecrans?: Ecran[];
  },
): string {
  const lancer =
    o.lancer ?? ((bin: string, args: string[]) => spawn(bin, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref());
  const plateforme = o.plateforme ?? process.platform;
  if (plateforme !== "darwin") {
    lancer("xdg-open", [url]);
    return "navigateur";
  }
  const nav = o.config.mode === "navigateur" ? null : trouverNavigateurApp(o.config.navigateur, o.existe);
  if (!nav) {
    lancer("open", [url]);
    return "navigateur";
  }
  const ecrans = o.config.ecrans === "un" ? [] : (o.ecrans ?? detecterEcrans());
  if (ecrans.length < 2) {
    lancer("open", argsFenetre(nav, url, { profil: path.join(o.dossierDonnees, "fenetre"), pleinEcran: o.config.mode === "plein-ecran" }));
    return nav;
  }
  // deux écrans : Jarvis et le Bureau, chacun plein écran sur le sien
  const principal = ecrans.find((e) => e.principal) ?? ecrans[0];
  const autre = ecrans.find((e) => e !== principal)!;
  const ecranBureau = o.config.ecranBureau === "principal" ? principal : autre;
  const ecranJarvis = ecranBureau === principal ? autre : principal;
  lancer("open", argsFenetre(nav, `${url}/?ecran=jarvis`, { profil: path.join(o.dossierDonnees, "fenetre"), pleinEcran: true, ecran: ecranJarvis }));
  lancer("open", argsFenetre(nav, `${url}/?ecran=bureau`, { profil: path.join(o.dossierDonnees, "fenetre-bureau"), pleinEcran: true, ecran: ecranBureau }));
  return `${nav}, 2 fenêtres`;
}
