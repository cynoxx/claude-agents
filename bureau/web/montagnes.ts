// Le fond de l'écran de Max : une chaîne de montagnes en particules bleues, traversée de rivières dorées, qui
// scintille doucement et bouge un peu avec le pointeur. Dessinée une fois (à chaque changement de taille), puis
// seules quelques étincelles sont animées : ça ne coûte presque rien.

/** Bruit 1D lisse et reproductible (pour des crêtes qui ne changent pas d'une fois à l'autre). */
export function bruit(x: number, graine: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + graine * 101.3) * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

/** La hauteur d'une crête (0 à 1) à la position x (0 à 1). */
export function crete(x: number, graine: number): number {
  let v = 0;
  let a = 0.55;
  let fr = 3;
  for (let o = 0; o < 5; o++) {
    const n = bruit(x * fr, graine + o);
    v += a * (1 - Math.abs(n * 2 - 1)); // des crêtes pointues
    a *= 0.5;
    fr *= 2.1;
  }
  return v;
}

export class Montagnes {
  private ctx: CanvasRenderingContext2D;
  private couche = document.createElement("canvas");
  private etincelles: { x: number; y: number; phase: number }[] = [];
  private anim = 0;
  private dernier = 0;
  private decalage = 0;
  private decalageCible = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.preparer()).observe(canvas);
    window.addEventListener("pointermove", (e) => (this.decalageCible = (e.clientX / innerWidth - 0.5) * -14));
    this.preparer();
    const boucle = (ms: number) => {
      this.anim = requestAnimationFrame(boucle);
      if (document.hidden || ms - this.dernier < 33) return; // 30 images par seconde suffisent
      this.dernier = ms;
      this.dessiner(ms / 1000);
    };
    this.anim = requestAnimationFrame(boucle);
  }

  arreter(): void {
    cancelAnimationFrame(this.anim);
  }

  /** Dessine les montagnes une fois, dans un canvas caché. */
  private preparer(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    const c = this.couche;
    c.width = w + 40 * dpr;
    c.height = h;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, c.width, h);
    this.etincelles = [];
    const pas = Math.max(2, Math.round(3 * dpr));
    // trois plans : loin (pâle, haut), milieu, près (dense, bas)
    const plans = [
      { base: 0.7, haut: 0.2, alpha: 0.3, graine: 3, densite: 0.45 },
      { base: 0.8, haut: 0.22, alpha: 0.55, graine: 11, densite: 0.7 },
      { base: 0.93, haut: 0.2, alpha: 0.85, graine: 23, densite: 0.9 },
    ];
    for (const p of plans) {
      const ligne: number[] = [];
      for (let x = 0; x < c.width; x += pas) {
        const yCrete = h * (p.base + 0.0) - crete(x / c.width, p.graine) * h * p.haut;
        ligne.push(yCrete);
        // des particules sous la crête, de plus en plus rares en descendant
        for (let y = yCrete; y < h; y += pas) {
          const prof = (y - yCrete) / (h * 0.25);
          if (Math.random() > p.densite * Math.exp(-prof * 2.2) * 0.9) continue;
          const lum = Math.exp(-prof * 3);
          g.fillStyle = `rgba(${70 + 60 * lum},${150 + 80 * lum},255,${p.alpha * (0.25 + 0.75 * lum)})`;
          g.fillRect(x + (Math.random() - 0.5) * pas, y, dpr * (0.6 + lum), dpr * (0.6 + lum));
        }
        if (Math.random() < 0.06 * p.densite) this.etincelles.push({ x, y: yCrete, phase: Math.random() * 6.28 });
      }
      // la crête elle-même, fine et lumineuse
      g.strokeStyle = `rgba(150,225,255,${p.alpha * 0.55})`;
      g.lineWidth = dpr;
      g.beginPath();
      ligne.forEach((y, i) => (i ? g.lineTo(i * pas, y) : g.moveTo(0, y)));
      g.stroke();
      // les rivières dorées : des filets de lumière qui suivent les flancs, juste sous les crêtes
      if (p.densite >= 0.7) {
        for (let n = 0; n < 9; n++) {
          const debut = Math.floor(Math.random() * ligne.length);
          const longueur = Math.floor(ligne.length * (0.04 + Math.random() * 0.08));
          const enDessous = h * (0.015 + Math.random() * 0.05);
          g.strokeStyle = `rgba(255,${150 + Math.random() * 70},60,${0.7 * p.alpha})`;
          g.shadowColor = "rgba(255,160,50,0.9)";
          g.shadowBlur = 6 * dpr;
          g.lineWidth = dpr * (0.7 + Math.random() * 0.8);
          g.beginPath();
          for (let i = debut; i < Math.min(ligne.length, debut + longueur); i++) {
            const y = ligne[i] + enDessous + Math.sin(i * 0.4) * dpr * 2;
            if (i === debut) g.moveTo(i * pas, y);
            else g.lineTo(i * pas, y);
          }
          g.stroke();
          g.shadowBlur = 0;
        }
      }
    }
  }

  private dessiner(t: number): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;
    this.decalage += (this.decalageCible - this.decalage) * 0.08;
    const dx = -20 + this.decalage;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.couche, dx, 0);
    // les crêtes scintillent
    for (const e of this.etincelles) {
      const a = Math.max(0, Math.sin(t * 1.3 + e.phase));
      if (a < 0.6) continue;
      ctx.fillStyle = `rgba(200,240,255,${(a - 0.6) * 2})`;
      ctx.fillRect(e.x + dx, e.y, 2, 2);
    }
  }
}
