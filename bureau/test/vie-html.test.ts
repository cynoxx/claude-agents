import { describe, expect, it } from "vitest";
import { avant, htmlCap, htmlJournal, htmlProjets, htmlStudio, quand } from "../web/vie-html.ts";
import type { VieVue } from "../shared/protocol.ts";

const maintenant = new Date("2026-11-02T10:00:00");
const vie: VieVue = {
  domaines: [],
  projets: [
    { id: "a", nom: "Asclepium", domaine: "business", categorie: "Vidéos monétisables", prochaineAction: "Loi 9", echeance: "2026-11-03", statut: "actif", maj: "2026-11-01" },
    { id: "b", nom: "Livre <b>", domaine: "business", categorie: "Livre & boutique", statut: "pause", maj: "2026-11-01" },
    { id: "c", nom: "PASS", domaine: "etudes", categorie: "PASS", statut: "actif", maj: "2026-11-01" },
  ],
  focus: [],
  journal: { jour: "2026-11-02", notes: [{ heure: "09:00", texte: "Bio" }], bilan: "Solide", humeur: 3 },
  recents: [],
};

describe("l'écran de ta vie", () => {
  it("dit quand, et combien de jours avant une échéance", () => {
    expect(quand("2026-11-02 19:30", maintenant)).toBe("aujourd'hui 19:30");
    expect(quand("2026-11-03 16:30", maintenant)).toBe("demain 16:30");
    expect(quand("2026-11-05 21:00", maintenant)).toBe("jeu. 21:00");
    expect(avant("2026-11-03", maintenant)).toEqual({ texte: "J-1", urgent: true });
    expect(avant("2026-11-01", maintenant).texte).toBe("en retard");
  });

  it("range les projets d'un pôle par catégorie, échappés, avec le bouton d'étape faite", () => {
    const h = htmlProjets(vie, ["business"], maintenant);
    expect(h).toContain("<h4>Vidéos monétisables</h4>");
    expect(h).toContain("Livre &lt;b&gt;");
    expect(h).toContain('data-action="etape" data-projet="Asclepium"');
    expect(h).not.toContain("PASS");
    expect(htmlProjets({ ...vie, projets: [] }, ["apps"])).toContain("Aucun projet ici");
  });

  it("montre le cap du jour, le Studio et le journal", () => {
    const studio = { dossier: "/x", comptes: [], videos: [{ id: "v", compte: "asclepium", titre: "Loi 8", statut: "montage" as const, publiee: {}, creee: "2026-11-02" }], prochaines: [{ id: "v2", titre: "Loi 7", compte: "Asclepium", plateforme: "tiktok" as const, quand: "2026-11-02 19:30" }] };
    expect(htmlCap({ vie: { ...vie, focus: [vie.projets[0]] }, studio }, maintenant)).toMatch(/Loi 9.*J-1.*Loi 7 · ♪ TikTok aujourd'hui 19:30/s);
    const s = htmlStudio(studio, maintenant);
    expect(s).toContain("Montage en cours : Loi 8");
    expect(s).toContain('data-action="publier" data-video="v2" data-plateforme="tiktok"');
    expect(htmlStudio(undefined)).toContain("iCloud Drive");
    expect(htmlJournal(vie)).toContain("Solide");
    expect(htmlJournal(vie)).toContain("●●●○○");
  });
});
