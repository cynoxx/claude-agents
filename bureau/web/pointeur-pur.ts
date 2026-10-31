// Le pointeur à la main, sans DOM (testable) : à partir des 21 repères de MediaPipe Hands, où est le pointeur sur
// l'écran, et que fait la main (pincer = cliquer ; pincer en bougeant = faire défiler).
//
// - Le point suivi est le milieu entre le pouce et l'index : il bouge à peine quand on pince (pas de saut au clic).
// - Une zone centrale de la caméra couvre tout l'écran : de petits mouvements suffisent, sans sortir du champ.
// - Le filtre « 1 € » lisse les tremblements quand la main est presque immobile, sans retard quand elle bouge vite.
import type { Repere } from "./geste-main.ts";

const POUCE = 4;
const INDEX = 8;
const POIGNET = 0;
const MAJEUR_BASE = 9;
/** Pince fermée sous ce rapport (écart pouce-index / taille de la main), rouverte au-dessus de l'autre. */
export const SEUIL_PINCE = 0.32;
export const SEUIL_LACHE = 0.48;
/** Une pince plus courte que ça, sans grand mouvement, est un clic. */
export const CLIC_MS = 450;
/** Au-delà de ce déplacement (fraction de l'écran) pendant la pince, c'est un défilement, pas un clic. */
export const BOUGE_MAX = 0.04;
/** La zone de la caméra qui couvre l'écran (le reste du champ sert de marge). */
export const ZONE = { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.7 };

/** Le filtre « 1 € » (Casiez et al.) : lisse fort quand c'est lent, peu quand c'est rapide. */
export class FiltreUnEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(
    private minCoupure = 1.2,
    private beta = 8,
    private dCoupure = 1,
  ) {}
  private static alpha(coupure: number, dt: number) {
    const tau = 1 / (2 * Math.PI * coupure);
    return 1 / (1 + tau / dt);
  }
  filtrer(valeur: number, tMs: number): number {
    if (this.x === null) {
      this.x = valeur;
      this.t = tMs;
      return valeur;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const dBrut = (valeur - this.x) / dt;
    this.dx += FiltreUnEuro.alpha(this.dCoupure, dt) * (dBrut - this.dx);
    const coupure = this.minCoupure + this.beta * Math.abs(this.dx);
    this.x += FiltreUnEuro.alpha(coupure, dt) * (valeur - this.x);
    return this.x;
  }
  reinitialiser(): void {
    this.x = null;
    this.dx = 0;
  }
}

export interface EtatPointeur {
  /** La main est-elle vue ? */
  present: boolean;
  /** Position sur l'écran, de 0 à 1 (en miroir : ta main droite à droite). */
  x: number;
  y: number;
  /** Pouce et index pincés en ce moment. */
  pince: boolean;
  /** 0 (main ouverte) à 1 (pince fermée) : pour l'anneau du pointeur. */
  serrage: number;
  /** Un clic vient d'avoir lieu (pince courte relâchée). */
  clic: boolean;
  /** Défilement demandé depuis le cadre précédent (fraction de l'écran ; positif = vers le bas du contenu). */
  defile: number;
}

const dist = (a: Repere, b: Repere) => Math.hypot(a.x - b.x, a.y - b.y);
const borne = (v: number) => Math.max(0, Math.min(1, v));

export class PointeurMain {
  private fx = new FiltreUnEuro();
  private fy = new FiltreUnEuro();
  private pince = false;
  private debutPince = 0;
  private departPince = { x: 0, y: 0 };
  private defileEnCours = false;
  private dernierY = 0;
  private position = { x: 0.5, y: 0.5 };

  suivre(main: Repere[] | null, tMs: number): EtatPointeur {
    if (!main || main.length < 21) {
      this.pince = false;
      this.defileEnCours = false;
      this.fx.reinitialiser();
      this.fy.reinitialiser();
      return { present: false, ...this.position, pince: false, serrage: 0, clic: false, defile: 0 };
    }
    const taille = dist(main[POIGNET], main[MAJEUR_BASE]) || 1e-6;
    const ecart = dist(main[POUCE], main[INDEX]) / taille;
    const brutX = 1 - (main[POUCE].x + main[INDEX].x) / 2; // miroir
    const brutY = (main[POUCE].y + main[INDEX].y) / 2;
    const x = this.fx.filtrer(borne((brutX - (1 - ZONE.x1)) / (ZONE.x1 - ZONE.x0)), tMs);
    const y = this.fy.filtrer(borne((brutY - ZONE.y0) / (ZONE.y1 - ZONE.y0)), tMs);
    this.position = { x, y };
    const serrage = borne((SEUIL_LACHE + 0.25 - ecart) / (SEUIL_LACHE + 0.25 - SEUIL_PINCE));
    let clic = false;
    let defile = 0;
    const etaitPince = this.pince;
    this.pince = this.pince ? ecart < SEUIL_LACHE : ecart < SEUIL_PINCE;
    if (this.pince && !etaitPince) {
      this.debutPince = tMs;
      this.departPince = { x, y };
      this.defileEnCours = false;
      this.dernierY = y;
    } else if (this.pince) {
      const bouge = Math.hypot(x - this.departPince.x, y - this.departPince.y);
      if (!this.defileEnCours && bouge > BOUGE_MAX) this.defileEnCours = true;
      // pincer et monter la main fait remonter le contenu, comme si on le tirait
      if (this.defileEnCours) defile = this.dernierY - y;
      this.dernierY = y;
    } else if (etaitPince) {
      clic = !this.defileEnCours && tMs - this.debutPince < CLIC_MS;
      this.defileEnCours = false;
    }
    return { present: true, x, y, pince: this.pince, serrage, clic, defile };
  }
}

/** Ce que le pointeur peut actionner : le plus proche ancêtre cliquable de l'élément visé. */
export const CLIQUABLE = 'button, a[href], input, textarea, select, label, summary, [role="button"], [data-action], [data-auto], [data-regle], [data-pole], .qg-tuile';
