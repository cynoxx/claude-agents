// Calculs purs pour la reconnaissance du visage : l'orientation de la tête, et la preuve que c'est un vrai
// visage et pas une photo (la tête tourne à gauche puis à droite).

export interface Point {
  x: number;
  y: number;
}

/**
 * Où est le nez entre les deux bords de la mâchoire (points 0, 16 et 30 des 68 repères de face-api) :
 * environ 0,5 de face, moins quand la tête tourne d'un côté, plus de l'autre. Une photo, même tenue de biais,
 * garde la même valeur (l'écrasement est le même partout), alors qu'une vraie tête qui tourne la fait varier.
 */
export function lacet(points: Point[]): number {
  if (points.length < 31) return NaN;
  const largeur = points[16].x - points[0].x;
  return largeur ? (points[30].x - points[0].x) / largeur : NaN;
}

/** A-t-on vu la tête tourner des deux côtés ? */
export class MouvementTete {
  private min = Infinity;
  private max = -Infinity;
  vu = false;

  constructor(
    private gauche = 0.4,
    private droite = 0.6,
  ) {}

  ajouter(l: number): boolean {
    if (!Number.isFinite(l)) return this.vu;
    this.min = Math.min(this.min, l);
    this.max = Math.max(this.max, l);
    if (this.min < this.gauche && this.max > this.droite) this.vu = true;
    return this.vu;
  }

  /** Ce qu'il reste à faire : tourner à gauche, à droite, ou rien. */
  get reste(): "gauche" | "droite" | "les deux" | null {
    if (this.vu) return null;
    const g = this.min < this.gauche;
    const d = this.max > this.droite;
    return g ? "droite" : d ? "gauche" : "les deux";
  }
}
