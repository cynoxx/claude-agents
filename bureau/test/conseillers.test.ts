import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONSEILLERS_DEFAUT, Conseillers, argsConseiller, consigneConseiller, extraireARetenir, trouverConseiller } from "../server/max/conseillers.ts";
import { lireCarnet } from "../server/max/carnet.ts";

const FAKE = path.join(__dirname, "fake-claude.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-conseillers-"));
const envAvant = { ...process.env };
afterEach(() => {
  process.env = { ...envAvant };
});

describe("conseillers — pur", () => {
  it("a un conseiller par grand domaine de la vie, avec des identifiants et couleurs uniques", () => {
    const ids = CONSEILLERS_DEFAUT.map((c) => c.id);
    expect(ids).toEqual(["etudes", "sante", "business", "apps", "vie"]);
    expect(new Set(CONSEILLERS_DEFAUT.map((c) => c.couleur)).size).toBe(ids.length);
  });

  it("retrouve un conseiller par son identifiant ou son nom, sans tenir compte des accents", () => {
    expect(trouverConseiller(CONSEILLERS_DEFAUT, "etudes")?.id).toBe("etudes");
    expect(trouverConseiller(CONSEILLERS_DEFAUT, "Études")?.id).toBe("etudes");
    expect(trouverConseiller(CONSEILLERS_DEFAUT, "le prof")?.id).toBe("etudes");
    expect(trouverConseiller(CONSEILLERS_DEFAUT, "Associé")?.id).toBe("business");
    expect(trouverConseiller(CONSEILLERS_DEFAUT, "plombier")).toBeUndefined();
  });

  it("n'a droit qu'à la recherche web, sans les MCP de l'utilisateur", () => {
    const a = argsConseiller({ modele: "sonnet", consigne: "C", question: "Q" });
    expect(a.slice(0, 2)).toEqual(["-p", "Q"]);
    expect(a[a.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(a[a.indexOf("--allowedTools") + 1]).toBe("WebSearch,WebFetch");
    expect(a).toContain("--strict-mcp-config");
    expect(a[a.indexOf("--model") + 1]).toBe("sonnet");
    expect(a[a.indexOf("--append-system-prompt") + 1]).toBe("C");
  });

  it("met dans sa consigne son domaine, le profil, ses notes et le contexte du jour", () => {
    const c = consigneConseiller(CONSEILLERS_DEFAUT[0], { profil: "Je suis en PASS.", notes: ["- [2026-10-26] Bloque sur la biochimie"], contexte: "Nous sommes le lundi." });
    expect(c).toContain("le conseiller « Études »");
    expect(c).toContain("Je suis en PASS.");
    expect(c).toContain("Bloque sur la biochimie");
    expect(c).toContain("Nous sommes le lundi.");
    expect(c).toContain("À retenir :");
  });

  it("sépare la réponse des lignes « À retenir »", () => {
    expect(extraireARetenir("Fais des QCM.\nÀ retenir : aime les QCM\nA retenir: dort mal")).toEqual({
      reponse: "Fais des QCM.",
      notes: ["aime les QCM", "dort mal"],
    });
    expect(extraireARetenir("Rien à noter.")).toEqual({ reponse: "Rien à noter.", notes: [] });
  });
});

describe("Conseillers — consultation (faux claude)", () => {
  let dossier: string;
  let c: Conseillers;
  beforeEach(() => {
    dossier = tmp();
    process.env.FAKE_DELAY = "5";
    c = new Conseillers({ defs: CONSEILLERS_DEFAUT, bin: FAKE, modele: "sonnet", dossier, timeoutMs: 10_000, profil: () => "Je suis en PASS.", contexte: () => "Lundi." });
  });
  afterEach(() => c.arreterTout());

  it("pose la question, montre qu'il réfléchit, renvoie la réponse et note ce qu'il a appris", async () => {
    const statuts: string[] = [];
    c.on("etat", () => statuts.push(c.vue().find((v) => v.id === "etudes")!.statut));
    const r = await c.consulter("prof", "Comment réviser la biochimie ?");
    expect(r.ok).toBe(true);
    expect(r.texte).toContain("Mon conseil sur : Comment réviser la biochimie ?");
    expect(r.texte).not.toContain("À retenir");
    expect(statuts).toContain("reflechit");
    const v = c.vue().find((x) => x.id === "etudes")!;
    expect(v.statut).toBe("libre");
    expect(v.question).toBe("Comment réviser la biochimie ?");
    expect(v.reponse).toContain("Mon conseil");
    expect(lireCarnet(path.join(dossier, "conseillers"), "etudes.md")).toEqual([expect.stringMatching(/\] préfère réviser le matin$/)]);
  });

  it("refuse un conseiller inconnu en listant ceux qui existent", async () => {
    const r = await c.consulter("plombier", "?");
    expect(r.ok).toBe(false);
    expect(r.texte).toContain("Prof");
  });

  it("refuse une deuxième question au même conseiller pendant qu'il réfléchit", async () => {
    const premiere = c.consulter("etudes", "Q1");
    const r = await c.consulter("etudes", "Q2");
    expect(r.ok).toBe(false);
    expect((await premiere).ok).toBe(true);
  });

  it("dit quand le quota est atteint", async () => {
    process.env.FAKE_MODE = "quota";
    const r = await c.consulter("sante", "Comment mieux dormir ?");
    expect(r.ok).toBe(false);
    expect(r.texte).toMatch(/quota/i);
    expect(c.vue().find((x) => x.id === "sante")!.statut).toBe("libre");
  });

  it("note à la main dans le carnet d'un conseiller", () => {
    expect(c.noterPour("business", "La boutique vend des fruits").ok).toBe(true);
    expect(lireCarnet(path.join(dossier, "conseillers"), "business.md")).toHaveLength(1);
    expect(c.noterPour("inconnu", "x").ok).toBe(false);
  });
});
