import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { ServerMessage } from "../shared/protocol.ts";

const RACINE = path.resolve(__dirname, "..");
const PORT = 4791;

function lancer(script: string, env: NodeJS.ProcessEnv): Promise<{ code: number; sortie: string }> {
  return new Promise((resolve) =>
    execFile("bash", [path.join(RACINE, "scripts", script)], { env, timeout: 90_000 }, (e, stdout, stderr) =>
      resolve({ code: (e as { code?: number } | null)?.code ?? 0, sortie: stdout + stderr }),
    ),
  );
}

async function sante(): Promise<boolean> {
  try {
    return (await (await fetch(`http://127.0.0.1:${PORT}/api/sante`)).json()).bureau === true;
  } catch {
    return false;
  }
}

/** Ouvre le WebSocket, renvoie l'état de Max, et envoie éventuellement un message. */
function etatMax(envoyer?: object): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.on("error", reject);
    ws.on("message", (d) => {
      const m: ServerMessage = JSON.parse(String(d));
      if (m.type !== "etat") return;
      if (envoyer) ws.send(JSON.stringify(envoyer));
      setTimeout(() => {
        ws.close();
        resolve(m.etat.assistant?.etat);
      }, envoyer ? 300 : 0);
    });
  });
}

describe.skipIf(process.platform === "win32")("scripts « réveille Max » et « arrêter le Bureau »", () => {
  it("démarre le Bureau en arrière-plan, réveille Max, ouvre la page, sans jamais lancer deux serveurs", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-script-"));
    fs.writeFileSync(
      path.join(dir, "bureau.config.json"),
      JSON.stringify({
        port: PORT,
        dossierMissions: path.join(dir, "missions"),
        dossierDonnees: path.join(dir, "donnees"),
        voix: { active: false, say: path.join(RACINE, "test", "fake-say.mjs") },
      }),
    );
    const env = {
      ...process.env,
      BUREAU_CONFIG_DIR: dir,
      BUREAU_OUVRIR: "echo",
      BUREAU_JOURNAL: path.join(dir, "bureau.log"),
      CLAUDE_BIN: path.join(RACINE, "test", "fake-claude.mjs"),
    };
    expect(await sante()).toBe(false);

    try {
      const r1 = await lancer("reveiller-max.sh", env);
      expect(r1.code, r1.sortie).toBe(0);
      expect(r1.sortie).toContain(`http://localhost:${PORT}`);
      expect(await sante()).toBe(true);
      const pid = fs.readFileSync(path.join(dir, "donnees", "serveur.pid"), "utf8").trim();
      expect(await etatMax()).not.toBe("veille");

      expect(await etatMax({ type: "veille" })).toBeDefined();
      expect(await etatMax()).toBe("veille");

      const r2 = await lancer("reveiller-max.sh", env);
      expect(r2.code, r2.sortie).toBe(0);
      expect(fs.readFileSync(path.join(dir, "donnees", "serveur.pid"), "utf8").trim()).toBe(pid);
      expect(await etatMax()).not.toBe("veille");
    } finally {
      const r3 = await lancer("arreter-bureau.sh", env);
      expect(r3.code, r3.sortie).toBe(0);
    }
    expect(await sante()).toBe(false);
    expect(fs.existsSync(path.join(dir, "donnees", "serveur.pid"))).toBe(false);
  }, 120_000);
});
