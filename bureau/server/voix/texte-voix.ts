// Le texte tel qu'une voix neuronale locale (XTTS, Piper) sait le dire : sans symboles ni émojis (qu'elle lit de
// travers ou transforme en bruits), avec les heures, pourcentages et raccourcis écrits en mots, et une ponctuation
// de fin (sans elle, XTTS traîne et invente des syllabes).

const EMOJIS = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

export function pourLaVoix(texte: string): string {
  let t = texte
    .replace(EMOJIS, " ")
    .replace(/[*_`#>|~^]+/g, " ") // le markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "le lien")
    // 19h30, 19 h 30, 7h → 19 heures 30, 7 heures
    .replace(/\b(\d{1,2})\s?h\s?(\d{2})\b/g, (_, h, m) => `${h} heures ${m === "00" ? "" : m}`.trim())
    .replace(/\b(\d{1,2})\s?h\b/g, (_, h) => `${h} ${h === "1" ? "heure" : "heures"}`)
    .replace(/\b(\d+)\s?min\b/g, "$1 minutes")
    .replace(/\bJ\s?-\s?(\d+)\b/g, "J moins $1")
    .replace(/(\d)\s?%/g, "$1 pour cent")
    .replace(/\b(\d)\s?\/\s?(\d)\b/g, "$1 sur $2")
    .replace(/(\d)\s?€/g, "$1 euros")
    .replace(/\s&\s/g, " et ")
    .replace(/\s\+\s/g, " plus ")
    .replace(/(\d)\s?x\s?(\d)/g, "$1 fois $2")
    .replace(/\betc\.?/gi, "et cetera")
    .replace(/[→⇒➜►▶]/g, ", ")
    .replace(/\s[–—-]\s/g, ", ")
    .replace(/[≈~]/g, " environ ")
    .replace(/[✓✔✗✘•·○●◎♪]/g, " ")
    .replace(/[«»"“”()[\]{}]/g, " ")
    .replace(/\s*([,;:.!?…])/g, "$1")
    .replace(/([,;:])(?=\S)/g, "$1 ")
    .replace(/,\s*,+/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:.\s]+/, "");
  if (t && !/[.!?…]$/.test(t)) t += ".";
  return t;
}
