// La voix humaine de Max : ElevenLabs (dans le nuage). Chaque phrase est envoyée à ElevenLabs, qui renvoie le son
// (PCM 24 kHz, rangé en WAV comme celui de Piper). Les phrases courtes qui reviennent (« Je t'écoute. ») sont gardées
// en cache, pour ne pas les payer deux fois. Si ElevenLabs ne répond pas (internet, quota épuisé), la voix d'avant
// (Piper, puis `say`) prend le relais toute seule : Max ne se tait jamais.
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PiperLike } from "./bouche.ts";
import { encoderWav } from "./wav.ts";

export const API_ELEVENLABS = "https://api.elevenlabs.io";
const TAUX = 24_000;
const CACHE_MAX_CARACTERES = 120;
const CACHE_MAX_FICHIERS = 400;

export interface ElevenLabsConfig {
  /** Ta clé API ElevenLabs (ou la variable ELEVENLABS_API_KEY). */
  cle: string;
  /** L'identifiant de la voix choisie (`npm run voix-humaine`). */
  voix: string | null;
  /** Son nom, pour l'afficher. */
  nomVoix: string | null;
  /** eleven_multilingual_v2 (la plus naturelle) ou eleven_flash_v2_5 (plus rapide, moitié moins de crédits). */
  modele: string;
  /** 0 à 1 : plus bas = plus expressif, plus haut = plus régulier. */
  stabilite: number;
  similarite: number;
  /** 0 à 1 : l'intensité du jeu d'acteur. */
  style: number;
  /** 0,7 à 1,2. */
  vitesse: number;
}

export type Recuperer = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}>;

export interface Quota {
  utilises: number;
  limite: number;
  /** Date de remise à zéro (ms). */
  remiseAZero: number | null;
}

/** La clé : celle de la config, sinon la variable d'environnement. */
export const cleElevenLabs = (c: Pick<ElevenLabsConfig, "cle">) => c.cle || process.env.ELEVENLABS_API_KEY || "";

/** Le message lisible d'une erreur ElevenLabs (quota épuisé, clé refusée…). */
export function messageErreur(status: number, corps: unknown): string {
  const d = (corps as { detail?: { status?: string; message?: string } | { msg?: string }[] })?.detail;
  const statut = !Array.isArray(d) ? d?.status : undefined;
  const message = Array.isArray(d) ? d.map((x) => x.msg).join(" ; ") : d?.message;
  if (status === 401) return statut === "quota_exceeded" ? "le quota du mois est épuisé" : "la clé API est refusée";
  if (statut === "quota_exceeded") return "le quota du mois est épuisé";
  if (status === 404) return "la voix est introuvable dans ton compte";
  if (status === 429) return "trop de demandes en même temps";
  return message ? `${status} : ${message}` : `erreur ${status}`;
}

export class ElevenLabs implements PiperLike {
  private recuperer: Recuperer;
  private dernierTexte = "";
  private dernierQuand = 0;
  quota: Quota | null = null;

  constructor(
    private c: ElevenLabsConfig,
    private o: { dossierCache: string; recuperer?: Recuperer; delaiMs?: number },
  ) {
    this.recuperer = o.recuperer ?? ((url, init) => fetch(url, init));
  }

  private get entetes(): Record<string, string> {
    return { "xi-api-key": cleElevenLabs(this.c), "content-type": "application/json" };
  }

  get nom(): string {
    return this.c.nomVoix || "voix ElevenLabs";
  }

  /** Vérifie la clé (et lit le quota du mois). */
  async demarrer(): Promise<void> {
    if (!cleElevenLabs(this.c)) throw new Error("pas de clé ElevenLabs");
    if (!this.c.voix) throw new Error("pas de voix choisie (npm run voix-humaine)");
    this.quota = await lireQuota(this.recuperer, cleElevenLabs(this.c));
  }

  arreter(): void {}

  /** La clé du cache : la même phrase, avec la même voix et les mêmes réglages. */
  private cleCache(texte: string): string {
    const c = this.c;
    return crypto.createHash("sha1").update(JSON.stringify([c.voix, c.modele, c.stabilite, c.similarite, c.style, c.vitesse, texte])).digest("hex");
  }

  async synthetiser(texte: string, fichier: string): Promise<void> {
    const enCache = texte.length <= CACHE_MAX_CARACTERES ? path.join(this.o.dossierCache, `${this.cleCache(texte)}.wav`) : null;
    if (enCache && fs.existsSync(enCache)) {
      fs.copyFileSync(enCache, fichier);
      return;
    }
    const c = this.c;
    // la phrase d'avant (dite il y a peu) aide ElevenLabs à garder le même ton d'une phrase à l'autre
    const avant = Date.now() - this.dernierQuand < 20_000 ? this.dernierTexte : "";
    const corps = {
      text: texte,
      model_id: c.modele,
      ...(c.modele.includes("multilingual_v2") ? {} : { language_code: "fr" }),
      ...(avant ? { previous_text: avant } : {}),
      voice_settings: { stability: c.stabilite, similarity_boost: c.similarite, style: c.style, use_speaker_boost: true, speed: c.vitesse },
    };
    const r = await this.recuperer(`${API_ELEVENLABS}/v1/text-to-speech/${encodeURIComponent(c.voix ?? "")}?output_format=pcm_${TAUX}`, {
      method: "POST",
      headers: this.entetes,
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(this.o.delaiMs ?? 12_000),
    });
    if (!r.ok) throw new Error(`ElevenLabs : ${messageErreur(r.status, await r.json().catch(() => null))}`);
    const brut = Buffer.from(await r.arrayBuffer());
    if (brut.length < 2) throw new Error("ElevenLabs : son vide");
    const pcm = new Int16Array(brut.buffer.slice(brut.byteOffset, brut.byteOffset + (brut.length - (brut.length % 2))));
    const wav = encoderWav(pcm, TAUX);
    fs.writeFileSync(fichier, wav);
    this.dernierTexte = texte;
    this.dernierQuand = Date.now();
    if (this.quota) this.quota.utilises += texte.length;
    if (enCache) {
      try {
        fs.mkdirSync(this.o.dossierCache, { recursive: true });
        fs.writeFileSync(enCache, wav);
        nettoyerCache(this.o.dossierCache);
      } catch {
        // le cache n'est qu'un bonus
      }
    }
  }
}

/** Garde le cache sous CACHE_MAX_FICHIERS fichiers (les plus anciens partent). */
export function nettoyerCache(dossier: string, max = CACHE_MAX_FICHIERS): void {
  const fichiers = fs.readdirSync(dossier).filter((f) => f.endsWith(".wav"));
  if (fichiers.length <= max) return;
  fichiers
    .map((f) => ({ f, t: fs.statSync(path.join(dossier, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t)
    .slice(0, fichiers.length - max)
    .forEach(({ f }) => fs.rmSync(path.join(dossier, f), { force: true }));
}

export async function lireQuota(recuperer: Recuperer, cle: string): Promise<Quota> {
  const r = await recuperer(`${API_ELEVENLABS}/v1/user/subscription`, { method: "GET", headers: { "xi-api-key": cle }, signal: AbortSignal.timeout(10_000) });
  const j = (await r.json().catch(() => null)) as { character_count?: number; character_limit?: number; next_character_count_reset_unix?: number } | null;
  if (!r.ok) throw new Error(`ElevenLabs : ${messageErreur(r.status, j)}`);
  return { utilises: j?.character_count ?? 0, limite: j?.character_limit ?? 0, remiseAZero: j?.next_character_count_reset_unix ? j.next_character_count_reset_unix * 1000 : null };
}

/** `say` du Mac, vers un fichier WAV (le dernier secours). */
export class SayVersFichier implements PiperLike {
  constructor(private o: { bin: string; voix: string | null; debit: number }) {}
  async demarrer(): Promise<void> {}
  arreter(): void {}
  synthetiser(texte: string, fichier: string): Promise<void> {
    const args = [...(this.o.voix ? ["-v", this.o.voix] : []), "-r", String(this.o.debit), "-o", fichier, "--file-format=WAVE", "--data-format=LEI16@22050", texte];
    return new Promise((resolve, reject) => execFile(this.o.bin, args, { timeout: 60_000 }, (e) => (e ? reject(e) : resolve())));
  }
}

/**
 * La voix principale, et ses remplaçantes dans l'ordre. Une panne de la principale (internet, quota) la met de côté
 * un moment ; la phrase est dite par la suivante qui marche.
 */
export class AvecSecours implements PiperLike {
  private enPanneJusqua = 0;
  /** Les secours qui ont démarré (tous, tant que `demarrer` n'a pas fait le tri). */
  private secoursPrets: PiperLike[];
  /** La dernière panne de la voix principale, pour le journal et l'écran. */
  panne: string | null = null;

  constructor(
    private principal: PiperLike,
    private secours: PiperLike[],
    private o: { pauseMs?: number; journal?: (m: string) => void } = {},
  ) {
    this.secoursPrets = [...secours];
  }

  async demarrer(): Promise<void> {
    const prets = await Promise.all(this.secours.map((s) => s.demarrer().then(() => s, () => null)));
    this.secoursPrets = prets.filter((s): s is PiperLike => !!s);
    try {
      await this.principal.demarrer();
      this.panne = null;
    } catch (e) {
      this.mettreDeCote((e as Error).message);
      if (!this.secoursPrets.length) throw e;
    }
  }

  arreter(): void {
    this.principal.arreter();
    this.secours.forEach((s) => s.arreter());
  }

  private mettreDeCote(raison: string): void {
    if (this.panne !== raison) this.o.journal?.(`⚠️  Voix principale indisponible (${raison}) : Max prend sa voix de secours.`);
    this.panne = raison;
    // un quota épuisé ne revient pas avant longtemps ; une coupure d'internet, si
    this.enPanneJusqua = Date.now() + (/quota|clé/.test(raison) ? 6 * 3600_000 : (this.o.pauseMs ?? 120_000));
  }

  async synthetiser(texte: string, fichier: string): Promise<void> {
    if (Date.now() >= this.enPanneJusqua) {
      try {
        await this.principal.synthetiser(texte, fichier);
        this.panne = null;
        return;
      } catch (e) {
        this.mettreDeCote((e as Error).message.replace(/^ElevenLabs : /, ""));
      }
    }
    let derniere: unknown = new Error("aucune voix de secours");
    for (const s of this.secoursPrets) {
      try {
        await s.synthetiser(texte, fichier);
        return;
      } catch (e) {
        derniere = e;
      }
    }
    throw derniere;
  }
}
