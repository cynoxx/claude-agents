// Ouvre un raccourci direct : Notion, Super Productivity (l'appli du Mac, sinon leur page web) ou le tableau Excel.
import type { Mac } from "./mac.ts";
import { LIENS } from "../../shared/liens.ts";

export interface ReglagesLiens {
  notion: string;
  superProductivity: string;
  habitudes: string;
}

export async function ouvrirLien(id: string, mac: Pick<Mac, "ouvrirApp" | "ouvrirSite" | "ouvrirFichier">, r: ReglagesLiens, avantExcel?: () => Promise<unknown>): Promise<{ ok: boolean; texte: string }> {
  const lien = LIENS.find((l) => l.id === id || l.nom.toLowerCase().includes(id.toLowerCase()));
  if (!lien) return { ok: false, texte: `Raccourci inconnu : ${id}. Il y a : ${LIENS.map((l) => l.id).join(", ")}.` };
  if (lien.id === "notion") {
    // l'adresse de ta page si tu l'as donnée (elle s'ouvre dans l'appli si elle est installée), sinon l'appli
    if (r.notion) return mac.ouvrirSite(r.notion);
    const a = await mac.ouvrirApp("Notion");
    return a.ok ? a : mac.ouvrirSite("https://www.notion.so");
  }
  if (lien.id === "super-productivity") {
    if (r.superProductivity) return mac.ouvrirSite(r.superProductivity);
    const a = await mac.ouvrirApp("Super Productivity");
    return a.ok ? a : mac.ouvrirSite("https://app.super-productivity.com");
  }
  await avantExcel?.();
  const f = await mac.ouvrirFichier(r.habitudes);
  return f.ok ? f : { ok: false, texte: `${f.texte} Dis « Max, j'ai prié » (ou coche une règle) : je crée le tableau.` };
}
