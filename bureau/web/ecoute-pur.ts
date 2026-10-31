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
 * est en train de dire, c'est lui ; dès qu'un mot (de plus de deux lettres, pas un chiffre) n'est dans aucune de ses
 * phrases et pèse un tiers de ce qui est entendu, c'est toi qui lui coupes la parole : il se tait tout de suite,
 * sans attendre la fin de ta phrase ni la fin de la sienne.
 */
export function tuLuiCoupesLaParole(entendu: string, phrasesDeMax: string[]): boolean {
  if (estCoupure(entendu)) return true;
  const m = mots(entendu);
  if (!m.length) return false;
  const siens = new Set(phrasesDeMax.flatMap(mots));
  // les nombres sont écrits « 14 » par la reconnaissance et « quatorze » dans sa phrase : on ne les compte pas
  const etrangers = m.filter((x) => x.length > 2 && !/\d/.test(x) && !siens.has(x)).length;
  return etrangers >= 1 && etrangers / m.length >= 0.34;
}
