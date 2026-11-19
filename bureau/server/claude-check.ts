import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EtatBureau } from "../shared/protocol.ts";

const exec = promisify(execFile);

/** Vérifie que `claude` est installé et connecté, sans consommer de quota. */
export async function checkClaude(bin: string): Promise<EtatBureau["claude"]> {
  let version: string;
  try {
    version = (await exec(bin, ["--version"], { timeout: 15_000 })).stdout.trim();
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { ok: false, erreur: "claude introuvable. Installe Claude Code (https://code.claude.com), puis relance le Bureau." };
    }
    return { ok: false, erreur: `claude ne répond pas : ${err.message}` };
  }

  let sortie = "";
  try {
    sortie = (await exec(bin, ["auth", "status"], { timeout: 15_000 })).stdout;
  } catch (e) {
    sortie = String((e as { stdout?: string }).stdout ?? "");
  }
  try {
    if (JSON.parse(sortie).loggedIn === false) {
      return {
        ok: false,
        version,
        erreur: "Claude Code n'est pas connecté. Lance « claude auth login » dans le Terminal, puis relance le Bureau.",
      };
    }
  } catch {
    // ancienne version sans « auth status » : on ne peut pas savoir, on continue
  }
  return { ok: true, version };
}
