// Max, l'esprit de lumière : tout ce qui se calcule sans écran (testable). Ses humeurs, ses ressorts, et le nuage de
// points qui le dessine : une sphère, et un visage qui affleure dedans quand il te regarde.
import type { EtatMax } from "../../shared/protocol.ts";

export type Humeur = "veille" | "ecoute" | "reflexion" | "parole" | "alerte" | "fete" | "soir";

export interface Reglage {
  /** Couleur du corps et couleur des éclats (rouge, vert, bleu : de 0 à 1). */
  c1: [number, number, number];
  c2: [number, number, number];
  /** À quel point le visage affleure dans la sphère (0 : sphère pure, 1 : visage net). */
  visage: number;
  /** L'agitation de la matière. */
  energie: number;
  taille: number;
  lumiere: number;
  /** Les anneaux (0, 1 ou 2) et les étincelles (0 à 1). */
  anneaux: number;
  etincelles: number;
  /** La vitesse à laquelle il tourne sur lui-même. */
  vitesse: number;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const COULEURS = {
  froid: hex("#6FE0FF"),
  bleu: hex("#2E8BFF"),
  blanc: hex("#EAF6FF"),
  braise: hex("#FF3B2F"),
  feu: hex("#FF7A45"),
  or: hex("#FFD27A"),
  ambre: hex("#FFB36B"),
  ambreClair: hex("#FFE2BF"),
};

export const REGLAGES: Record<Humeur, Reglage> = {
  veille: { c1: COULEURS.bleu, c2: COULEURS.froid, visage: 0.6, energie: 0.25, taille: 0.88, lumiere: 0.7, anneaux: 0, etincelles: 0, vitesse: 0.06 },
  ecoute: { c1: COULEURS.froid, c2: COULEURS.blanc, visage: 0.95, energie: 0.35, taille: 1, lumiere: 1, anneaux: 1, etincelles: 0, vitesse: 0 },
  reflexion: { c1: COULEURS.bleu, c2: COULEURS.blanc, visage: 0.4, energie: 0.9, taille: 0.96, lumiere: 0.95, anneaux: 0, etincelles: 0.45, vitesse: 0.35 },
  parole: { c1: COULEURS.froid, c2: COULEURS.blanc, visage: 0.8, energie: 0.5, taille: 1.04, lumiere: 1.1, anneaux: 0, etincelles: 0, vitesse: 0 },
  alerte: { c1: COULEURS.braise, c2: COULEURS.feu, visage: 0.9, energie: 0.8, taille: 1, lumiere: 1.1, anneaux: 2, etincelles: 0, vitesse: 0 },
  fete: { c1: COULEURS.or, c2: COULEURS.blanc, visage: 0.55, energie: 0.7, taille: 1.08, lumiere: 1.2, anneaux: 0, etincelles: 1, vitesse: 0.25 },
  soir: { c1: COULEURS.ambre, c2: COULEURS.ambreClair, visage: 0.5, energie: 0.12, taille: 0.8, lumiere: 0.5, anneaux: 0, etincelles: 0, vitesse: 0.03 },
};

/** L'heure à partir de laquelle Max passe à l'ambre, et celle où il revient au bleu. */
export const SOIR_DEBUT = 21;
export const SOIR_FIN = 6;

/**
 * L'humeur à montrer : l'alerte (mode obscur, sanction) passe avant tout, puis la fête, puis ce qu'il fait.
 * Le soir, tout ce qui est calme devient ambre ; quand il parle le soir, il garde l'ambre aussi.
 */
export function humeurDe(etat: EtatMax, o: { alerte?: boolean; fete?: boolean; heure?: number } = {}): Humeur {
  if (o.alerte) return "alerte";
  if (o.fete) return "fete";
  const soir = o.heure !== undefined && (o.heure >= SOIR_DEBUT || o.heure < SOIR_FIN);
  if (etat === "veille") return soir ? "soir" : "veille";
  if (etat === "ecoute") return "ecoute";
  if (etat === "reflechit") return "reflexion";
  return "parole";
}

/** Un ressort amorti : la valeur rejoint sa cible avec de l'élan, sans jamais glisser à vitesse constante. */
export class Ressort {
  vitesse = 0;
  constructor(
    public valeur: number,
    /** Raideur (plus haut : plus vif) et amortissement (1 : sans rebond ; en dessous : un léger rebond). */
    private raideur = 60,
    private amorti = 0.85,
  ) {}
  avancer(cible: number, dt: number): number {
    // pas fixes de 4 ms : stable même si une image met longtemps à venir
    let reste = Math.min(dt, 0.1);
    while (reste > 0) {
      const h = Math.min(reste, 0.004);
      const force = (cible - this.valeur) * this.raideur - this.vitesse * 2 * Math.sqrt(this.raideur) * this.amorti;
      this.vitesse += force * h;
      this.valeur += this.vitesse * h;
      reste -= h;
    }
    return this.valeur;
  }
}

// --- le visage -------------------------------------------------------------------------------------------------

const gauss = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
const lisse = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const YEUX: [number, number][] = [
  [-0.3, 0.2],
  [0.3, 0.2],
];

/**
 * Le point de la tête dans une direction donnée (vecteur unité ; +z : vers toi, +y : le haut).
 * Un crâne ovale ; devant, le relief d'un visage : arcades, orbites, nez, pommettes, lèvres, menton, mâchoire.
 */
export function pointVisage(dx: number, dy: number, dz: number): [number, number, number] {
  const devant = lisse(0.05, 0.45, dz);
  // la mâchoire se resserre vers le menton
  const serre = 1 - 0.4 * lisse(-0.1, -0.95, dy) * (0.45 + 0.55 * devant) + 0.05 * lisse(0.2, 0.7, dy);
  let relief = 0;
  if (devant > 0) {
    const x = dx, y = dy;
    relief += 0.075 * gauss(x, y, 0, 0.37, 0.5, 0.07); // les arcades
    for (const [ex, ey] of YEUX) relief -= 0.15 * gauss(x, y, ex, ey, 0.15, 0.085); // les orbites
    const arete = lisse(0.3, -0.16, y); // le nez grossit du front vers sa pointe
    relief += (0.06 + 0.2 * arete) * gauss(x, 0, 0, 0, 0.085 + 0.03 * arete, 1) * lisse(-0.3, -0.17, y) * lisse(0.42, 0.26, y);
    relief += 0.05 * (gauss(x, y, -0.46, -0.04, 0.16, 0.13) + gauss(x, y, 0.46, -0.04, 0.16, 0.13)); // les pommettes
    relief += 0.07 * gauss(x, y, 0, -0.385, 0.2, 0.035) + 0.075 * gauss(x, y, 0, -0.475, 0.17, 0.04); // les lèvres
    relief -= 0.05 * gauss(x, y, 0, -0.43, 0.22, 0.014); // la fente de la bouche
    relief += 0.07 * gauss(x, y, 0, -0.74, 0.17, 0.1); // le menton
  }
  const r = 1 + relief * devant;
  return [dx * 0.8 * serre * r, dy * 1.0 * r, dz * 0.86 * r];
}

/**
 * Les traits du visage (0 à 1) : des lignes de lumière, comme un hologramme. Le contour des yeux, les sourcils,
 * les deux arêtes du nez et sa base, la bouche. `x` et `y` sont ceux de la direction, vue de face.
 */
export function traitVisage(x: number, y: number): number {
  let t = 0;
  for (const [ex, ey] of YEUX) {
    // le contour de l'œil : une amande fine
    const d = Math.hypot((x - ex) / 0.115, (y - ey) / 0.048);
    t = Math.max(t, Math.exp(-(((d - 1) / 0.1) ** 2)));
    // le sourcil : un arc au-dessus, plus bas vers le nez (un regard décidé, pas inquiet)
    const u = (x - ex) / 0.2;
    if (Math.abs(u) < 1) t = Math.max(t, 0.8 * Math.exp(-(((y - (ey + 0.128 - 0.028 * u * u + 0.022 * u * Math.sign(ex))) / 0.009) ** 2)) * (1 - u * u * 0.7));
  }
  // l'arête du nez : un simple fil de lumière (le reste du nez, c'est le relief qui le dessine)
  if (y < 0.1 && y > -0.17) t = Math.max(t, 0.4 * Math.exp(-((x / 0.01) ** 2)));
  // la bouche : la ligne entre les lèvres, fine, un peu relevée aux coins
  if (Math.abs(x) < 0.24) t = Math.max(t, 0.85 * Math.exp(-(((y + 0.43 - 0.014 * (x / 0.24) ** 2) / 0.007) ** 2)) * (1 - 0.7 * (x / 0.24) ** 2));
  return t;
}

export interface Nuage {
  n: number;
  /** Positions sur la sphère, sur le visage, et la normale du visage (3 nombres par point). */
  sphere: Float32Array;
  visage: Float32Array;
  normale: Float32Array;
  /** Par point : un hasard (0 à 1), le poids de la mâchoire (elle descend quand il parle), l'orbite (0 à 1), le trait (0 à 1). */
  info: Float32Array;
}

/** Un hasard reproductible (le même Max à chaque lancement). */
export function hasard(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const norme = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Le nuage de points de Max : `n` points répartis régulièrement (spirale de Fibonacci), plus serrés sur le visage. */
export function nuage(n: number, graine = 7): Nuage {
  const h = hasard(graine);
  const sphere = new Float32Array(n * 3);
  const visage = new Float32Array(n * 3);
  const normale = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  const or = Math.PI * (3 - Math.sqrt(5));
  const e = 0.004;
  // les points sont rangés dans un ordre mélangé : en dessiner moins (machine lente) éclaircit Max partout, sans le couper
  let pas = 7919;
  const pgcd = (x: number, y: number): number => (y ? pgcd(y, x % y) : x);
  while (pgcd(pas, n) !== 1) pas++;
  for (let rang = 0; rang < n; rang++) {
    const i = (rang * pas) % n;
    // un point sur deux est tiré vers l'avant : le visage a plus de matière que la nuque
    let y = 1 - ((i + 0.5) / n) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * or;
    let x = Math.cos(th) * rr;
    let z = Math.sin(th) * rr;
    if (i % 2 === 0 && z < 0) z = -z;
    // un léger tremblé : pas de lignes trop régulières
    [x, y, z] = norme([x + (h() - 0.5) * 0.02, y + (h() - 0.5) * 0.02, z + (h() - 0.5) * 0.02]);
    sphere.set([x, y, z], rang * 3);
    // un point sur onze va se poser sur un trait du visage (sourcil, œil, nez, bouche) : les lignes sont pleines
    let vx = x, vy = y, vz = z;
    if (rang % 11 === 0) {
      for (let essai = 0; essai < 60; essai++) {
        const tx = (h() - 0.5) * 1.1, ty = h() * 0.95 - 0.52;
        if (traitVisage(tx, ty) > 0.45) {
          [vx, vy, vz] = [tx, ty, Math.sqrt(Math.max(0, 1 - tx * tx - ty * ty))];
          break;
        }
      }
    }
    const p = pointVisage(vx, vy, vz);
    visage.set(p, rang * 3);
    // la normale : le produit de deux petits pas sur la surface
    const t1 = norme([-vz, 0, vx].every((v) => Math.abs(v) < 1e-6) ? [1, 0, 0] : [-vz, 0, vx]);
    const t2: [number, number, number] = [vy * t1[2] - vz * t1[1], vz * t1[0] - vx * t1[2], vx * t1[1] - vy * t1[0]];
    const a = pointVisage(...norme([vx + t1[0] * e, vy + t1[1] * e, vz + t1[2] * e]));
    const b = pointVisage(...norme([vx + t2[0] * e, vy + t2[1] * e, vz + t2[2] * e]));
    const u = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
    const v = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
    let nn = norme([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
    if (nn[0] * vx + nn[1] * vy + nn[2] * vz < 0) nn = [-nn[0], -nn[1], -nn[2]];
    normale.set(nn, rang * 3);
    const devant = lisse(0.05, 0.45, vz);
    const machoire = devant * lisse(-0.4, -0.62, vy) * gauss(vx, 0, 0, 0, 0.5, 1);
    const oeil = devant * Math.max(...YEUX.map(([ex, ey]) => gauss(vx, vy, ex, ey, 0.085, 0.04)));
    info.set([h(), machoire, oeil, devant * traitVisage(vx, vy)], rang * 4);
  }
  return { n, sphere, visage, normale, info };
}

/**
 * La voix sans micro : une enveloppe qui ressemble à des syllabes (0 à 1) et 8 bandes de spectre, à partir du temps.
 * Elle sert tant que le vrai son de la voix n'arrive pas jusqu'à la page.
 */
export function voixSimulee(t: number): { niveau: number; bandes: number[] } {
  const syllabe = Math.max(0, Math.sin(t * 9.1) * 0.6 + Math.sin(t * 5.3 + 1.7) * 0.5 + Math.sin(t * 2.1) * 0.3);
  const souffle = 0.75 + 0.25 * Math.sin(t * 0.9); // les pauses entre les phrases
  const niveau = Math.min(1, syllabe * 0.75 * souffle);
  const bandes = Array.from({ length: 8 }, (_, i) => Math.min(1, niveau * (0.45 + 0.55 * Math.abs(Math.sin(t * (3 + i * 1.7) + i * 2.1))) * (1 - i * 0.07)));
  return { niveau, bandes };
}
