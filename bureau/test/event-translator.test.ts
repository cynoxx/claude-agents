import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { translate, tronquer, LineSplitter } from "../server/event-translator.ts";

const fixture = fs.readFileSync(path.join(__dirname, "fixtures/robot-ok.jsonl"), "utf8").trim().split("\n");

describe("tronquer", () => {
  it("coupe à 60 caractères avec …", () => {
    const t = tronquer("a".repeat(80));
    expect(t).toHaveLength(60);
    expect(t.endsWith("…")).toBe(true);
  });
  it("aplatit les espaces et retours à la ligne", () => {
    expect(tronquer("un\n  deux\tTrois")).toBe("un deux Trois");
  });
});

describe("translate", () => {
  const toutes = fixture.flatMap((l) => translate(l));
  const bulles = toutes.map((t) => t.bulle).filter(Boolean);

  it("donne le session_id depuis init", () => {
    expect(toutes.find((t) => t.sessionId)?.sessionId).toBe("sess-123");
  });

  it("traduit les outils en phrases françaises", () => {
    expect(bulles).toEqual([
      "Je cherche : mutuelle jeune actif prix",
      "Je lis maif.fr…",
      "J'écris rapport.md",
      "J'ai terminé le rapport avec 4 sources.",
    ]);
  });

  it("note un échec d'outil dans les actions, sans bulle", () => {
    const e = toutes.find((t) => t.action?.startsWith("Échec"));
    expect(e?.action).toContain("Erreur 403");
    expect(e?.bulle).toBeUndefined();
  });

  it("garde l'action longue alors que la bulle est tronquée", () => {
    const [t] = translate(
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test -- --reporter verbose --run tous-les-tests-du-projet" } }] },
      }),
    );
    expect(t.bulle!.length).toBeLessThanOrEqual(60);
    expect(t.action).toBe("Je lance : npm test -- --reporter verbose --run tous-les-tests-du-projet");
  });

  it("termine par un résultat réussi", () => {
    const r = toutes.find((t) => t.resultat)?.resultat;
    expect(r).toEqual({ ok: true, quota: false, texte: "J'ai terminé le rapport avec 4 sources.", structured: undefined });
  });

  it("ignore les lignes non JSON et les événements inconnus", () => {
    expect(translate("not json")).toEqual([]);
    expect(translate("")).toEqual([]);
    expect(translate(JSON.stringify({ type: "stream_event" }))).toEqual([]);
  });

  it("détecte le quota atteint dans un résultat", () => {
    const [t] = translate(
      JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1793865600" }),
    );
    expect(t.resultat).toMatchObject({ ok: false, quota: true });
  });

  it("signale une limite refusée dans rate_limit_event", () => {
    const [t] = translate(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } }));
    expect(t.limite).toBe(true);
  });

  it("transmet structured_output", () => {
    const [t] = translate(
      JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "{}", structured_output: { a: 1 } }),
    );
    expect(t.resultat?.structured).toEqual({ a: 1 });
  });
});

describe("LineSplitter", () => {
  it("reconstitue une ligne coupée en deux morceaux", () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(s.flush()).toEqual(['{"c"']);
    expect(s.flush()).toEqual([]);
  });
});
