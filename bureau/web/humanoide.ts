// Max en buste humanoïde, façon hologramme de particules : un visage fait de lignes de contour bleues, un cœur
// orange qui brille dans le visage (plus fort quand il parle), des veines dorées dans le cou, des particules qui
// s'envolent de la tête, et des ondes autour de lui quand il écoute. Sa tête suit doucement ton pointeur.
// Il apparaît en comète de particules qui vient se poser sur sa poitrine. Même interface que l'ancienne sphère.
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
const NB_PARTICULES = 420;
const APPARITION_S = 2.4;

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

    const bleu = (alpha: number) => `rgba(${BLEU[0]},${BLEU[1]},${BLEU[2]},${Math.max(0, Math.min(1, alpha))})`;
    // la tête suit le pointeur (et se balance un peu toute seule)
    const balance = Math.sin(this.t * 0.6) * 0.15;
    const cx = ox + S * 0.5 + (this.regard.x * 0.025 + balance * 0.01) * S;
    const cy = oy + S * 0.34 + this.regard.y * 0.012 * S;
    const rx = S * 0.15;
    const ry = S * 0.19;
    const L = a.lumiere * app;

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
      ctx.shadowColor = `rgba(255,170,60,${0.8 * L})`;
      ctx.shadowBlur = S / 80;
      for (const v of this.veines) {
        ctx.strokeStyle = `rgba(255,${160 + 60 * a.dore},70,${0.75 * pouls * a.coeur * app})`;
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
      for (let i = 0; i <= 64; i++) {
        const [x, y] = pointTete((i / 64) * Math.PI * 2, cx, cy, rx, ry, kt);
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
        const y0 = cy - ry + (j / 21) * ry * 2;
        ctx.strokeStyle = bleu(0.32 * L);
        ctx.beginPath();
        for (let x = cx - rx; x <= cx + rx; x += S / 120) {
          const d = (x - cx) / rx;
          const y = y0 + (1 - d * d) * ry * 0.06 + Math.sin(d * 3 + this.t * 1.2 + j) * S * 0.002 * (1 + this.voix * 3);
          if (x === cx - rx) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // le cœur orange au milieu du visage : il respire, et bat quand Max parle
    const eclat = a.coeur * app * (0.85 + 0.15 * Math.sin(this.t * 1.7) + this.voix * 0.6);
    const gx = cx;
    const gy = cy + ry * 0.12;
    const gr = rx * (1.05 + this.voix * 0.3);
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    const vert = Math.round(150 + 60 * a.dore);
    g.addColorStop(0, `rgba(255,${Math.round(240 + 15 * a.dore)},190,${Math.min(1, eclat)})`);
    g.addColorStop(0.3, `rgba(255,${vert},50,${Math.min(1, eclat * 0.95)})`);
    g.addColorStop(0.65, `rgba(255,95,20,${Math.min(1, eclat * 0.4)})`);
    g.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = g;
    // deux passes : le cœur, et son halo qui « brûle » les lignes du visage
    for (let passe = 0; passe < 2; passe++) {
      ctx.beginPath();
      ctx.ellipse(gx, gy, gr * (passe ? 1.25 : 1), gr * (passe ? 1 : 0.8), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // les particules qui s'envolent du crâne
    if (!petit) {
      for (const p of this.particules) {
        p.age += dt * (0.4 + a.vitesse) * 0.5;
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
}
