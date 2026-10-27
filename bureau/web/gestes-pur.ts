// Contrôler Max avec la main : reconnaître une pose (combien de doigts levés) à partir des 21 repères de MediaPipe
// Hands, la voir tenue assez longtemps, ou un balayage de la main ouverte. Sans DOM, pour pouvoir le tester.
import type { Repere } from "./geste-main.ts";

export type Pose = "poing" | "index" | "deux" | "trois" | "paume" | "autre";

/** Les gestes, et ce qu'ils font (affiché dans le README et sur le bouton). */
export type Geste = "poing" | "index" | "deux" | "trois" | "paume" | "balayage-gauche" | "balayage-droite";

export const EMOJI_POSE: Record<Pose, string> = { poing: "✊", index: "☝️", deux: "✌️", trois: "🤟", paume: "✋", autre: "🖐" };

/** Combien de temps tenir la pose pour qu'elle compte (ms), puis la pause avant la suivante. */
export const TENUE_MS = 900;
export const PAUSE_MS = 1600;
/** Un balayage : la main ouverte parcourt cette part de l'image, en moins de BALAYAGE_MS. */
export const BALAYAGE_DISTANCE = 0.28;
export const BALAYAGE_MS = 650;
export const PAUSE_BALAYAGE_MS = 1100;

const POIGNET = 0;
const MAJEUR_BASE = 9;
const dist = (a: Repere, b: Repere) => Math.hypot(a.x - b.x, a.y - b.y);

/** Un doigt est levé si son bout est plus loin du poignet que sa deuxième articulation (quelle que soit la main). */
function leve(main: Repere[], bout: number, articulation: number): boolean {
  return dist(main[bout], main[POIGNET]) > dist(main[articulation], main[POIGNET]) * 1.12;
}

/** La pose de la main : les quatre doigts (le pouce ne compte pas, il est trop variable). */
export function reconnaitrePose(main: Repere[] | null): Pose {
  if (!main || main.length < 21) return "autre";
  // une main trop petite ou de profil donne n'importe quoi : on ne décide pas
  if (dist(main[POIGNET], main[MAJEUR_BASE]) < 0.04) return "autre";
  const [i, m, a, p] = [leve(main, 8, 6), leve(main, 12, 10), leve(main, 16, 14), leve(main, 20, 18)];
  const n = [i, m, a, p].filter(Boolean).length;
  if (n === 0) return "poing";
  if (n === 4) return "paume";
  if (i && !m && !a && !p) return "index";
  if (i && m && !a && !p) return "deux";
  if (i && m && a && !p) return "trois";
  return "autre";
}

export interface Suivi {
  pose: Pose;
  /** 0 à 1 : où en est la pose tenue. */
  progres: number;
  /** Le geste qui vient de se déclencher (une seule fois). */
  geste: Geste | null;
}

/** Suit les poses dans le temps : tenue, pause entre deux gestes, balayage de la main ouverte. */
export class SuiviGestes {
  private pose: Pose = "autre";
  private depuis = 0;
  private pauseJusqua = 0;
  private declenchee = false;
  private pasVueDepuis = 0;
  private trace: { t: number; x: number }[] = [];

  /** `main` : les repères ; `t` : l'heure en ms. Un cadre sans main : `null`. */
  suivre(main: Repere[] | null, t: number): Suivi {
    const pose = reconnaitrePose(main);
    // un petit trou de reconnaissance (un cadre) ne remet pas tout à zéro
    if (pose === "autre" && this.pose !== "autre" && this.pasVueDepuis === 0) this.pasVueDepuis = t;
    if (pose !== "autre") this.pasVueDepuis = 0;
    if (pose !== this.pose && !(pose === "autre" && t - this.pasVueDepuis < 250)) {
      this.pose = pose;
      this.depuis = t;
      this.declenchee = false;
      if (pose !== "paume") this.trace = [];
    }
    let geste: Geste | null = null;
    // le balayage : la main ouverte traverse l'image
    if (main && pose === "paume") {
      const x = 1 - main[MAJEUR_BASE].x; // en miroir : vers ta droite = x qui augmente
      this.trace.push({ t, x });
      while (this.trace.length && t - this.trace[0].t > BALAYAGE_MS) this.trace.shift();
      if (t >= this.pauseJusqua && this.trace.length > 3) {
        const dx = x - this.trace[0].x;
        if (Math.abs(dx) > BALAYAGE_DISTANCE) {
          geste = dx > 0 ? "balayage-droite" : "balayage-gauche";
          this.pauseJusqua = t + PAUSE_BALAYAGE_MS;
          this.declenchee = true; // la main qui balaie n'est pas une paume tenue
          this.trace = [];
        }
      }
    }
    let progres = 0;
    if (!geste && this.pose !== "autre" && !this.declenchee && t >= this.pauseJusqua) {
      progres = Math.min(1, (t - this.depuis) / TENUE_MS);
      if (progres >= 1) {
        geste = this.pose;
        this.declenchee = true;
        this.pauseJusqua = t + PAUSE_MS;
      }
    }
    return { pose: this.pose, progres, geste };
  }

  reinitialiser(): void {
    this.pose = "autre";
    this.declenchee = false;
    this.trace = [];
    this.pasVueDepuis = 0;
  }
}

/** Ce que fait chaque geste, selon l'état de Max. */
export type Action =
  | { type: "reveil" }
  | { type: "taire" }
  | { type: "pole"; pole: string | null }
  | { type: "obscur"; actif: boolean }
  | { type: "vue"; vue: "bureau" | "jarvis" };

export interface ContexteGestes {
  /** Max dort. */
  veille: boolean;
  /** Le mode obscur est actif. */
  obscur: boolean;
  /** Les pôles dans l'ordre, et celui d'ouvert (null : l'accueil). */
  poles: string[];
  pole: string | null;
  /** On est au bureau des robots. */
  auBureau: boolean;
}

/**
 * ✋ (tenue) réveille Max · ✋ balayage : pôle suivant ou précédent · ☝️ retour à l'accueil · ✌️ mode obscur ·
 * 🤟 le bureau des robots (et retour) · ✊ Max se tait.
 */
export function actionPour(geste: Geste, c: ContexteGestes): Action | null {
  switch (geste) {
    case "paume":
      return c.veille ? { type: "reveil" } : null;
    case "poing":
      return { type: "taire" };
    case "index":
      return c.auBureau ? { type: "vue", vue: "jarvis" } : { type: "pole", pole: null };
    case "deux":
      return { type: "obscur", actif: !c.obscur };
    case "trois":
      return { type: "vue", vue: c.auBureau ? "jarvis" : "bureau" };
    case "balayage-droite":
    case "balayage-gauche": {
      if (c.veille || c.auBureau || !c.poles.length) return null;
      // l'accueil fait partie du tour : accueil → études → sport → …
      const ordre: (string | null)[] = [null, ...c.poles];
      const i = Math.max(0, ordre.indexOf(c.pole));
      const suivant = ordre[(i + (geste === "balayage-droite" ? 1 : ordre.length - 1)) % ordre.length];
      return { type: "pole", pole: suivant };
    }
  }
}

/** Le nom d'un geste, pour l'affichage. */
export const NOM_GESTE: Record<Geste, string> = {
  poing: "Max se tait",
  index: "Retour à l'accueil",
  deux: "Mode obscur",
  trois: "Le bureau",
  paume: "Max se réveille",
  "balayage-gauche": "Pôle précédent",
  "balayage-droite": "Pôle suivant",
};
