// Avant de lancer le Bureau : si un paquet de package.json manque (après un « git pull » qui en ajoute),
// on lance « npm install » tout seul, au lieu de laisser la page échouer à se construire.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(racine, "package.json"), "utf8"));
const noms = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const manquants = noms.filter((n) => !existsSync(path.join(racine, "node_modules", n, "package.json")));
if (manquants.length) {
  console.log(`📦 Il manque ${manquants.length} paquet(s) (${manquants.slice(0, 3).join(", ")}${manquants.length > 3 ? "…" : ""}) : j'installe, une minute…`);
  execSync("npm install --no-audit --no-fund", { cwd: racine, stdio: "inherit" });
}
