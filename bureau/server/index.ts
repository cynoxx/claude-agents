// `npm start` : démarre le Bureau et ouvre le navigateur.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { checkClaude } from "./claude-check.ts";
import { createBureauServer, ouvrirDansFinder } from "./http.ts";
import { MissionManager } from "./mission.ts";
import { markInterrupted } from "./storage.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(racine);
const bin = process.env.CLAUDE_BIN ?? "claude";

const interrompues = markInterrupted(config.dossierMissions);
if (interrompues) console.log(`${interrompues} mission(s) coupée(s) au dernier arrêt, marquée(s) « interrompue ».`);

const manager = new MissionManager(config, bin, { ok: false, erreur: "vérification en cours…" });
const server = createBureauServer({ config, manager, webDir: path.join(racine, "web", "dist") });

checkClaude(bin).then((etat) => {
  manager.setClaude(etat);
  console.log(etat.ok ? `✅ Claude Code prêt (${etat.version})` : `⚠️  ${etat.erreur}`);
});

server.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Le port ${config.port} est déjà utilisé : le Bureau est peut-être déjà ouvert. Sinon, change « port » dans bureau.config.json.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});

server.listen(config.port, "127.0.0.1", () => {
  const url = `http://localhost:${config.port}`;
  console.log(`\n🏢 Le Bureau est ouvert : ${url}`);
  console.log(`📁 Missions rangées dans : ${config.dossierMissions}`);
  console.log("Laisse cette fenêtre ouverte. Ctrl+C pour fermer le Bureau.\n");
  if (!process.env.BUREAU_NO_OPEN) ouvrirDansFinder(url);
});

const fermer = () => {
  console.log("\nFermeture du Bureau…");
  manager.arreter();
  setTimeout(() => process.exit(0), 1500).unref();
  manager.attendreFin().then(() => process.exit(0));
};
process.on("SIGINT", fermer);
process.on("SIGTERM", fermer);
