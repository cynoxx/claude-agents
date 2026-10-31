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

const mots = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter((m) => m.length > 1);

/**
 * Pendant que Max parle, le micro entend aussi sa voix (elle sort des haut-parleurs). Ce qui ressemble à ce qu'il
 * est en train de dire, c'est lui ; ce qui n'y ressemble pas (au moins 2 mots, dont plus de la moitié absents de ses
 * phrases), c'est toi qui lui coupes la parole.
 */
export function tuLuiCoupesLaParole(entendu: string, phrasesDeMax: string[]): boolean {
  if (estCoupure(entendu)) return true;
  const m = mots(entendu);
  if (m.length < 2) return false;
  const siens = new Set(phrasesDeMax.flatMap(mots));
  const etrangers = m.filter((x) => !siens.has(x)).length;
  return etrangers / m.length > 0.5;
}
