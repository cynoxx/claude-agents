// Le fond de l'écran : une nuit profonde, des étoiles, et un sol de lumière en perspective sous Max.
// Tout ce qui est fixe est dessiné une fois dans une toile cachée ; à chaque image, on ne fait que recopier,
// puis poser la lueur de Max sur le sol (elle suit sa voix) et quelques impulsions qui filent vers l'horizon.

const HORIZON = 0.74;

interface Impulsion {
  ligne: number;
  t: number;
  vitesse: number;
}

export class Sol {
  private ctx: CanvasRenderingContext2D;
  private couche = document.createElement("canvas");
  private w = 1;
  private h = 1;
  private dpr = 1;
  private anim = 0;
  private dernier = 0;
  private decalage = 0;
  private cible = 0;
  private energie = 0;
  private sombre = false;
  private impulsions: Impulsion[] = [];
  private lignes = 26;

  /** `voix` : le niveau de la voix de Max (0 à 1), lu à chaque image. */
  constructor(
    private canvas: HTMLCanvasElement,
    private voix: () => number = () => 0,
  ) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.preparer()).observe(canvas);
    window.addEventListener("pointermove", (e) => (this.cible = (e.clientX / innerWidth - 0.5) * -18));
    this.preparer();
    const boucle = (ms: number) => {
      this.anim = requestAnimationFrame(boucle);
      // 30 images par seconde suffisent pour un fond ; rien pendant l'ouverture ni quand la page est cachée
      if (document.hidden || ms - this.dernier < 33) return;
      this.dernier = ms;
      this.dessiner();
    };
    this.anim = requestAnimationFrame(boucle);
  }

  /** Mode obscur : le sol passe à la braise. */
  obscur(actif: boolean): void {
    if (actif === this.sombre) return;
    this.sombre = actif;
    this.preparer();
  }

  arreter(): void {
    cancelAnimationFrame(this.anim);
  }

  private couleur(a: number): string {
    if (this.sombre) return `rgba(255, 70, 50, ${a})`;
    if (document.body.dataset.soir === "oui") return `rgba(255, 179, 107, ${a})`;
    return `rgba(111, 224, 255, ${a})`;
  }

  private preparer(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(r.width * this.dpr));
    this.h = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    // une marge de chaque côté pour le léger mouvement avec la souris
    const marge = Math.round(30 * this.dpr);
    const c = this.couche;
    c.width = this.w + marge * 2;
    c.height = this.h;
    const g = c.getContext("2d")!;
    const W = c.width;
    const H = c.height;

    // la nuit : un bleu très sombre, plus clair derrière Max
    const ciel = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
    ciel.addColorStop(0, this.sombre ? "#1a0606" : "#0b1d2e");
    ciel.addColorStop(0.45, this.sombre ? "#0c0303" : "#06101b");
    ciel.addColorStop(1, "#020408");
    g.fillStyle = ciel;
    g.fillRect(0, 0, W, H);

    // les étoiles : fixes, de tailles et d'éclats variés (un tirage stable : la même nuit à chaque fois)
    let graine = 7;
    const hasard = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
    const n = Math.round((W * H) / (9000 * this.dpr * this.dpr));
    for (let i = 0; i < n; i++) {
      const x = hasard() * W;
      const y = hasard() * H * HORIZON;
      const t = hasard();
      g.fillStyle = t > 0.96 ? this.couleur(0.9) : `rgba(234, 246, 255, ${0.12 + t * 0.45})`;
      const s = (t > 0.97 ? 1.6 : 0.8) * this.dpr;
      g.fillRect(x, y, s, s);
    }

    // le sol : des lignes qui fuient vers le centre de l'horizon, et des lignes horizontales de plus en plus serrées
    const hy = H * HORIZON;
    const fuite = { x: W / 2, y: hy - H * 0.08 };
    g.save();
    g.beginPath();
    g.rect(0, hy, W, H - hy);
    g.clip();
    g.lineWidth = this.dpr;
    for (let i = -this.lignes; i <= this.lignes; i++) {
      const xb = W / 2 + (i / this.lignes) * W * 1.6;
      const grad = g.createLinearGradient(0, hy, 0, H);
      grad.addColorStop(0, this.couleur(0));
      grad.addColorStop(1, this.couleur(0.16));
      g.strokeStyle = grad;
      g.beginPath();
      g.moveTo(fuite.x, fuite.y);
      g.lineTo(xb, H);
      g.stroke();
    }
    for (let k = 1; k < 18; k++) {
      const p = Math.pow(k / 18, 2.2);
      const y = hy + p * (H - hy);
      g.strokeStyle = this.couleur(0.03 + p * 0.12);
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }
    g.restore();
    // la ligne d'horizon, comme une aube de lumière
    const aube = g.createLinearGradient(0, 0, W, 0);
    aube.addColorStop(0, this.couleur(0));
    aube.addColorStop(0.5, this.couleur(0.35));
    aube.addColorStop(1, this.couleur(0));
    g.fillStyle = aube;
    g.fillRect(0, hy - this.dpr, W, this.dpr * 1.5);
  }

  private dessiner(): void {
    const g = this.ctx;
    this.decalage += (this.cible - this.decalage) * 0.06;
    const marge = (this.couche.width - this.w) / 2;
    g.drawImage(this.couche, -marge + this.decalage * this.dpr, 0);

    // la lueur de Max sur le sol : elle respire, et s'élargit quand il parle
    const v = this.voix();
    this.energie += (v - this.energie) * 0.25;
    const hy = this.h * HORIZON;
    const cx = this.w / 2 + this.decalage * this.dpr * 0.5;
    const rayon = this.w * (0.16 + this.energie * 0.12);
    g.save();
    g.translate(cx, hy + this.h * 0.04);
    g.scale(1, 0.22);
    const lueur = g.createRadialGradient(0, 0, 0, 0, 0, rayon);
    lueur.addColorStop(0, this.couleur(0.22 + this.energie * 0.35));
    lueur.addColorStop(1, this.couleur(0));
    g.fillStyle = lueur;
    g.beginPath();
    g.arc(0, 0, rayon, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // des impulsions de lumière partent de Max vers le bord du sol (plus nombreuses quand il parle)
    if (Math.random() < 0.04 + this.energie * 0.3 && this.impulsions.length < 14) {
      this.impulsions.push({ ligne: Math.round((Math.random() * 2 - 1) * this.lignes * 0.6), t: 0, vitesse: 0.012 + Math.random() * 0.02 });
    }
    const fuite = { x: cx, y: hy - this.h * 0.08 };
    this.impulsions = this.impulsions.filter((p) => (p.t += p.vitesse) < 1);
    for (const p of this.impulsions) {
      const xb = this.w / 2 + (p.ligne / this.lignes) * this.w * 1.6;
      // la partie visible commence à l'horizon
      const debut = (hy - fuite.y) / (this.h - fuite.y);
      const u = debut + p.t * (1 - debut);
      const x = fuite.x + (xb - fuite.x) * u;
      const y = fuite.y + (this.h - fuite.y) * u;
      const a = Math.sin(p.t * Math.PI) * 0.8;
      g.fillStyle = this.couleur(a);
      const s = (1.5 + p.t * 2.5) * this.dpr;
      g.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }
}
