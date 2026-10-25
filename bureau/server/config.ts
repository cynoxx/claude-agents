import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Projet {
  nom: string;
  chemin: string;
}

export interface BureauConfig {
  port: number;
  dossierMissions: string;
  projets: Projet[];
  modeles: { chef: string; robots: string };
  limites: { robots: number; etapes: number; minutesParRobot: number };
}

export const CONFIG_FILE = "bureau.config.json";

export const DEFAULT_CONFIG: BureauConfig = {
  port: 4747,
  dossierMissions: "~/Documents/Bureau",
  projets: [],
  modeles: { chef: "opus", robots: "sonnet" },
  limites: { robots: 5, etapes: 3, minutesParRobot: 20 },
};

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Lit `bureau.config.json` dans `dir` (s'il existe) et le fusionne avec les valeurs par défaut. */
export function loadConfig(dir: string): BureauConfig {
  const file = path.join(dir, CONFIG_FILE);
  let user: Partial<BureauConfig> = {};
  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`${CONFIG_FILE} n'est pas un JSON valide : ${(e as Error).message}`);
    }
  }
  const c: BureauConfig = {
    port: user.port ?? DEFAULT_CONFIG.port,
    dossierMissions: user.dossierMissions ?? DEFAULT_CONFIG.dossierMissions,
    projets: user.projets ?? DEFAULT_CONFIG.projets,
    modeles: { ...DEFAULT_CONFIG.modeles, ...user.modeles },
    limites: { ...DEFAULT_CONFIG.limites, ...user.limites },
  };
  c.dossierMissions = expandHome(c.dossierMissions);
  c.projets = c.projets.map((p) => ({ nom: p.nom, chemin: expandHome(p.chemin) }));
  return c;
}
