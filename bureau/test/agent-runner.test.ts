import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAgent } from "../server/agent-runner.ts";
import type { Traduction } from "../server/event-translator.ts";

const FAKE = path.join(__dirname, "fake-claude.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-run-"));

function avecEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const avant = { ...process.env };
  Object.assign(process.env, env);
  return fn().finally(() => {
    for (const k of Object.keys(env)) delete process.env[k];
    Object.assign(process.env, avant);
  });
}

describe("runAgent", () => {
  it("lance un robot, transmet les traductions et renvoie le résultat", async () => {
    const vues: Traduction[] = [];
    const cwd = tmp();
    const r = await runAgent({ bin: FAKE, args: ["-p", "Tâche A"], cwd, timeoutMs: 10_000, mode: "stream", onTraduction: (t) => vues.push(t) }).done;
    expect(r.ok).toBe(true);
    expect(r.sessionId).toMatch(/^fake-/);
    expect(r.texte).toBe("Travail terminé.");
    expect(vues.map((v) => v.bulle).filter(Boolean)).toContain("Je cherche : recherche de test");
    expect(fs.existsSync(path.join(cwd, "rapport.md"))).toBe(true);
  });

  it("lit le JSON structuré en mode json", async () => {
    const r = await runAgent({ bin: FAKE, args: ["-p", "plan", "--json-schema", "{}"], cwd: tmp(), timeoutMs: 10_000, mode: "json" }).done;
    expect(r.ok).toBe(true);
    expect((r.structured as any).titre).toBe("Mission test");
  });

  it("ne plante pas si claude est introuvable", async () => {
    const r = await runAgent({ bin: "/nexiste/pas/claude", args: [], cwd: tmp(), timeoutMs: 1000, mode: "stream" }).done;
    expect(r.ok).toBe(false);
    expect(r.erreur).toMatch(/introuvable/);
  });

  it("signale le quota atteint", async () => {
    const r = await avecEnv({ FAKE_MODE: "quota" }, () =>
      runAgent({ bin: FAKE, args: ["-p", "x"], cwd: tmp(), timeoutMs: 10_000, mode: "stream" }).done,
    );
    expect(r).toMatchObject({ ok: false, quota: true });
    expect(r.sessionId).toMatch(/^fake-/);
  });

  it("rapporte un plantage avec la fin de stderr", async () => {
    const r = await avecEnv({ FAKE_MODE: "crash" }, () =>
      runAgent({ bin: FAKE, args: ["-p", "x"], cwd: tmp(), timeoutMs: 10_000, mode: "stream" }).done,
    );
    expect(r).toMatchObject({ ok: false, quota: false });
    expect(r.erreur).toContain("boom");
  });

  it("arrête le processus après le délai", async () => {
    const r = await avecEnv({ FAKE_MODE: "slow" }, () =>
      runAgent({ bin: FAKE, args: ["-p", "x"], cwd: tmp(), timeoutMs: 300, mode: "stream" }).done,
    );
    expect(r.ok).toBe(false);
    expect(r.erreur).toMatch(/[Dd]élai/);
  });

  it("stop() arrête le processus", async () => {
    const h = await avecEnv({ FAKE_MODE: "slow" }, async () => runAgent({ bin: FAKE, args: ["-p", "x"], cwd: tmp(), timeoutMs: 10_000, mode: "stream" }));
    setTimeout(() => h.stop(), 100);
    const r = await h.done;
    expect(r.ok).toBe(false);
    expect(r.erreur).toBe("Arrêté");
  });
});
