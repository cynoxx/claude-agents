import { describe, it, expect } from "vitest";
import { CARTES, PALETTE_BASE, paletteRobot } from "../web/sprites-data.ts";
import { renderMarkdown } from "../web/markdown.ts";
import { ROLE_AFFICHAGE } from "../shared/roles-affichage.ts";

describe("cartes de pixels", () => {
  it("sont rectangulaires et n'utilisent que des couleurs connues", () => {
    const connues = new Set([".", ...Object.keys(PALETTE_BASE), ...Object.keys(paletteRobot("#4f9dde"))]);
    for (const [nom, carte] of Object.entries(CARTES)) {
      const largeur = carte[0].length;
      for (const [i, ligne] of carte.entries()) {
        expect(ligne.length, `${nom} ligne ${i}`).toBe(largeur);
        for (const c of ligne) expect(connues.has(c), `${nom} : couleur « ${c} »`).toBe(true);
      }
    }
  });

  it("dessinent des robots en 16×16", () => {
    for (const nom of ["robot", "robotMarche", "max", "maxMarche"] as const) {
      expect(CARTES[nom]).toHaveLength(16);
      expect(CARTES[nom][0]).toHaveLength(16);
    }
  });

  it("assombrissent et éclaircissent la couleur du métier", () => {
    const p = paletteRobot("#808080");
    expect(p.B).toBe("#808080");
    expect(p.D).toBe("#5a5a5a");
    expect(p.L).toBe("#a6a6a6");
  });

  it("couvrent les cinq métiers", () => {
    expect(Object.keys(ROLE_AFFICHAGE)).toEqual(["chercheur", "codeur", "designer", "redacteur", "analyste"]);
  });
});

describe("renderMarkdown", () => {
  it("échappe le HTML", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  it("rend titres, gras, italique, code et liens sûrs", () => {
    expect(renderMarkdown("# Titre\n## Sous-titre")).toBe("<h1>Titre</h1>\n<h2>Sous-titre</h2>");
    expect(renderMarkdown("**gras** et *ital* et `code`")).toBe("<p><strong>gras</strong> et <em>ital</em> et <code>code</code></p>");
    expect(renderMarkdown("[site](https://a.fr/x)")).toBe('<p><a href="https://a.fr/x" target="_blank" rel="noopener">site</a></p>');
    expect(renderMarkdown("[x](javascript:alert(1))")).toBe("<p>x</p>");
  });

  it("rend les listes et les blocs de code", () => {
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(renderMarkdown("```bash\ngit merge <b>\n```")).toBe("<pre><code>git merge &lt;b&gt;</code></pre>");
  });

  it("rend les tableaux", () => {
    expect(renderMarkdown("| Nom | Prix |\n|---|---|\n| MAIF | 32 € |")).toBe(
      "<table><thead><tr><th>Nom</th><th>Prix</th></tr></thead><tbody><tr><td>MAIF</td><td>32 €</td></tr></tbody></table>",
    );
  });

  it("regroupe les lignes d'un paragraphe et gère les citations", () => {
    expect(renderMarkdown("un\ndeux\n\ntrois")).toBe("<p>un deux</p>\n<p>trois</p>");
    expect(renderMarkdown("> attention")).toBe("<blockquote>attention</blockquote>");
  });
});

describe("coach à l'écran", () => {
  it("affiche le travail du jour en court", async () => {
    const { dureeCourte } = await import("../web/conversation.ts");
    expect(dureeCourte(0)).toBe("rien encore");
    expect(dureeCourte(45)).toBe("45 min");
    expect(dureeCourte(60)).toBe("1 h");
    expect(dureeCourte(65)).toBe("1 h 05");
  });
  it("affiche le temps restant d'un minuteur", async () => {
    const { restant } = await import("../web/conversation.ts");
    expect(restant("2026-10-26T14:25:00.000Z", Date.parse("2026-10-26T14:06:28.000Z"))).toBe("18:32");
    expect(restant("2026-10-26T14:25:00.000Z", Date.parse("2026-10-26T15:00:00.000Z"))).toBe("0:00");
  });
});
