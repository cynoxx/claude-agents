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
