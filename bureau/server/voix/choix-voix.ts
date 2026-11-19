// Pour `npm run voix-humaine` : trouver dans la bibliothèque d'ElevenLabs les voix françaises qui conviennent à Max
// (un homme, grave et posé), et retenir ton choix dans bureau.config.json.
import fs from "node:fs";

export interface VoixPartagee {
  public_owner_id: string;
  voice_id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  age?: string | null;
  descriptive?: string | null;
  use_case?: string | null;
  language?: string | null;
  locale?: string | null;
  description?: string | null;
  preview_url?: string | null;
  free_users_allowed?: boolean;
  usage_character_count_1y?: number;
}

const GRAVE = /deep|calm|mature|confident|warm|smooth|professional|serious|authoritative|grave|pos[ée]|profond|calme|chaleur|s[ée]rieu|narrat|documentaire|majordome|butler/i;
const A_EVITER = /child|kid|young|teen|cartoon|anime|whisper|asmr|hyper|excited|enfant|ado|jeune|chuchot|dessin anim/i;

/** Le score d'une voix pour Max : homme, français, grave et posé, déjà beaucoup utilisée (gage de qualité). */
export function scoreVoix(v: VoixPartagee): number {
  const texte = [v.descriptive, v.use_case, v.description, v.name, v.age].filter(Boolean).join(" ");
  let s = 0;
  if (v.gender === "male") s += 3;
  if (v.language === "fr" || /^fr/.test(v.locale ?? "")) s += 3;
  if (/fr-FR|france|parisian|standard/i.test(`${v.locale ?? ""} ${v.accent ?? ""}`)) s += 1;
  if (GRAVE.test(texte)) s += 3;
  if (v.age === "middle_aged" || v.age === "old") s += 1;
  if (/narrative|informative|conversational|news/i.test(v.use_case ?? "")) s += 1;
  if (A_EVITER.test(texte)) s -= 5;
  s += Math.min(2, Math.log10(1 + (v.usage_character_count_1y ?? 0)) / 4);
  return s;
}

/** Les meilleures voix pour Max, sans doublon, en gardant celles qu'un compte gratuit peut utiliser s'il le faut. */
export function classerVoix(voix: VoixPartagee[], o: { gratuit: boolean; combien?: number }): VoixPartagee[] {
  const vues = new Set<string>();
  return voix
    .filter((v) => v.preview_url && !(o.gratuit && v.free_users_allowed === false))
    .filter((v) => (vues.has(v.voice_id) ? false : (vues.add(v.voice_id), true)))
    .map((v) => ({ v, s: scoreVoix(v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, o.combien ?? 6)
    .map(({ v }) => v);
}

/** Une ligne pour présenter la voix. */
export function decrireVoix(v: VoixPartagee): string {
  const traits = [v.descriptive, v.age?.replace("_", " "), v.use_case?.replace(/_/g, " "), v.accent].filter(Boolean).join(", ");
  const desc = (v.description ?? "").replace(/\s+/g, " ").trim();
  return `${v.name}${traits ? ` — ${traits}` : ""}${desc ? `\n      ${desc.length > 110 ? desc.slice(0, 109) + "…" : desc}` : ""}`;
}

/** Écrit la clé et la voix choisies dans bureau.config.json (le reste du fichier ne bouge pas). */
export function enregistrerChoix(fichier: string, choix: { cle?: string; voix: string; nomVoix: string }): void {
  let c: Record<string, unknown> = {};
  if (fs.existsSync(fichier)) c = JSON.parse(fs.readFileSync(fichier, "utf8"));
  const voix = (c.voix ?? {}) as Record<string, unknown>;
  const el = (voix.elevenlabs ?? {}) as Record<string, unknown>;
  c.voix = { ...voix, elevenlabs: { ...el, ...(choix.cle ? { cle: choix.cle } : {}), voix: choix.voix, nomVoix: choix.nomVoix } };
  fs.writeFileSync(fichier, JSON.stringify(c, null, 2) + "\n");
}

/** Retient la voix XTTS choisie dans bureau.config.json (le reste du fichier ne bouge pas). */
export function enregistrerLocuteurXtts(fichier: string, locuteur: string): void {
  let c: Record<string, unknown> = {};
  if (fs.existsSync(fichier)) c = JSON.parse(fs.readFileSync(fichier, "utf8"));
  const voix = (c.voix ?? {}) as Record<string, unknown>;
  c.voix = { ...voix, xtts: { ...((voix.xtts ?? {}) as Record<string, unknown>), locuteur } };
  fs.writeFileSync(fichier, JSON.stringify(c, null, 2) + "\n");
}
