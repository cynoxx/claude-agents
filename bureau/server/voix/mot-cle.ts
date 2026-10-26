// Est-ce qu'on parle à Max ? Et Whisper a-t-il inventé une phrase sur du silence ?

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Un mot sans sa ponctuation autour, en minuscules sans accents. */
const mot = (tok: string) => sansAccents(tok).replace(/[^a-z0-9']/g, "");

// « Dis », « Hé »… tels que Whisper les écrit parfois : « Dit », « Dix », « D'y », « Et ».
const FORMULES = new Set(["ok", "okay", "hey", "he", "eh", "et", "dis", "dit", "dix", "di", "dy", "d'y", "alors", "bon", "oui", "bonjour", "salut", "coucou", "yo", "allo"]);
/** « Dis Max » prononcé vite devient souvent un seul mot pour Whisper : « Dimax », « Dismax », « DMAX », « G-Max ». */
const PREFIXES_COLLES = ["d", "di", "dis", "dit", "dix", "dy", "g", "j"];

function noms(motCle: string): Set<string> {
  const m = mot(motCle);
  if (m !== "max") return new Set([m]);
  const variantes = ["max", "maxe", "maxs", "maxx", "macs", "mac", "maks"];
  return new Set([...variantes, ...PREFIXES_COLLES.flatMap((p) => variantes.map((v) => p + v))]);
}

const sansPonctuationDebut = (s: string) => s.replace(/^[\s,.:;!?—–-]+/, "").trim();

/**
 * Renvoie ce qu'il faut transmettre à Max, ou `null` si la phrase ne lui est pas adressée.
 * « Max, … » ou « Dis Max, … » au début, ou « …, Max ? » à la fin. Pendant la fenêtre de suite
 * (`enSuite`), toute la phrase est pour lui. Une chaîne vide = on l'a juste appelé.
 */
export function reconnaitreAppel(texte: string, motCle = "max", enSuite = false): string | null {
  const nettoye = texte
    .trim()
    .replace(/^[\s\-–—«"“'(\[]+/, "")
    .replace(/[\s»"”)\]]+$/, "");
  const toks = nettoye.split(/\s+/).filter(Boolean);
  const n = noms(motCle);

  let i = 0;
  while (i < toks.length && i < 2 && FORMULES.has(mot(toks[i])) && !n.has(mot(toks[i]))) i++;
  if (i < toks.length && n.has(mot(toks[i]))) return sansPonctuationDebut(toks.slice(i + 1).join(" "));

  let j = toks.length - 1;
  const ponctuation: string[] = [];
  while (j >= 0 && mot(toks[j]) === "") {
    ponctuation.unshift(toks[j]);
    j--;
  }
  if (j > 0 && n.has(mot(toks[j])) && toks[j - 1].endsWith(",")) {
    const avant = toks.slice(0, j);
    avant[avant.length - 1] = avant[avant.length - 1].replace(/,$/, "");
    return [...avant, ...ponctuation].join(" ");
  }

  return enSuite ? nettoye : null;
}

const INVENTIONS = [
  "sous-titres realises",
  "sous titres realises",
  "sous-titrage",
  "sous-titres par",
  "amara.org",
  "merci d'avoir regarde",
  "abonnez-vous",
  "n'oubliez pas de vous abonner",
  "transcription realisee par",
];

/** Vrai pour ce que Whisper produit sur du silence ou du bruit : rien, « ... », [BLANK_AUDIO], phrases de sous-titres. */
export function estHallucination(texte: string): boolean {
  const n = sansAccents(texte).replace(/\s+/g, " ").trim();
  if (!n.replace(/[\s.…,!?;:'"«»()[\]*\-_]/g, "")) return true;
  if (/^[[(*].*[\])*]$/.test(n)) return true;
  return INVENTIONS.some((p) => n.includes(p));
}
