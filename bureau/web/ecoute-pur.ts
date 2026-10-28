// L'écoute de la page, sans DOM (testable).

/** Pendant que Max parle, ces mots le font taire tout de suite. */
const COUPURE = /\b(stop|stoppe|tais[- ]toi|taisez[- ]vous|chut|attends|attend|arr[êe]te|silence|ferme[- ]la)\b/i;

export const estCoupure = (texte: string): boolean => COUPURE.test(texte);

/** Les morceaux entendus → une phrase propre (espaces, doublons de fin de morceau). */
export function texteFinal(morceaux: string[]): string {
  const out: string[] = [];
  for (const m of morceaux.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (out.at(-1)?.toLowerCase() === m.toLowerCase()) continue;
    out.push(m);
  }
  return out.join(" ").trim();
}
