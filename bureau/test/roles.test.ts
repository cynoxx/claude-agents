import { describe, it, expect } from "vitest";
import { ROLES, robotArgs, planArgs, reviewArgs, DENY_RULES } from "../server/roles.ts";

const valeur = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("ROLES", () => {
  it("définit les cinq métiers avec nom, emoji et couleur", () => {
    expect(Object.keys(ROLES)).toEqual(["chercheur", "codeur", "designer", "redacteur", "analyste"]);
    for (const r of Object.values(ROLES)) {
      expect(r.nom).toBeTruthy();
      expect(r.couleur).toMatch(/^#[0-9a-f]{6}$/);
      expect(r.instructions.length).toBeGreaterThan(50);
    }
  });
});

describe("robotArgs", () => {
  const base = { prompt: "Fais ça", model: "sonnet", extraDirs: ["/m"] };

  it("met le prompt juste après -p et restreint les outils du chercheur", () => {
    const a = robotArgs({ ...base, role: "chercheur" });
    expect(a.slice(0, 2)).toEqual(["-p", "Fais ça"]);
    expect(valeur(a, "--tools")).toBe("WebSearch,WebFetch,Read,Write,Edit,Glob,Grep");
    expect(valeur(a, "--allowedTools")).toBe(valeur(a, "--tools"));
    expect(valeur(a, "--tools")).not.toContain("Bash");
    expect(valeur(a, "--permission-mode")).toBe("acceptEdits");
    expect(valeur(a, "--output-format")).toBe("stream-json");
    expect(a).toContain("--verbose");
    expect(valeur(a, "--model")).toBe("sonnet");
    expect(valeur(a, "--add-dir")).toBe("/m");
    expect(valeur(a, "--append-system-prompt")).toBe(ROLES.chercheur.instructions);
  });

  it("n'expose aucun serveur MCP de l'utilisateur (mails, agenda…)", () => {
    expect(robotArgs({ ...base, role: "chercheur" })).toContain("--strict-mcp-config");
    expect(planArgs({ prompt: "P", model: "opus", schema: {}, extraDirs: [] })).toContain("--strict-mcp-config");
    expect(reviewArgs({ prompt: "R", model: "opus" })).toContain("--strict-mcp-config");
  });

  it("donne Bash au codeur et interdit push, rm -rf et sudo", () => {
    const a = robotArgs({ ...base, role: "codeur" });
    expect(valeur(a, "--tools")).toContain("Bash");
    expect(JSON.parse(valeur(a, "--settings")).permissions.deny).toEqual(DENY_RULES);
    expect(DENY_RULES).toEqual(["Bash(git push:*)", "Bash(rm -rf:*)", "Bash(sudo:*)"]);
  });

  it("ajoute --resume quand on reprend une session", () => {
    const a = robotArgs({ ...base, role: "redacteur", resumeSessionId: "s1" });
    expect(valeur(a, "--resume")).toBe("s1");
  });
});

describe("planArgs et reviewArgs", () => {
  it("Max planifie en JSON structuré, en lecture seule", () => {
    const a = planArgs({ prompt: "P", model: "opus", schema: { type: "object" }, extraDirs: ["/p"] });
    expect(valeur(a, "--output-format")).toBe("json");
    expect(JSON.parse(valeur(a, "--json-schema"))).toEqual({ type: "object" });
    expect(valeur(a, "--tools")).toBe("Read,Glob,Grep");
    expect(valeur(a, "--model")).toBe("opus");
  });

  it("Max relit en streaming et peut écrire", () => {
    const a = reviewArgs({ prompt: "R", model: "opus" });
    expect(valeur(a, "--output-format")).toBe("stream-json");
    expect(valeur(a, "--tools")).toBe("Read,Glob,Grep,Write,Edit");
    expect(valeur(a, "--permission-mode")).toBe("acceptEdits");
  });
});
