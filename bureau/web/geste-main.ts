// Le geste de la main pour tourner le corps 3D, sans DOM (testable). On lit les 21 repères de MediaPipe Hands
// (coordonnées 0 à 1 dans l'image de la caméra) : pincer le pouce et l'index « attrape » le corps ; en bougeant la
// main pincée, on le tourne ; en l'approchant de la caméra (la main paraît plus grande), on zoome.

export interface Repere {
  x: number;
  y: number;
  z?: number;
}

export type EtatMain = "aucune" | "ouverte" | "pince";

export interface Mouvement {
  etat: EtatMain;
  /** Rotation à ajouter autour de l'axe vertical (radians) et vers l'avant/arrière. */
  dLacet: number;
  dTangage: number;
  /** Facteur de zoom à appliquer (1 = rien). */
  zoom: number;
  /** Où est la main dans l'image, en miroir (comme dans un miroir : 0 = à ta gauche). */
  position: { x: number; y: number } | null;
}

const POUCE = 4;
const INDEX = 8;
const POIGNET = 0;
const MAJEUR_BASE = 9;
/** Pince fermée sous ce rapport (distance pouce-index / taille de la main), rouverte au-dessus de l'autre. */
const SEUIL_PINCE = 0.33;
const SEUIL_LACHE = 0.5;
/** Une main traversant toute l'image fait environ un tour et demi. */
const SENSIBILITE = 9;

const dist = (a: Repere, b: Repere) => Math.hypot(a.x - b.x, a.y - b.y);

export class GesteMain {
  private pince = false;
  private dernier: { x: number; y: number; taille: number } | null = null;

  /** Un nouveau cadre de la caméra : les repères de la main (ou null s'il n'y en a pas). */
  suivre(main: Repere[] | null): Mouvement {
    if (!main || main.length < 21) {
      this.pince = false;
      this.dernier = null;
      return { etat: "aucune", dLacet: 0, dTangage: 0, zoom: 1, position: null };
    }
    const taille = dist(main[POIGNET], main[MAJEUR_BASE]) || 1e-6;
    const ecart = dist(main[POUCE], main[INDEX]) / taille;
    this.pince = this.pince ? ecart < SEUIL_LACHE : ecart < SEUIL_PINCE;
    const point = { x: (main[POUCE].x + main[INDEX].x) / 2, y: (main[POUCE].y + main[INDEX].y) / 2 };
    const position = { x: 1 - point.x, y: point.y };
    if (!this.pince) {
      this.dernier = null;
      return { etat: "ouverte", dLacet: 0, dTangage: 0, zoom: 1, position };
    }
    let m: Mouvement = { etat: "pince", dLacet: 0, dTangage: 0, zoom: 1, position };
    if (this.dernier) {
      // l'image de la caméra est inversée par rapport à un miroir : main vers ta droite = x qui diminue
      const dx = -(point.x - this.dernier.x);
      const dy = point.y - this.dernier.y;
      const z = taille / this.dernier.taille;
      m = {
        ...m,
        dLacet: Math.abs(dx) > 0.002 ? dx * SENSIBILITE : 0,
        dTangage: Math.abs(dy) > 0.002 ? dy * SENSIBILITE * 0.6 : 0,
        zoom: Math.abs(z - 1) > 0.01 ? Math.min(1.15, Math.max(0.87, z)) : 1,
      };
    }
    this.dernier = { ...point, taille };
    return m;
  }
}
