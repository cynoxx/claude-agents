// Préparer un texte pour la voix : quoi lire, comment le couper, quelle voix choisir. Fonctions pures.

export interface VoixInfo {
  name: string;
  lang: string;
  localService: boolean;
}

const PONCTUATION_FIN = /[.!?…:;]$/;
const TITRE = /^#{1,6}\s/;
const TITRE_RESUME = /3 lignes|r[ée]sum[ée]|en bref|synth[èe]se/i;

function nettoyer(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/(^|[\s(])[*_]([^*_]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Markdown → texte que l'on peut lire à voix haute : sans tableaux, code, liens ni emojis. */
export function texteParle(markdown: string): string {
  const unites: string[] = [];
  let paragraphe: string[] = [];
  const fermer = () => {
    if (paragraphe.length) unites.push(paragraphe.join(" "));
    paragraphe = [];
  };
  let code = false;
  for (const brut of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(brut)) {
      fermer();
      code = !code;
      continue;
    }
    if (code) continue;
    const l = brut.trim();
    if (!l || l.startsWith("|") || /^[-*_]{3,}$/.test(l)) {
      fermer();
      continue;
    }
    const titre = l.match(/^#{1,6}\s+(.*)$/);
    const puce = l.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (titre || puce) {
      fermer();
      unites.push((titre ?? puce)![1]);
      continue;
    }
    paragraphe.push(l.replace(/^>\s?/, ""));
  }
  fermer();
  return unites
    .map(nettoyer)
    .filter(Boolean)
    .map((u) => (PONCTUATION_FIN.test(u) ? u : u + "."))
    .join(" ");
}

/** Coupe à la fin d'une phrase sous la limite ; à défaut, au dernier mot avec « … ». */
export function couper(texte: string, max: number): string {
  if (texte.length <= max) return texte;
  const morceau = texte.slice(0, max + 1);
  const fin = Math.max(morceau.lastIndexOf(". "), morceau.lastIndexOf("! "), morceau.lastIndexOf("? "));
  if (fin > 0) return morceau.slice(0, fin + 1);
  const base = texte.slice(0, max);
  const espace = base.lastIndexOf(" ");
  return (espace > 0 ? base.slice(0, espace) : base) + "…";
}

function sectionApres(lignes: string[], debut: number): string {
  const out: string[] = [];
  for (let i = debut; i < lignes.length && !TITRE.test(lignes[i]); i++) out.push(lignes[i]);
  return out.join("\n");
}

/** Ce que Max lit à la fin : la section « En 3 lignes » de RESULTAT.md, sinon le début du texte. */
export function extraireResume(markdown: string, max = 420): string {
  const lignes = markdown.replace(/\r\n/g, "\n").split("\n");
  const debuts = [0, ...lignes.flatMap((l, i) => (TITRE.test(l) ? [i + 1] : []))];
  const estResume = (d: number) => d > 0 && TITRE_RESUME.test(lignes[d - 1]);
  for (const d of [...debuts.filter(estResume), ...debuts.filter((d) => !estResume(d))]) {
    const t = texteParle(sectionApres(lignes, d));
    if (t) return couper(t, max);
  }
  return "";
}

/** La meilleure voix française disponible : France d'abord, qualité supérieure et voix locale de préférence. */
export function choisirVoix<T extends VoixInfo>(voix: T[]): T | null {
  const lang = (v: T) => v.lang.toLowerCase().replace("_", "-");
  const score = (v: T) => (lang(v) === "fr-fr" ? 100 : 50) + (/premium|enhanced|am[ée]lior|siri|neural|natural/i.test(v.name) ? 40 : 0) + (v.localService ? 10 : 0);
  return voix
    .filter((v) => lang(v).startsWith("fr"))
    .reduce<T | null>((meilleure, v) => (!meilleure || score(v) > score(meilleure) ? v : meilleure), null);
}
