// Pour les scripts : affiche le port et les dossiers du Bureau (variables shell).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const c = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
console.log(`PORT=${c.port}\nDONNEES=${q(c.dossierDonnees)}\nMISSIONS=${q(c.dossierMissions)}`);
