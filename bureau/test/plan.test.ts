import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blocsDeLaSemaine, Plan, reveilDuJour } from "../server/max/plan.ts";
import { htmlPlan } from "../web/vie-html.ts";

describe("le plan de reconstruction", () => {
  it("fait reculer le réveil de 30 min tous les 3 jours, de 8 h 30 jusqu'à 7 h", () => {
    expect([0, 2, 3, 5, 6, 9, 12, 30].map((n) => reveilDuJour(n))).toEqual(["08:30", "08:30", "08:00", "08:00", "07:30", "07:00", "07:00", "07:00"]);
  });

  it("monte les blocs de médecine semaine après semaine : 3, 5, puis 6", () => {
    expect([1, 2, 3, 8].map(blocsDeLaSemaine)).toEqual([3, 5, 6, 6]);
  });

  it("coche les 3 règles, compte la série des journées à 3/3, et s'affiche", () => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-plan-"));
    let maintenant = new Date("2026-11-02T10:00:00");
    const p = () => new Plan({ dossier, maintenant: () => maintenant });
    const a = p();
    expect(a.vue()).toMatchObject({ jour: 1, semaine: 1, blocs: 3, reveil: "08:30", reveilDemain: "08:30", serie: 0 });
    expect(a.objectifMinutes()).toBe(150);
    a.cocher("lever");
    a.cocher("bloc");
    expect(a.cocher("coucher").texte).toBe("3/3 règles tenues aujourd'hui : bonne journée, quoi qu'il arrive d'autre.");
    maintenant = new Date("2026-11-03T10:00:00");
    const b = p();
    expect(b.vue()).toMatchObject({ jour: 2, serie: 1 });
    b.cocher("lever");
    expect(b.vue().aujourdhui).toEqual({ lever: true, bloc: false, coucher: false });
    maintenant = new Date("2026-11-11T10:00:00");
    expect(p().vue()).toMatchObject({ semaine: 2, blocs: 5, reveil: "07:00" });
    expect(p().cocher("autre" as never).ok).toBe(false);
    const h = htmlPlan(p().vue());
    expect(h).toContain('data-regle="bloc" aria-pressed="false"');
    expect(h).toContain("tient parole envers lui-même");
  });
});

describe("les sanctions d'une quête non réalisée", () => {
  const nouveau = (minutes: Record<string, number> = {}) => {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-sanction-"));
    let maintenant = new Date("2026-11-02T10:00:00");
    const p = () => new Plan({ dossier, maintenant: () => maintenant, minutesDuJour: (j) => minutes[j] ?? 0 });
    return { p, jour: (d: string) => (maintenant = new Date(`${d}T10:00:00`)) };
  };

  it("n'en donne pas le premier jour, ni quand la veille est complète", () => {
    const { p, jour } = nouveau({ "2026-11-02": 150 });
    const a = p();
    expect(a.vue().sanction).toBeUndefined();
    for (const r of ["lever", "bloc", "coucher"] as const) a.cocher(r);
    jour("2026-11-03");
    expect(p().vue().sanction).toBeUndefined();
  });

  it("donne une sanction selon ce qui a manqué hier, une seule, qui ne s'empile pas", () => {
    const { p, jour } = nouveau({ "2026-11-02": 150 });
    const a = p();
    a.cocher("lever");
    a.cocher("bloc"); // il manque « coucher »
    jour("2026-11-03");
    const s = p().vue().sanction!;
    expect(s).toMatchObject({ niveau: 1, statut: "en-cours" });
    expect(s.motif).toEqual(["Couché avant l'heure, sans écran au lit"]);
    // rouvrir la page ne la redonne pas deux fois, et elle ne change pas
    expect(p().vue().sanction).toEqual(s);
  });

  it("monte en gravité avec les conditions manquées, jusqu'à la zone de pénalité", () => {
    const { p, jour } = nouveau(); // aucune règle cochée, aucun bloc : 4 manques
    p();
    jour("2026-11-03");
    const s = p().vue().sanction!;
    expect(s.niveau).toBe(3);
    expect(s.texte).toContain("Zone de pénalité");
    expect(s.motif).toHaveLength(4);
  });

  it("se valide (« faite ») ou s'annule, et le dit à Max", () => {
    const { p, jour } = nouveau();
    p();
    jour("2026-11-03");
    const a = p();
    expect(a.decrire()).toContain("SANCTION EN COURS");
    expect(a.sanction("faite").ok).toBe(true);
    expect(p().vue().sanction?.statut).toBe("faite");
    expect(p().decrire()).toContain("Sanction du jour : faite");
    jour("2026-11-04");
    const b = p();
    expect(b.vue().sanction?.statut).toBe("en-cours");
    expect(b.sanction("annuler").texte).toContain("annulée");
    expect(p().vue().sanction?.statut).toBe("annulee");
    jour("2026-11-05");
    expect(p().sanction("faite").ok).toBe(true); // la veille (4 novembre) n'a rien coché non plus
  });

  it("s'affiche avec ses boutons, puis se range une fois faite", () => {
    const { p, jour } = nouveau();
    p();
    jour("2026-11-03");
    const a = p();
    const h = htmlPlan(a.vue());
    expect(h).toContain("ZONE DE PÉNALITÉ");
    expect(h).toContain('data-sanction="faite"');
    expect(h).toContain('data-sanction="annuler"');
    a.sanction("faite");
    expect(htmlPlan(p().vue())).toContain("Pénalité effectuée");
  });
});
