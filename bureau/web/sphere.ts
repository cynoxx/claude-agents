// La sphère de Max sur l'écran Jarvis : des anneaux et des particules lumineuses qui respirent quand il écoute,
// tournent quand il réfléchit et vibrent quand il parle. Un simple canvas 2D, sans bibliothèque.
import type { EtatMax } from "../shared/protocol.ts";

interface Reglage {
  rayon: number; // taille de base (fraction du canvas)
  vitesse: number; // rotation
  souffle: number; // amplitude de la respiration
  vibration: number; // agitation (voix)
  lumiere: number; // intensité
  teinte: [number, number, number];
}

const REGLAGES: Record<EtatMax, Reglage> = {
  veille: { rayon: 0.2, vitesse: 0.08, souffle: 0.01, vibration: 0, lumiere: 0.35, teinte: [90, 120, 170] },
  ecoute: { rayon: 0.24, vitesse: 0.25, souffle: 0.025, vibration: 0, lumiere: 0.9, teinte: [125, 249, 255] },
  reflechit: { rayon: 0.23, vitesse: 1.2, souffle: 0.015, vibration: 0.01, lumiere: 0.95, teinte: [242, 193, 78] },
  parle: { rayon: 0.25, vitesse: 0.5, souffle: 0.02, vibration: 0.06, lumiere: 1, teinte: [125, 249, 255] },
};

const PARTICULES = 140;

export class Sphere {
  private ctx: CanvasRenderingContext2D;
  private actuel: Reglage = { ...REGLAGES.veille, teinte: [...REGLAGES.veille.teinte] };
  private cible: Reglage = REGLAGES.veille;
  private t = 0;
  private dernier = 0;
  private voix = 0;
  private particules = Array.from({ length: PARTICULES }, (_, i) => ({
    angle: (i / PARTICULES) * Math.PI * 2,
    inclinaison: Math.random() * Math.PI,
    rayon: 0.9 + Math.random() * 0.5,
    vitesse: 0.3 + Math.random() * 0.7,
    taille: 0.6 + Math.random() * 1.6,
  }));
  private zoom = 1;
  private anim = 0;

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
  }

  etat(e: EtatMax): void {
    this.cible = REGLAGES[e];
  }

  /** Agrandit la sphère (transition vers le bureau) : 1 = normale. */
  agrandir(z: number): void {
    this.zoom = z;
  }

  demarrer(): void {
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

  private dessiner(dt: number): void {
    const a = this.actuel;
    const c = this.cible;
    const k = Math.min(1, dt * 3);
    for (const cle of ["rayon", "vitesse", "souffle", "vibration", "lumiere"] as const) a[cle] += (c[cle] - a[cle]) * k;
    a.teinte = a.teinte.map((v, i) => v + (c.teinte[i] - v) * k) as Reglage["teinte"];
    this.t += dt;
    // une « voix » irrégulière quand il parle (la vraie voix sort du Mac, pas de la page)
    const cibleVoix = a.vibration > 0.02 ? 0.4 + 0.6 * Math.abs(Math.sin(this.t * 9.3) * Math.sin(this.t * 3.7 + 1)) : 0;
    this.voix += (cibleVoix - this.voix) * Math.min(1, dt * 12);

    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    const cx = w / 2;
    const cy = h / 2;
    const base = Math.min(w, h) * a.rayon * this.zoom;
    const r = base * (1 + Math.sin(this.t * 1.6) * a.souffle + this.voix * a.vibration);
    const [R, G, B] = a.teinte.map(Math.round);
    const couleur = (alpha: number) => `rgba(${R},${G},${B},${Math.max(0, Math.min(1, alpha))})`;

    ctx.clearRect(0, 0, w, h);

    // halo
    // le halo s'éteint avant le bord du canvas, pour ne pas dessiner un carré
    const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, Math.min(r * 2.4, Math.min(w, h) / 2));
    halo.addColorStop(0, couleur(0.35 * a.lumiere));
    halo.addColorStop(0.45, couleur(0.08 * a.lumiere));
    halo.addColorStop(1, couleur(0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    // cœur
    const coeur = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    coeur.addColorStop(0, couleur(0.55 * a.lumiere));
    coeur.addColorStop(0.7, couleur(0.12 * a.lumiere));
    coeur.addColorStop(1, couleur(0));
    ctx.fillStyle = coeur;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // anneaux qui tournent
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const ri = r * (1.15 + i * 0.18);
      const debut = this.t * a.vitesse * (i % 2 ? -1 : 1) * (1 + i * 0.3) + i;
      const longueur = Math.PI * (0.5 + 0.35 * Math.sin(this.t * 0.7 + i));
      ctx.strokeStyle = couleur((0.75 - i * 0.14) * a.lumiere);
      ctx.lineWidth = Math.max(1, (w / 500) * (2.2 - i * 0.4));
      ctx.beginPath();
      ctx.arc(cx, cy, ri, debut, debut + longueur);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, ri, debut + Math.PI, debut + Math.PI + longueur * 0.5);
      ctx.stroke();
    }

    // particules en orbite
    for (const p of this.particules) {
      p.angle += dt * p.vitesse * (0.3 + a.vitesse);
      const pr = r * p.rayon * (1 + this.voix * a.vibration * 2 * Math.sin(p.angle * 3));
      const x = cx + Math.cos(p.angle) * pr;
      const y = cy + Math.sin(p.angle) * pr * Math.cos(p.inclinaison);
      const devant = Math.sin(p.angle) * Math.sin(p.inclinaison) > 0;
      ctx.fillStyle = couleur((devant ? 0.9 : 0.35) * a.lumiere);
      ctx.beginPath();
      ctx.arc(x, y, p.taille * (w / 900), 0, Math.PI * 2);
      ctx.fill();
    }

    // l'onde de la voix
    if (this.voix > 0.02) {
      ctx.strokeStyle = couleur(0.8);
      ctx.lineWidth = Math.max(1, w / 600);
      ctx.beginPath();
      for (let x = -r; x <= r; x += 3) {
        const env = Math.cos((x / r) * (Math.PI / 2));
        const y = Math.sin(x / (r * 0.08) + this.t * 14) * env * r * 0.25 * this.voix;
        if (x === -r) ctx.moveTo(cx + x, cy + y);
        else ctx.lineTo(cx + x, cy + y);
      }
      ctx.stroke();
    }
  }
}
