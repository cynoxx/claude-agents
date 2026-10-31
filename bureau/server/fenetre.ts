// La fenêtre de Max : une vraie fenêtre à part, sans onglets ni barre d'adresse (le mode « app » de Chrome, Brave,
// Edge…), avec son propre profil (la caméra n'est autorisée qu'une fois, et rien ne se mélange avec ta navigation).
// Sans navigateur de ce genre, ou si tu préfères, la page s'ouvre dans ton navigateur habituel (Safari).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type ModeFenetre = "app" | "plein-ecran" | "navigateur";

export interface FenetreConfig {
  /** app = fenêtre à part ; plein-ecran = fenêtre à part, en plein écran ; navigateur = un onglet de ton navigateur. */
  mode: ModeFenetre;
  /** Le navigateur pour la fenêtre (« Google Chrome », « Brave Browser »…) ; null = le premier trouvé. */
  navigateur: string | null;
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

/** Les arguments de `open` pour ouvrir la page en fenêtre d'app. */
export function argsFenetre(navigateur: string, url: string, o: { profil: string; pleinEcran: boolean }): string[] {
  return [
    "-na", navigateur, "--args",
    `--app=${url}`,
    `--user-data-dir=${o.profil}`,
    "--no-first-run",
    "--no-default-browser-check",
    // les sons de Max (intro, interface) sans attendre un premier clic
    "--autoplay-policy=no-user-gesture-required",
    ...(o.pleinEcran ? ["--start-fullscreen"] : ["--window-size=1440,900"]),
  ];
}

/**
 * Ouvre la page de Max : en fenêtre à part si possible (sur Mac), sinon dans le navigateur habituel. Renvoie ce
 * qui a été ouvert (pour le journal).
 */
export function ouvrirFenetre(
  url: string,
  o: {
    config: FenetreConfig;
    dossierDonnees: string;
    plateforme?: NodeJS.Platform;
    existe?: (p: string) => boolean;
    lancer?: (bin: string, args: string[]) => void;
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
  lancer("open", argsFenetre(nav, url, { profil: path.join(o.dossierDonnees, "fenetre"), pleinEcran: o.config.mode === "plein-ecran" }));
  return nav;
}
