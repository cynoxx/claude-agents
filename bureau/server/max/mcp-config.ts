// La configuration MCP que reçoit le cerveau de Max : un seul serveur, « bureau », avec ses outils.
import fs from "node:fs";
import path from "node:path";
import { FICHIER_JETON } from "../jeton.ts";

export function ecrireConfigMcp(o: { racine: string; port: number; dossierDonnees: string }): string {
  fs.mkdirSync(o.dossierDonnees, { recursive: true, mode: 0o700 });
  const fichier = path.join(o.dossierDonnees, "max-mcp.json");
  const config = {
    mcpServers: {
      bureau: {
        command: path.join(o.racine, "node_modules", ".bin", "tsx"),
        args: [path.join(o.racine, "server", "max", "outils-mcp.ts")],
        env: { BUREAU_URL: `http://127.0.0.1:${o.port}`, BUREAU_JETON_FICHIER: path.join(o.dossierDonnees, FICHIER_JETON) },
      },
    },
  };
  fs.writeFileSync(fichier, JSON.stringify(config, null, 2), { mode: 0o600 });
  fs.chmodSync(fichier, 0o600);
  return fichier;
}
