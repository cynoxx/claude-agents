// Max Ultime : la transformation en mode obscur. L'écran glitche, un orage de nuages noirs et pourpres envahit
// tout, des éclairs rouges frappent (avec le tonnerre), « MAX ULTIME » s'écrase en lettres déchirées, puis l'orage
// se retire sur un QG passé au rouge. En sortant, une vague bleue efface le rouge. Tout est dessiné dans un canevas.
import { tonnerre } from "./sons.ts";

const ENTREE_S = 6.8;
const SORTIE_S = 1.4;

type Eclair = { t: number; branches: [number, number][][] };

/** Faut-il jouer une transformation ? (le mode change, et pas au chargement de la page) */
export function changementObscur(avant: boolean | null, maintenant: boolean): "entree" | "sortie" | null {
  if (avant === null || avant === maintenant) return null;
  return maintenant ? "entree" : "sortie";
}

export class Ultime {
  private el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private actif: boolean | null = null;
  private anim = 0;
  private nuages: { x: number; y: number; r: number; v: number; teinte: number }[] = [];
  private eclairs: Eclair[] = [];
  private braises: { x: number; y: number; v: number; t: number }[] = [];

  constructor(private appliquer: (actif: boolean) => void) {
    this.el = document.createElement("canvas");
    this.el.className = "ultime";
    this.el.setAttribute("aria-hidden", "true");
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.ctx = this.el.getContext("2d")!;
  }

  /** L'état du serveur : joue la transformation si le mode vient de changer. */
  rendre(obscur: boolean): void {
    const c = changementObscur(this.actif, obscur);
    this.actif = obscur;
    if (!c) {
      this.appliquer(obscur);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.appliquer(obscur);
      return;
    }
    if (c === "entree") this.entree();
    else this.sortie();
  }

  private taille(): { L: number; H: number; dpr: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = Math.round(innerWidth * dpr);
    const H = Math.round(innerHeight * dpr);
    if (this.el.width !== L || this.el.height !== H) {
      this.el.width = L;
      this.el.height = H;
    }
    return { L, H, dpr };
  }

  private eclair(L: number, H: number, t: number): Eclair {
    let x = L * (0.15 + Math.random() * 0.7);
    const tronc: [number, number][] = [[x, -10]];
    for (let y = 0; y < H * (0.7 + Math.random() * 0.3); y += H * 0.022) {
      x += (Math.random() - 0.5) * L * 0.05;
      tronc.push([x, y]);
    }
    const branches = [tronc];
    for (let b = 0; b < 7; b++) {
      const d = tronc[3 + Math.floor(Math.random() * (tronc.length - 5))];
      const br: [number, number][] = [d];
      let [bx, by] = d;
      const sens = Math.random() < 0.5 ? -1 : 1;
      for (let k = 0; k < 7; k++) {
        bx += sens * Math.random() * L * 0.035;
        by += H * 0.022;
        br.push([bx, by]);
      }
      branches.push(br);
    }
    return { t, branches };
  }

  private jouer(duree: number, image: (t: number, L: number, H: number, dpr: number) => void, fin: () => void): void {
    cancelAnimationFrame(this.anim);
    this.el.hidden = false;
    const debut = performance.now();
    const boucle = () => {
      const t = (performance.now() - debut) / 1000;
      const { L, H, dpr } = this.taille();
      this.ctx.clearRect(0, 0, L, H);
      if (t >= duree) {
        this.el.hidden = true;
        document.body.classList.remove("ultime-secousse");
        fin();
        return;
      }
      image(t, L, H, dpr);
      this.anim = requestAnimationFrame(boucle);
    };
    this.anim = requestAnimationFrame(boucle);
  }

  private entree(): void {
    const { L, H } = this.taille();
    this.nuages = Array.from({ length: 90 }, (_, i) => ({
      x: Math.random() * L,
      y: Math.random() * H * 0.9,
      r: (0.14 + Math.random() * 0.3) * Math.max(L, H),
      v: (Math.random() - 0.5) * 0.06,
      teinte: i % 3,
    }));
    this.braises = Array.from({ length: 110 }, () => ({ x: Math.random() * L, y: H * (0.6 + Math.random() * 0.5), v: 0.4 + Math.random() * 1.2, t: Math.random() * 6 }));
    // quand les éclairs frappent (secondes) : un premier lointain, puis des salves de plus en plus violentes
    const coups: [number, number][] = [[0.9, 0.5], [1.7, 0.7], [1.95, 0.5], [2.9, 1], [3.15, 0.8], [3.9, 1], [4.3, 0.7], [4.55, 1]];
    this.eclairs = [];
    let applique = false;
    const joues = new Set<number>();
    let grondement = false;
    document.body.classList.add("ultime-secousse");
    this.jouer(
      ENTREE_S,
      (t, l, h, dpr) => {
        if (!grondement) {
          grondement = true;
          tonnerre(0.9, 0.3);
        }
        for (const [c, force] of coups)
          if (t >= c && !joues.has(c)) {
            joues.add(c);
            this.eclairs.push(this.eclair(l, h, t));
            tonnerre(force, 0.28);
          }
        // le QG passe au rouge derrière l'orage
        if (!applique && t > 3.4) {
          applique = true;
          this.appliquer(true);
        }
        if (t > 0.8) document.body.classList.remove("ultime-secousse");
        this.dessinerEntree(t, l, h, dpr);
      },
      () => {
        if (!applique) this.appliquer(true);
      },
    );
  }

  private dessinerEntree(t: number, L: number, H: number, dpr: number): void {
    const ctx = this.ctx;
    // l'orage monte, couvre tout (noir presque total), puis se retire à la fin
    const couvre = Math.min(1, t / 0.5) * (t < ENTREE_S - 1.2 ? 1 : Math.max(0, 1 - (t - (ENTREE_S - 1.2)) / 1.2));
    // un éclair éclaire le ciel : 0 à 1, pour que les nuages et le décor se révèlent un instant
    let flash = 0;
    for (const e of this.eclairs) {
      const age = t - e.t;
      if (age < 0 || age > 0.7) continue;
      flash = Math.max(flash, age < 0.07 || (age > 0.14 && age < 0.22) ? 1 : Math.max(0, 0.5 - age));
    }
    // le noir : presque total, qui vacille comme une lampe qui meurt au début
    const vacille = t < 0.9 ? 0.82 + 0.18 * Math.abs(Math.sin(t * 38) * Math.sin(t * 11)) : 1;
    ctx.fillStyle = `rgba(1,0,1,${0.97 * couvre * vacille * (1 - 0.12 * flash)})`;
    ctx.fillRect(0, 0, L, H);
    // les nuages : très sombres, éclairés de rouge par en dessous quand l'éclair frappe
    for (const n of this.nuages) {
      n.x += n.v * L * 0.01;
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      const c = [
        [55, 4, 10],
        [28, 1, 6],
        [90, 8, 16],
      ][n.teinte];
      const eclaire = 1 + flash * 2.4;
      g.addColorStop(0, `rgba(${Math.min(255, c[0] * eclaire)},${Math.min(255, c[1] * eclaire)},${Math.min(255, c[2] * eclaire)},${0.6 * couvre})`);
      g.addColorStop(0.55, `rgba(${c[0] / 2},0,4,${0.38 * couvre})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }
    // une brume rouge sombre qui monte du bas
    const brume = ctx.createLinearGradient(0, H * 0.55, 0, H);
    brume.addColorStop(0, "rgba(60,0,8,0)");
    brume.addColorStop(1, `rgba(90,0,12,${0.5 * couvre})`);
    ctx.fillStyle = brume;
    ctx.fillRect(0, H * 0.55, L, H * 0.45);
    // des braises qui montent dans le noir
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of this.braises) {
      b.y -= b.v * dpr * 1.6;
      b.x += Math.sin(t * 1.3 + b.t) * 0.6 * dpr;
      if (b.y < -10) b.y = H + 10;
      ctx.fillStyle = `rgba(255,${60 + 50 * Math.sin(b.t + t)},30,${0.7 * couvre})`;
      ctx.fillRect(b.x, b.y, 2 * dpr, 2 * dpr);
    }
    ctx.restore();
    // les éclairs : un flash rouge, l'arbre aveuglant, les branches, et une lueur autour
    for (const e of this.eclairs) {
      const age = t - e.t;
      if (age < 0 || age > 0.7) continue;
      const vif = age < 0.07 || (age > 0.14 && age < 0.22) ? 1 : Math.max(0, 0.5 - age);
      ctx.fillStyle = `rgba(255,25,20,${0.1 * vif})`;
      ctx.fillRect(0, 0, L, H);
      if (age < 0.05) {
        ctx.fillStyle = "rgba(255,225,220,0.07)";
        ctx.fillRect(0, 0, L, H);
      }
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "rgba(255,20,10,1)";
      ctx.shadowBlur = 42 * dpr;
      e.branches.forEach((pts, i) => {
        ctx.strokeStyle = i === 0 ? `rgba(255,240,235,${vif})` : `rgba(255,70,50,${0.8 * vif})`;
        ctx.lineWidth = (i === 0 ? 4.5 : 2) * dpr;
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      });
      ctx.restore();
    }
    // le glitch du début : des bandes décalées, rouge et cyan
    if (t < 0.9) {
      for (let i = 0; i < 12; i++) {
        const y = Math.random() * H;
        const h = (4 + Math.random() * 34) * dpr;
        ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,20,35,${0.3 * (1 - t)})` : `rgba(40,240,255,${0.16 * (1 - t)})`;
        ctx.fillRect((Math.random() - 0.5) * 80 * dpr, y, L, h);
      }
    }
    // deux yeux rouges qui s'ouvrent dans le noir, avant le titre
    if (t > 2.1 && t < 4.7) {
      const o = Math.min(1, (t - 2.1) / 0.5) * (t < 4.2 ? 1 : Math.max(0, 1 - (t - 4.2) / 0.5));
      const cligne = t > 3.0 && t < 3.12 ? 0.1 : 1;
      const w = Math.min(L * 0.1, 130 * dpr);
      const hh = w * 0.13 * cligne;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "rgba(255,0,0,1)";
      ctx.shadowBlur = 40 * dpr;
      for (const cote of [-1, 1]) {
        const ex = L / 2 + cote * w * 1.15;
        const ey = H * 0.36;
        ctx.fillStyle = `rgba(255,${40 + 40 * Math.sin(t * 4)},25,${o})`;
        ctx.beginPath();
        ctx.moveTo(ex - cote * w * 0.5, ey + hh * 1.4);
        ctx.quadraticCurveTo(ex, ey - hh * 2, ex + cote * w * 0.55, ey - hh * 1.3);
        ctx.quadraticCurveTo(ex + cote * w * 0.1, ey + hh, ex - cote * w * 0.5, ey + hh * 1.4);
        ctx.fill();
      }
      ctx.restore();
    }
    // « MAX ULTIME » qui s'écrase, en couleurs décalées, puis la phrase
    const T0 = 3.0;
    if (t > T0 && t < ENTREE_S - 0.5) {
      const k = Math.min(1, (t - T0) / 0.16);
      const a = t < ENTREE_S - 1.1 ? 1 : Math.max(0, 1 - (t - (ENTREE_S - 1.1)) / 0.6);
      const taille = Math.min(L / 9.5, 150 * dpr) * (1 + (1 - k) * 1.9);
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${Math.round(taille)}px "Arial Black", Impact, system-ui, sans-serif`;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${0.06 + (t - T0) * 0.02}em`;
      const tremble = (t < T0 + 0.5 ? 1.4 : 0.25) * 6 * dpr;
      const dx = (Math.random() - 0.5) * tremble;
      const dy = (Math.random() - 0.5) * tremble;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(0,220,255,${0.4 * a})`;
      ctx.fillText("MAX ULTIME", L / 2 + dx - 6 * dpr, H * 0.5 + dy);
      ctx.fillStyle = `rgba(255,0,25,${0.95 * a})`;
      ctx.fillText("MAX ULTIME", L / 2 + dx + 6 * dpr, H * 0.5 + dy);
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = "rgba(255,0,0,1)";
      ctx.shadowBlur = 60 * dpr;
      ctx.fillStyle = `rgba(255,225,225,${a})`;
      ctx.fillText("MAX ULTIME", L / 2 + dx, H * 0.5 + dy);
      // des coupures horizontales qui déchirent le titre
      for (let c = 0; c < 2; c++)
        if (Math.random() < 0.4) {
          const y = H * 0.5 + (Math.random() - 0.5) * taille * 0.7;
          const img = ctx.getImageData(0, Math.max(0, y), L, Math.round(7 * dpr));
          ctx.putImageData(img, (Math.random() - 0.5) * 60 * dpr, Math.max(0, y));
        }
      ctx.shadowBlur = 0;
      if (t > T0 + 0.7) {
        const b = Math.min(1, (t - T0 - 0.7) / 0.4) * a;
        ctx.font = `600 ${Math.round(15 * dpr)}px ui-monospace, "SF Mono", Menlo, monospace`;
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0.45em";
        ctx.fillStyle = `rgba(255,90,80,${b})`;
        ctx.fillText("MODE OBSCUR · TÉNÈBRES", L / 2, H * 0.5 + taille * 0.62);
        if (t > T0 + 1.3) {
          ctx.fillStyle = `rgba(255,205,200,${Math.min(1, (t - T0 - 1.3) / 0.4) * a})`;
          ctx.fillText("AUCUNE LUMIÈRE. AUCUNE DISTRACTION.", L / 2, H * 0.5 + taille * 0.62 + 30 * dpr);
        }
      }
      ctx.restore();
    }
    // les bords toujours engloutis par le noir
    const bord = ctx.createRadialGradient(L / 2, H / 2, Math.min(L, H) * 0.25, L / 2, H / 2, Math.max(L, H) * 0.7);
    bord.addColorStop(0, "rgba(0,0,0,0)");
    bord.addColorStop(1, `rgba(0,0,0,${0.85 * couvre})`);
    ctx.fillStyle = bord;
    ctx.fillRect(0, 0, L, H);
  }

  private sortie(): void {
    let applique = false;
    this.jouer(
      SORTIE_S,
      (t, L, H, dpr) => {
        const ctx = this.ctx;
        // une vague bleue qui remonte et efface le rouge
        const y = H * (1 - Math.min(1, t / (SORTIE_S * 0.75)));
        if (!applique && t > SORTIE_S * 0.4) {
          applique = true;
          this.appliquer(false);
        }
        ctx.fillStyle = `rgba(40,0,6,${0.55 * (1 - t / SORTIE_S)})`;
        ctx.fillRect(0, 0, L, y);
        const g = ctx.createLinearGradient(0, y - 60 * dpr, 0, y + 4 * dpr);
        g.addColorStop(0, "rgba(96,200,255,0)");
        g.addColorStop(1, "rgba(150,230,255,0.9)");
        ctx.fillStyle = g;
        ctx.fillRect(0, y - 60 * dpr, L, 64 * dpr);
        ctx.textAlign = "center";
        ctx.font = `600 ${Math.round(14 * dpr)}px ui-monospace, Menlo, monospace`;
        ctx.fillStyle = `rgba(200,240,255,${Math.sin((t / SORTIE_S) * Math.PI)})`;
        ctx.fillText("RETOUR AU MODE NORMAL", L / 2, H * 0.5);
      },
      () => {
        if (!applique) this.appliquer(false);
      },
    );
  }
}
