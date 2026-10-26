// Max en buste humanoïde, façon hologramme de particules : un visage fait de lignes de contour bleues, un cœur
// orange qui brille dans le visage (plus fort quand il parle), des veines dorées dans le cou, des particules qui
// s'envolent de la tête, et des ondes autour de lui quand il écoute. Sa tête suit ton visage (caméra, voir
// regard.ts) ou ton pointeur, en tournant vraiment : les contours intérieurs bougent plus que le bord, comme un
// volume. Des anneaux de données tournent autour de lui. Il apparaît en comète de particules, et s'illumine quand
// tu reviens devant l'écran. Même interface que l'ancienne sphère.
import type { EtatMax } from "../shared/protocol.ts";

interface Reglage {
  lumiere: number; // intensité des lignes
  coeur: number; // éclat du cœur orange
  ondes: number; // ondes autour de la tête
  vitesse: number; // particules
  dore: number; // 0 = cœur orange, 1 = cœur doré (il réfléchit)
}

const REGLAGES: Record<EtatMax, Reglage> = {
  veille: { lumiere: 0.5, coeur: 0.45, ondes: 0, vitesse: 0.3, dore: 0 },
  ecoute: { lumiere: 1, coeur: 0.85, ondes: 1, vitesse: 0.8, dore: 0 },
  reflechit: { lumiere: 1, coeur: 0.95, ondes: 0.3, vitesse: 1.8, dore: 1 },
  parle: { lumiere: 1, coeur: 1, ondes: 0.7, vitesse: 1, dore: 0 },
};

const BLEU = [96, 200, 255];
const ROUGE = [255, 38, 38];

/** Mélange deux couleurs (k de 0 à 1) en « rgba(…) ». */
export function melange(a: number[], b: number[], k: number, alpha: number): string {
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0, Math.min(1, alpha))})`;
}
const NB_PARTICULES = 420;
const APPARITION_S = 2.4;
const SALUT_S = 1.8;

/** Le contour de la tête : un œuf, plus étroit au menton. t de 0 (sommet) à 2π. */
export function pointTete(t: number, cx: number, cy: number, rx: number, ry: number, k = 1): [number, number] {
  const bas = Math.max(0, -Math.cos(t));
  const largeur = 1 - 0.24 * Math.pow(bas, 1.6);
  return [cx + Math.sin(t) * rx * largeur * k, cy - Math.cos(t) * ry * k];
}

/** Petit générateur pseudo-aléatoire, pour que les veines restent les mêmes d'une image à l'autre. */
function hasard(graine: number): () => number {
  let s = graine;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export class Humanoide {
  private ctx: CanvasRenderingContext2D;
  private actuel: Reglage = { ...REGLAGES.veille };
  private cible: Reglage = REGLAGES.veille;
  private t = 0;
  private dernier = 0;
  private voix = 0;
  private zoom = 1;
  private anim = 0;
  /** Où regarde la tête (-1 à 1), d'après le pointeur. */
  private regard = { x: 0, y: 0 };
  private regardCible = { x: 0, y: 0 };
  private apparition = -1;
  /** La caméra a la main sur le regard jusqu'à ce moment (le pointeur attend). */
  private cameraJusqua = 0;
  /** Le salut quand tu reviens (secondes écoulées, -1 = rien). */
  private salut = -1;
  /** Les anneaux de données (heure, état, échéance…). */
  private etiquettes: string[] = [];
  /** Max Ultime : 0 = Max normal (bleu), 1 = Max Ultime (rouge, les yeux, le rictus). */
  private ob = 0;
  private obCible = 0;
  private particules = Array.from({ length: NB_PARTICULES }, () => this.nouvelleParticule(Math.random()));
  private veines: [number, number][][];

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    const redim = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
    };
    new ResizeObserver(redim).observe(canvas);
    redim();
    // les veines du cou : des lignes qui montent de la poitrine en se ramifiant
    const h = hasard(7);
    this.veines = [];
    for (let v = 0; v < 7; v++) {
      const pts: [number, number][] = [];
      let x = (h() - 0.5) * 0.05;
      for (let y = 0.84; y > 0.55; y -= 0.025) {
        x += (h() - 0.5) * 0.018;
        pts.push([x * (1 - (0.84 - y) * 1.2), y]);
      }
      this.veines.push(pts);
    }
    window.addEventListener("pointermove", (e) => {
      if (performance.now() < this.cameraJusqua) return;
      this.regardCible = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
    });
    window.addEventListener("max-apparait", () => this.apparaitre());
  }

  etat(e: EtatMax): void {
    this.cible = REGLAGES[e];
  }

  /** Grossit le visage (la plongée vers le bureau) : 1 = normal. */
  agrandir(z: number): void {
    this.zoom = z;
  }

  /** Max Ultime : il vire au rouge, ses yeux s'allument. */
  obscur(actif: boolean): void {
    this.obCible = actif ? 1 : 0;
  }

  /** Regarde vers toi (de -1 à 1, comme le pointeur), d'après la caméra. */
  regarder(x: number, y: number): void {
    this.cameraJusqua = performance.now() + 1500;
    this.regardCible = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  /** Tu reviens : son cœur s'embrase et une onde dorée part de lui. */
  saluer(): void {
    this.salut = 0;
  }

  /** Les textes des anneaux de données autour de lui. */
  donnees(etiquettes: string[]): void {
    this.etiquettes = etiquettes.slice(0, 4);
  }

  /** Sa voix (0 à 1), pour que le décor vibre avec lui. */
  get niveauVoix(): number {
    return this.voix;
  }

  /** La comète de particules qui vient former le buste. */
  apparaitre(): void {
    this.apparition = 0;
  }

  demarrer(): void {
    this.apparaitre();
    const boucle = (ms: number) => {
      this.anim = requestAnimationFrame(boucle);
      if (document.hidden) return;
      const dt = Math.min(0.05, (ms - (this.dernier || ms)) / 1000);
      this.dernier = ms;
      this.dessiner(dt);
    };
    this.anim = requestAnimationFrame(boucle);
  }

  arreter(): void {
    cancelAnimationFrame(this.anim);
  }

  private nouvelleParticule(age = 0) {
    // elles naissent sur le haut du crâne et s'envolent
    const t = (Math.random() - 0.5) * 2.4;
    return { t, age, vie: 1.5 + Math.random() * 2.5, dx: Math.sin(t) * (0.2 + Math.random() * 0.5), dy: -(0.3 + Math.random() * 0.7), taille: 0.5 + Math.random() * 1.3 };
  }

  private dessiner(dt: number): void {
    const a = this.actuel;
    const c = this.cible;
    const k = Math.min(1, dt * 3);
    for (const cle of Object.keys(a) as (keyof Reglage)[]) a[cle] += (c[cle] - a[cle]) * k;
    this.t += dt;
    const parle = this.cible === REGLAGES.parle;
    const cibleVoix = parle ? 0.35 + 0.65 * Math.abs(Math.sin(this.t * 9.3) * Math.sin(this.t * 3.7 + 1)) : 0;
    this.voix += (cibleVoix - this.voix) * Math.min(1, dt * 12);
    this.regard.x += (this.regardCible.x - this.regard.x) * Math.min(1, dt * 2.5);
    this.regard.y += (this.regardCible.y - this.regard.y) * Math.min(1, dt * 2.5);
    if (this.apparition >= 0) this.apparition += dt;
    this.ob += (this.obCible - this.ob) * Math.min(1, dt * 2.2);
    const ob = this.ob;
    if (this.salut >= 0) this.salut = this.salut + dt > SALUT_S ? -1 : this.salut + dt;
    // le salut : un éclat qui monte vite et redescend doucement
    const sal = this.salut < 0 ? 0 : Math.min(1, this.salut / 0.25) * Math.max(0, 1 - this.salut / SALUT_S);
    const app = this.apparition < 0 ? 1 : Math.min(1, Math.max(0, (this.apparition - 0.8) / (APPARITION_S - 0.8)));

    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    const S = Math.min(w, h);
    const petit = S < 140;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    // le centre du dessin : un carré S×S au milieu ; le zoom se fait sur le cœur
    const ox = (w - S) / 2;
    const oy = (h - S) / 2;
    const coeurX = ox + S * 0.5;
    const coeurY = oy + S * 0.38;
    ctx.translate(coeurX, coeurY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-coeurX, -coeurY);

    const bleu = (alpha: number) => melange(BLEU, ROUGE, ob, alpha);
    // la tête suit le pointeur (et se balance un peu toute seule)
    const balance = Math.sin(this.t * 0.6) * 0.15;
    const cx = ox + S * 0.5 + (this.regard.x * 0.025 + balance * 0.01) * S;
    const cy = oy + S * 0.34 + this.regard.y * 0.012 * S;
    const rx = S * 0.15;
    const ry = S * 0.19;
    const L = Math.min(1.3, a.lumiere * app + sal * 0.5);
    // la tête tourne : plus un contour est à l'intérieur, plus il se décale (effet de volume)
    const tx = this.regard.x * rx * 0.55;
    const ty = this.regard.y * ry * 0.35;

    // la comète : un nuage de particules qui tourne et vient se poser
    if (this.apparition >= 0 && this.apparition < APPARITION_S) {
      const p = Math.min(1, this.apparition / 1.2);
      for (let i = 0; i < 160; i++) {
        const q = Math.max(0, p - i * 0.004);
        const ang = -2.6 + q * 3.4;
        const rr = S * 0.42 * (1 - q * 0.75);
        const x = ox + S * 0.5 + Math.cos(ang) * rr + Math.sin(i * 12.9) * S * 0.01;
        const y = oy + S * 0.72 + Math.sin(ang) * rr * 0.55 + Math.cos(i * 7.3) * S * 0.01;
        ctx.fillStyle = bleu((1 - i / 160) * (1 - app));
        ctx.beginPath();
        ctx.arc(x, y, (1.6 - i / 160) * (S / 400), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // les anneaux de données : des arcs qui tournent lentement, graduations et petits textes
    if (!petit && app > 0.05) this.anneaux(cx, cy + ry * 0.15, ry * 1.85, S, app, a.lumiere);

    // le salut : une onde dorée qui part du cœur
    if (!petit && sal > 0) {
      const p = this.salut / SALUT_S;
      for (let i = 0; i < 3; i++) {
        const q = Math.max(0, p - i * 0.08);
        ctx.strokeStyle = melange([255, 200, 110], [255, 60, 40], ob, (1 - q) * 0.7 * (1 - i * 0.25));
        ctx.lineWidth = Math.max(1, (S / 300) * (1 - q));
        ctx.beginPath();
        ctx.ellipse(cx, cy + ry * 0.12, rx * (0.6 + q * 4.5), ry * (0.5 + q * 3.6), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // les ondes autour de la tête
    if (!petit && a.ondes > 0.02) {
      for (let i = 0; i < 4; i++) {
        const phase = (this.t * 0.35 + i / 4) % 1;
        ctx.strokeStyle = bleu(a.ondes * (1 - phase) * 0.35 * app);
        ctx.lineWidth = Math.max(1, S / 700);
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * (1.2 + phase * 1.6), ry * (1.15 + phase * 1.4), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // le buste : épaules et cou, en contours emboîtés
    const basY = oy + S;
    const buste = (kb: number) => {
      ctx.beginPath();
      const sx = ox + S * 0.5;
      ctx.moveTo(sx - S * 0.44 * kb, basY);
      ctx.bezierCurveTo(sx - S * 0.42 * kb, oy + S * (0.8 + (1 - kb) * 0.1), sx - S * 0.3 * kb, oy + S * (0.7 + (1 - kb) * 0.08), sx - S * 0.08, oy + S * (0.64 + (1 - kb) * 0.05));
      ctx.quadraticCurveTo(sx - S * 0.05, oy + S * 0.6, cx - rx * 0.45, cy + ry * 0.82);
      ctx.moveTo(cx + rx * 0.45, cy + ry * 0.82);
      ctx.quadraticCurveTo(sx + S * 0.05, oy + S * 0.6, sx + S * 0.08, oy + S * (0.64 + (1 - kb) * 0.05));
      ctx.bezierCurveTo(sx + S * 0.3 * kb, oy + S * (0.7 + (1 - kb) * 0.08), sx + S * 0.42 * kb, oy + S * (0.8 + (1 - kb) * 0.1), sx + S * 0.44 * kb, basY);
      ctx.stroke();
    };
    ctx.lineCap = "round";
    // Max cache ce qui est derrière lui (les montagnes) : son corps est sombre, ses lignes lumineuses
    {
      const sx = ox + S * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - S * 0.44, basY);
      ctx.bezierCurveTo(sx - S * 0.42, oy + S * 0.8, sx - S * 0.3, oy + S * 0.7, sx - S * 0.075, oy + S * 0.64);
      ctx.quadraticCurveTo(sx - S * 0.05, oy + S * 0.6, cx - rx * 0.45, cy + ry * 0.82);
      ctx.lineTo(cx + rx * 0.45, cy + ry * 0.82);
      ctx.quadraticCurveTo(sx + S * 0.05, oy + S * 0.6, sx + S * 0.075, oy + S * 0.64);
      ctx.bezierCurveTo(sx + S * 0.3, oy + S * 0.7, sx + S * 0.42, oy + S * 0.8, sx + S * 0.44, basY);
      ctx.closePath();
      const fond = ctx.createLinearGradient(0, oy + S * 0.6, 0, basY);
      fond.addColorStop(0, `rgba(3,8,18,${0.92 * app})`);
      fond.addColorStop(1, `rgba(3,8,18,${0.75 * app})`);
      ctx.fillStyle = fond;
      ctx.fill();
      for (let i = 0; i <= 48; i++) {
        const [x, y] = pointTete((i / 48) * Math.PI * 2, cx, cy, rx, ry);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.fillStyle = `rgba(3,8,18,${0.9 * app})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    const niveaux = petit ? 1 : 7;
    for (let i = 0; i < niveaux; i++) {
      const kb = 1 - i * 0.07;
      ctx.strokeStyle = bleu((i === 0 ? 0.95 : 0.6 - i * 0.06) * L);
      ctx.lineWidth = Math.max(1, (S / 500) * (i === 0 ? 2.4 : 1));
      if (i === 0) {
        ctx.shadowColor = bleu(0.9 * L);
        ctx.shadowBlur = S / 60;
      }
      buste(kb);
      ctx.shadowBlur = 0;
    }

    // les veines dorées du cou, qui battent avec le cœur
    if (!petit) {
      const pouls = 0.55 + 0.45 * Math.sin(this.t * 3) * 0.5 + this.voix * 0.4;
      ctx.lineWidth = Math.max(1, S / 650);
      ctx.shadowColor = melange([255, 170, 60], [200, 0, 0], ob, 0.8 * L);
      ctx.shadowBlur = S / 80;
      for (const v of this.veines) {
        ctx.strokeStyle = melange([255, 160 + 60 * a.dore, 70], [150, 0, 10], ob, 0.75 * pouls * a.coeur * app);
        ctx.beginPath();
        v.forEach(([x, y], i) => (i ? ctx.lineTo(ox + S * 0.5 + x * S, oy + y * S) : ctx.moveTo(ox + S * 0.5 + x * S, oy + y * S)));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // la petite étoile de particules sur la poitrine
      for (let i = 0; i < 26; i++) {
        const an = i * 2.4 + this.t * 0.5;
        const rr = S * 0.012 * Math.sqrt(i / 26) * 1.6;
        ctx.fillStyle = bleu((0.9 - i / 40) * L);
        ctx.beginPath();
        ctx.arc(ox + S * 0.5 + Math.cos(an) * rr, oy + S * 0.86 + Math.sin(an) * rr, S / 500, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // la tête : contour lumineux et contours emboîtés (comme une carte topographique)
    const tete = (kt: number) => {
      ctx.beginPath();
      const d = 1 - kt;
      for (let i = 0; i <= 64; i++) {
        const [x, y] = pointTete((i / 64) * Math.PI * 2, cx + tx * d * 1.6, cy + ty * d * 1.6, rx, ry, kt);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    const couches = petit ? 2 : 11;
    for (let i = 0; i < couches; i++) {
      const kt = 1 - i * 0.075;
      ctx.strokeStyle = bleu((i === 0 ? 1 : 0.6 - i * 0.03) * L);
      ctx.lineWidth = Math.max(1, (S / 500) * (i === 0 ? 2.6 : 1));
      if (i === 0) {
        ctx.shadowColor = bleu(L);
        ctx.shadowBlur = S / 45;
      }
      tete(kt);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // les lignes du visage, ondulées, coupées par le contour de la tête
    if (!petit) {
      ctx.save();
      tete(0.98);
      ctx.clip();
      ctx.lineWidth = Math.max(1, S / 900);
      for (let j = 0; j < 22; j++) {
        const y0 = cy - ry + (j / 21) * ry * 2 + ty * 0.5;
        ctx.strokeStyle = bleu(0.32 * L);
        ctx.beginPath();
        for (let x = cx - rx; x <= cx + rx; x += S / 120) {
          // les lignes se resserrent du côté où il tourne la tête
          const d = (x - cx - tx * 0.5 * (1 - ((x - cx) / rx) ** 2)) / rx;
          const y = y0 + (1 - d * d) * ry * 0.06 + Math.sin(d * 3 + this.t * 1.2 + j) * S * 0.002 * (1 + this.voix * 3);
          if (x === cx - rx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // le cœur orange au milieu du visage : il respire, et bat quand Max parle
    const eclat = a.coeur * app * (0.85 + 0.15 * Math.sin(this.t * 1.7) + this.voix * 0.6) + sal * 0.9;
    const gx = cx + tx * 0.75;
    const gy = cy + ry * 0.12 + ty * 0.6;
    const gr = rx * (1.05 + this.voix * 0.3 + sal * 0.35);
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    const vert = Math.round(150 + 60 * a.dore);
    // Max Ultime : un cœur plus sombre et plus petit, rouge sang, pour laisser voir ses yeux
    const sombre = 1 - 0.45 * ob;
    g.addColorStop(0, melange([255, Math.round(240 + 15 * a.dore), 190], [255, 110, 90], ob, Math.min(1, eclat * sombre)));
    g.addColorStop(0.3, melange([255, vert, 50], [210, 15, 15], ob, Math.min(1, eclat * 0.95 * sombre)));
    g.addColorStop(0.65, melange([255, 95, 20], [80, 0, 0], ob, Math.min(1, eclat * 0.4 * sombre)));
    g.addColorStop(1, melange([255, 90, 20], [40, 0, 0], ob, 0));
    ctx.fillStyle = g;
    // deux passes : le cœur, et son halo qui « brûle » les lignes du visage
    for (let passe = 0; passe < 2; passe++) {
      ctx.beginPath();
      ctx.ellipse(gx, gy, gr * (passe ? 1.25 : 1), gr * (passe ? 1 : 0.8), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Max Ultime : deux yeux en fente, inclinés, et un rictus en coin
    if (ob > 0.03 && !petit) this.yeux(cx + tx * 0.75, cy + ty * 0.6, rx, ry, S, ob);

    // les particules qui s'envolent du crâne
    if (!petit) {
      for (const p of this.particules) {
        p.age += dt * (0.4 + a.vitesse + sal * 3) * 0.5;
        if (p.age > p.vie) Object.assign(p, this.nouvelleParticule());
        const [bx, by] = pointTete(p.t, cx, cy, rx, ry);
        const x = bx + p.dx * p.age * S * 0.04;
        const y = by + p.dy * p.age * S * 0.05;
        ctx.fillStyle = bleu((1 - p.age / p.vie) * L);
        ctx.beginPath();
        ctx.arc(x, y, p.taille * (S / 650), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
    if (!petit) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      const fondu = ctx.createLinearGradient(0, h * 0.8, 0, h);
      fondu.addColorStop(0, "rgba(0,0,0,0)");
      fondu.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = fondu;
      ctx.fillRect(0, h * 0.8, w, h * 0.2);
      ctx.restore();
    }
  }

  /** Les yeux de Max Ultime : deux fentes rouges qui brûlent, l'intérieur plus bas (un regard dur), et le rictus. */
  private yeux(cx: number, cy: number, rx: number, ry: number, S: number, ob: number): void {
    const ctx = this.ctx;
    const pouls = 0.85 + 0.15 * Math.sin(this.t * 2.3) + this.voix * 0.3;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.shadowColor = `rgba(255,30,20,${ob})`;
    ctx.shadowBlur = S / 40;
    for (const cote of [-1, 1]) {
      const ex = cx + cote * rx * 0.4;
      const ey = cy - ry * 0.06;
      const l = rx * 0.34;
      const h = ry * 0.055;
      ctx.fillStyle = `rgba(255,${Math.round(70 + 60 * pouls)},${Math.round(50 * pouls)},${ob * Math.min(1, pouls)})`;
      ctx.beginPath();
      // le coin intérieur plus bas que l'extérieur : un regard sûr de lui, un peu méprisant
      ctx.moveTo(ex - cote * l * 0.55, ey + h * 1.4);
      ctx.quadraticCurveTo(ex, ey - h * 1.6, ex + cote * l * 0.6, ey - h * 1.1);
      ctx.quadraticCurveTo(ex + cote * l * 0.1, ey + h * 0.9, ex - cote * l * 0.55, ey + h * 1.4);
      ctx.fill();
    }
    // le rictus : un seul coin de la bouche remonte
    ctx.shadowBlur = S / 90;
    ctx.strokeStyle = `rgba(255,70,60,${0.75 * ob})`;
    ctx.lineWidth = Math.max(1, S / 420);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.28, cy + ry * 0.47);
    ctx.quadraticCurveTo(cx + rx * 0.02, cy + ry * 0.55 + this.voix * ry * 0.06, cx + rx * 0.32, cy + ry * 0.36);
    ctx.stroke();
    ctx.restore();
  }

  /** Les anneaux de données autour de la tête (style HUD) : trois arcs qui tournent à des vitesses différentes. */
  private anneaux(cx: number, cy: number, r: number, S: number, app: number, lumiere: number): void {
    const ctx = this.ctx;
    const a = (x: number) => Math.max(0, Math.min(1, x * app * (0.55 + 0.45 * lumiere)));
    ctx.save();
    ctx.lineCap = "butt";
    // l'anneau fin gradué
    const ob = this.ob;
    ctx.strokeStyle = melange(BLEU, ROUGE, ob, a(0.28));
    ctx.lineWidth = Math.max(1, S / 900);
    for (let i = 0; i < 120; i++) {
      const an = (i / 120) * Math.PI * 2 + this.t * 0.05;
      const long = i % 10 === 0 ? 0.04 : 0.018;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r * 0.92);
      ctx.lineTo(cx + Math.cos(an) * r * (1 - long), cy + Math.sin(an) * r * 0.92 * (1 - long));
      ctx.stroke();
    }
    // deux arcs épais qui tournent en sens contraires
    const arcs: [number, number, number, number][] = [
      [1.07, 0.11, 0.9, 0.5],
      [1.12, -0.07, 0.35, 0.35],
      [0.95, 0.16, 0.55, 0.22],
    ];
    for (const [k, v, long, alpha] of arcs) {
      ctx.strokeStyle = melange(BLEU, ROUGE, ob, a(alpha));
      ctx.lineWidth = Math.max(1, S / 380);
      for (let j = 0; j < 3; j++) {
        const debut = this.t * v + (j * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * k, r * k * 0.92, 0, debut, debut + long);
        ctx.stroke();
      }
    }
    // un point orange qui fait le tour
    const ap = this.t * 0.4;
    ctx.fillStyle = melange([255, 170, 70], [255, 230, 230], ob, a(0.9));
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ap) * r * 1.07, cy + Math.sin(ap) * r * 1.07 * 0.92, S / 260, 0, Math.PI * 2);
    ctx.fill();
    // les textes, posés sur l'anneau, qui défilent très lentement
    if (this.etiquettes.length) {
      ctx.font = `600 ${Math.max(9, Math.round(S / 70))}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textBaseline = "middle";
      const { width: w, height: h } = this.canvas;
      const marge = Math.max(9, Math.round(S / 70));
      this.etiquettes.forEach((txt, i) => {
        // haut gauche, haut droite, puis plus bas de chaque côté ; elles respirent un peu
        const an = [-2.45, -0.69, 2.75, 0.39][i] + Math.sin(this.t * 0.07 + i) * 0.03;
        const cote = Math.cos(an) < 0;
        const largeur = ctx.measureText(txt.toUpperCase()).width;
        const x = cote ? Math.max(largeur + marge, cx + Math.cos(an) * r * 1.2) : Math.min(w - largeur - marge, cx + Math.cos(an) * r * 1.2);
        const y = Math.max(marge, Math.min(h - marge, cy + Math.sin(an) * r * 1.1));
        ctx.textAlign = cote ? "right" : "left";
        ctx.fillStyle = melange([150, 225, 255], [255, 140, 130], ob, a(0.85));
        ctx.fillText(txt.toUpperCase(), x, y);
        // le petit trait qui relie le texte à l'anneau
        ctx.strokeStyle = melange(BLEU, ROUGE, ob, a(0.4));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(an) * r * 1.12, cy + Math.sin(an) * r * 1.03);
        ctx.lineTo(x + (cote ? 4 : -4), y);
        ctx.stroke();
      });
    }
    ctx.restore();
  }
}
