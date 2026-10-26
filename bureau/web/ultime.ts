// Max Ultime : la transformation en mode obscur. L'écran glitche, un orage de nuages noirs et pourpres envahit
// tout, des éclairs rouges frappent (avec le tonnerre), « MAX ULTIME » s'écrase en lettres déchirées, puis l'orage
// se retire sur un QG passé au rouge. En sortant, une vague bleue efface le rouge. Tout est dessiné dans un canevas.
import { tonnerre } from "./sons.ts";

const ENTREE_S = 4;
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
    for (let y = 0; y < H * (0.6 + Math.random() * 0.35); y += H * 0.025) {
      x += (Math.random() - 0.5) * L * 0.04;
      tronc.push([x, y]);
    }
    const branches = [tronc];
    for (let b = 0; b < 4; b++) {
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
    this.nuages = Array.from({ length: 46 }, (_, i) => ({
      x: Math.random() * L,
      y: Math.random() * H,
      r: (0.12 + Math.random() * 0.22) * Math.max(L, H),
      v: (Math.random() - 0.5) * 0.05,
      teinte: i % 3,
    }));
    // les éclairs : quand ils frappent (secondes)
    const coups = [0.55, 1.05, 1.25, 2.1, 2.9];
    this.eclairs = [];
    let applique = false;
    const joues = new Set<number>();
    document.body.classList.add("ultime-secousse");
    this.jouer(
      ENTREE_S,
      (t, l, h, dpr) => {
        for (const c of coups)
          if (t >= c && !joues.has(c)) {
            joues.add(c);
            this.eclairs.push(this.eclair(l, h, t));
            tonnerre(c === 1.05 ? 1 : 0.6);
          }
        // le QG passe au rouge derrière l'orage
        if (!applique && t > 1.6) {
          applique = true;
          this.appliquer(true);
        }
        if (t > 0.9) document.body.classList.remove("ultime-secousse");
        this.dessinerEntree(t, l, h, dpr);
      },
      () => {
        if (!applique) this.appliquer(true);
      },
    );
  }

  private dessinerEntree(t: number, L: number, H: number, dpr: number): void {
    const ctx = this.ctx;
    // l'orage monte puis se retire
    const couvre = Math.min(1, t / 0.7) * (t < 3.1 ? 1 : Math.max(0, 1 - (t - 3.1) / 0.9));
    // le fond qui s'assombrit
    ctx.fillStyle = `rgba(6,0,2,${0.82 * couvre})`;
    ctx.fillRect(0, 0, L, H);
    // les nuages, qui tournent lentement autour du centre
    for (const n of this.nuages) {
      n.x += n.v * L * 0.01;
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      const c = [
        [70, 6, 12],
        [40, 2, 8],
        [110, 10, 18],
      ][n.teinte];
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.55 * couvre})`);
      g.addColorStop(0.55, `rgba(${c[0] / 2},0,4,${0.35 * couvre})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }
    // les éclairs : un flash, l'arbre lumineux, et les nuages éclairés de l'intérieur
    for (const e of this.eclairs) {
      const age = t - e.t;
      if (age > 0.6) continue;
      const vif = age < 0.07 || (age > 0.14 && age < 0.22) ? 1 : Math.max(0, 0.45 - age);
      ctx.fillStyle = `rgba(255,40,30,${0.22 * vif})`;
      ctx.fillRect(0, 0, L, H);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.shadowColor = "rgba(255,20,10,1)";
      ctx.shadowBlur = 30 * dpr;
      e.branches.forEach((pts, i) => {
        ctx.strokeStyle = i === 0 ? `rgba(255,235,225,${vif})` : `rgba(255,80,60,${0.75 * vif})`;
        ctx.lineWidth = (i === 0 ? 3.2 : 1.5) * dpr;
        ctx.beginPath();
        pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      });
      ctx.restore();
    }
    // le glitch du début : des bandes décalées, rouge et cyan
    if (t < 0.9) {
      for (let i = 0; i < 9; i++) {
        const y = Math.random() * H;
        const h = (4 + Math.random() * 30) * dpr;
        ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,30,40,${0.25 * (1 - t)})` : `rgba(40,240,255,${0.18 * (1 - t)})`;
        ctx.fillRect((Math.random() - 0.5) * 60 * dpr, y, L, h);
      }
    }
    // « MAX ULTIME » qui s'écrase, en couleurs décalées, puis la phrase
    if (t > 1.15 && t < 3.6) {
      const k = Math.min(1, (t - 1.15) / 0.18);
      const a = t < 3.1 ? 1 : Math.max(0, 1 - (t - 3.1) / 0.5);
      const taille = Math.min(L / 6.5, 150 * dpr) * (1 + (1 - k) * 1.6);
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${Math.round(taille)}px "Arial Black", Impact, system-ui, sans-serif`;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${0.06 + (t - 1.15) * 0.02}em`;
      const tremble = (t < 1.6 ? 1 : 0.25) * 6 * dpr;
      const dx = (Math.random() - 0.5) * tremble;
      const dy = (Math.random() - 0.5) * tremble;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(0,220,255,${0.45 * a})`;
      ctx.fillText("MAX ULTIME", L / 2 + dx - 5 * dpr, H * 0.45 + dy);
      ctx.fillStyle = `rgba(255,0,30,${0.9 * a})`;
      ctx.fillText("MAX ULTIME", L / 2 + dx + 5 * dpr, H * 0.45 + dy);
      ctx.globalCompositeOperation = "source-over";
      ctx.shadowColor = "rgba(255,0,0,0.9)";
      ctx.shadowBlur = 40 * dpr;
      ctx.fillStyle = `rgba(255,235,235,${a})`;
      ctx.fillText("MAX ULTIME", L / 2 + dx, H * 0.45 + dy);
      // une coupure horizontale qui déchire le titre
      if (Math.random() < 0.35) {
        const y = H * 0.45 + (Math.random() - 0.5) * taille * 0.6;
        const img = ctx.getImageData(0, Math.max(0, y), L, Math.round(6 * dpr));
        ctx.putImageData(img, (Math.random() - 0.5) * 40 * dpr, Math.max(0, y));
      }
      ctx.shadowBlur = 0;
      if (t > 1.7) {
        const b = Math.min(1, (t - 1.7) / 0.4) * a;
        ctx.font = `600 ${Math.round(15 * dpr)}px ui-monospace, "SF Mono", Menlo, monospace`;
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0.45em";
        ctx.fillStyle = `rgba(255,120,110,${b})`;
        ctx.fillText("MODE OBSCUR · CONCENTRATION ABSOLUE", L / 2, H * 0.45 + taille * 0.62);
        if (t > 2.2) {
          ctx.fillStyle = `rgba(255,220,215,${Math.min(1, (t - 2.2) / 0.4) * a})`;
          ctx.fillText("LES DISTRACTIONS SONT TERMINÉES.", L / 2, H * 0.45 + taille * 0.62 + 30 * dpr);
        }
      }
      ctx.restore();
    }
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
