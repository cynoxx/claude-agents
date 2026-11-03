// L'entrée façon film : quand Max te reconnaît, l'écran entier devient un scanner. L'image de la caméra en fond
// (teintée, assombrie), le maillage de ton visage (68 points) qui te suit en direct, des crochets de visée qui se
// resserrent sur toi, une ligne de scan, des données qui défilent. Puis « ACCÈS AUTORISÉ » : le maillage passe en
// or et ton visage se dissout en particules qui s'envolent vers Max. Tout est dessiné dans un canevas, dans la page.
import type { Analyse } from "./camera-visage.ts";

type Etat = "repos" | "recherche" | "analyse" | "accorde" | "refuse";

/** Les traits du maillage : les contours du visage (mâchoire, sourcils, nez, yeux, lèvres) et des liens entre eux. */
export const MAILLAGE: [number, number][] = (() => {
  const l: [number, number][] = [];
  const suite = (a: number, b: number, ferme = false) => {
    for (let i = a; i < b; i++) l.push([i, i + 1]);
    if (ferme) l.push([b, a]);
  };
  suite(0, 16); // mâchoire
  suite(17, 21); // sourcil droit
  suite(22, 26); // sourcil gauche
  suite(27, 30); // arête du nez
  suite(31, 35); // base du nez
  suite(36, 41, true); // œil
  suite(42, 47, true); // œil
  suite(48, 59, true); // lèvres
  suite(60, 67, true); // bouche
  // les liens qui font un filet
  l.push(
    [0, 17], [16, 26], [17, 36], [19, 37], [21, 39], [22, 42], [24, 44], [26, 45], [21, 27], [22, 27],
    [27, 39], [27, 42], [31, 39], [35, 42], [30, 31], [30, 35], [31, 48], [33, 51], [35, 54],
    [1, 36], [1, 41], [2, 31], [3, 48], [4, 48], [5, 48], [15, 45], [15, 46], [14, 35], [13, 54], [12, 54], [11, 54],
    [6, 58], [7, 58], [8, 57], [9, 56], [10, 55], [2, 41], [14, 46], [3, 31], [13, 35], [18, 37], [25, 44],
  );
  return l;
})();

/**
 * D'un point de l'image brute (0 à 1) à l'écran : la vidéo remplit l'écran (`object-fit: cover`) et elle est
 * retournée comme un miroir.
 */
export function versEcran(px: number, py: number, vl: number, vh: number, L: number, H: number): [number, number] {
  const k = Math.max(L / vl, H / vh);
  const ox = (L - vl * k) / 2;
  const oy = (H - vh * k) / 2;
  return [L - (ox + px * vl * k), oy + py * vh * k];
}

const facile = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

export class ScanVisage {
  private ctx: CanvasRenderingContext2D;
  private etat: Etat = "repos";
  private debutEtat = 0;
  private anim = 0;
  /** Les points affichés (lissés), et la boîte, en pixels de l'écran. */
  private pts: [number, number][] = [];
  private cible: [number, number][] = [];
  private boite = { x: 0, y: 0, l: 0, h: 0 };
  private vuA = 0;
  private lacet = 0.5;
  private avance = 0;
  private etape = "";
  private prenom = "";
  private particules: { x: number; y: number; vx: number; vy: number; d: number; t: number }[] = [];
  private finAccorde?: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private video: HTMLVideoElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
  }

  private changer(e: Etat): void {
    this.etat = e;
    this.debutEtat = performance.now();
  }

  demarrer(): void {
    if (this.etat !== "repos") return;
    this.pts = [];
    this.cible = [];
    this.avance = 0;
    this.etape = "Recherche d'un visage";
    this.changer("recherche");
    cancelAnimationFrame(this.anim);
    const boucle = () => {
      this.anim = requestAnimationFrame(boucle);
      this.dessiner();
    };
    this.anim = requestAnimationFrame(boucle);
  }

  arreter(): void {
    cancelAnimationFrame(this.anim);
    this.changer("repos");
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.finAccorde?.();
    this.finAccorde = undefined;
  }

  /** Une nouvelle analyse de la caméra (ou rien : le visage est perdu). */
  voir(a: Analyse | null): void {
    if (this.etat === "accorde" || this.etat === "repos") return;
    if (!a) {
      if (performance.now() - this.vuA > 900 && this.etat === "analyse") this.changer("recherche");
      return;
    }
    const { L, H, vl, vh } = this.tailles();
    this.cible = a.points.map(([x, y]) => versEcran(x, y, vl, vh, L, H));
    const [x1, y1] = versEcran(a.boite.x + a.boite.l, a.boite.y, vl, vh, L, H);
    const [x2, y2] = versEcran(a.boite.x, a.boite.y + a.boite.h, vl, vh, L, H);
    this.boite = { x: x1, y: y1, l: x2 - x1, h: y2 - y1 };
    this.lacet = a.lacet;
    if (!this.pts.length) this.pts = this.cible.map(([x, y]) => [x, y]);
    this.vuA = performance.now();
    if (this.etat === "recherche" || this.etat === "refuse") this.changer("analyse");
  }

  /** Où en est l'identification (0 à 1), et l'étape à afficher. */
  progres(avance: number, etape: string): void {
    this.avance = Math.max(this.avance, avance);
    this.etape = etape;
  }

  /** Reconnu : le grand final. Se résout quand l'animation est finie (environ 2,6 s). */
  accorder(prenom: string): Promise<void> {
    this.prenom = prenom;
    this.avance = 1;
    this.etape = "Identité confirmée";
    this.changer("accorde");
    // ton visage en particules : les points du maillage, et d'autres semés dans la boîte du visage
    const { x, y, l, h } = this.boite;
    const sources: [number, number][] = [...this.pts];
    for (let i = 0; i < 420; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random());
      sources.push([x + l / 2 + Math.cos(a) * r * l * 0.45, y + h / 2 + Math.sin(a) * r * h * 0.55]);
    }
    this.particules = sources.map(([px, py]) => ({ x: px, y: py, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, d: Math.random() * 0.5, t: Math.random() }));
    return new Promise((r) => {
      this.finAccorde = r;
      setTimeout(() => {
        if (this.finAccorde === r) {
          this.finAccorde = undefined;
          r();
        }
      }, 2700);
    });
  }

  /** Pas reconnu : un éclair rouge, puis l'analyse reprend. */
  refuser(): void {
    if (this.etat === "accorde") return;
    this.changer("refuse");
  }

  private tailles() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const L = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (this.canvas.width !== L || this.canvas.height !== H) {
      this.canvas.width = L;
      this.canvas.height = H;
    }
    return { L, H, dpr, vl: this.video.videoWidth || 640, vh: this.video.videoHeight || 480 };
  }

  private dessiner(): void {
    const { L, H, dpr } = this.tailles();
    const ctx = this.ctx;
    const t = performance.now() / 1000;
    const dt = (performance.now() - this.debutEtat) / 1000;
    const e = this.etat;
    ctx.clearRect(0, 0, L, H);

    // le visage suit en douceur
    if (this.cible.length === this.pts.length) {
      for (let i = 0; i < this.pts.length; i++) {
        this.pts[i][0] += (this.cible[i][0] - this.pts[i][0]) * 0.35;
        this.pts[i][1] += (this.cible[i][1] - this.pts[i][1]) * 0.35;
      }
    }
    const or = e === "accorde";
    const rouge = e === "refuse" && dt < 0.9;
    const teinte = (a: number) => (or ? `rgba(255,205,110,${a})` : rouge ? `rgba(255,80,70,${a})` : `rgba(120,225,255,${a})`);
    const police = (taille: number, gras = 600) => `${gras} ${Math.round(taille * dpr)}px ui-monospace, "SF Mono", Menlo, monospace`;

    // les lignes d'un vieil écran, et le bord assombri
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let y = 0; y < H; y += 3 * dpr) ctx.fillRect(0, y, L, dpr);
    const v = ctx.createRadialGradient(L / 2, H / 2, Math.min(L, H) * 0.3, L / 2, H / 2, Math.max(L, H) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,4,10,0.85)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, L, H);

    if (e === "recherche") {
      // le réticule au centre, qui cherche
      const cx = L / 2;
      const cy = H * 0.45;
      const R = Math.min(L, H) * 0.2;
      ctx.lineWidth = 1.5 * dpr;
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = teinte(0.5 - i * 0.12);
        ctx.beginPath();
        const d = t * (i % 2 ? -0.8 : 0.6) + i;
        ctx.arc(cx, cy, R * (1 + i * 0.18), d, d + Math.PI * 1.2);
        ctx.stroke();
      }
      ctx.fillStyle = teinte(0.6 + 0.4 * Math.abs(Math.sin(t * 3)));
      ctx.font = police(14);
      ctx.textAlign = "center";
      ctx.fillText("RECHERCHE D'UN VISAGE", cx, cy + R * 1.55);
    }

    const visage = this.pts.length === 68 && e !== "recherche";
    if (visage && e !== "accorde") this.dessinerVisage(t, dt, dpr, teinte);
    if (e === "accorde") this.dessinerAccorde(dt, L, H, dpr, police);
    if (e !== "accorde") this.dessinerDonnees(t, L, H, dpr, teinte, police, rouge);
  }

  private dessinerVisage(t: number, dt: number, dpr: number, teinte: (a: number) => string): void {
    const ctx = this.ctx;
    const { x, y, l, h } = this.boite;
    const cx = x + l / 2;
    const cy = y + h / 2;
    // les crochets de visée : ils arrivent de loin et se referment sur toi
    const serre = facile(dt / 0.6);
    const m = 1.35 + (1 - serre) * 1.2;
    const bl = l * m;
    const bh = h * m * 1.15;
    const bx = cx - bl / 2;
    const by = cy - bh / 2 - h * 0.12;
    const c = Math.min(bl, bh) * 0.16;
    ctx.strokeStyle = teinte(0.9);
    ctx.lineWidth = 2.5 * dpr;
    ctx.shadowColor = teinte(0.8);
    ctx.shadowBlur = 10 * dpr;
    for (const [sx, sy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const px = bx + sx * bl;
      const py = by + sy * bh;
      ctx.beginPath();
      ctx.moveTo(px + (sx ? -c : c), py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + (sy ? -c : c));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // un cercle en pointillés qui tourne autour du visage
    ctx.save();
    ctx.setLineDash([4 * dpr, 7 * dpr]);
    ctx.lineDashOffset = -t * 30 * dpr;
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = teinte(0.45);
    ctx.beginPath();
    ctx.ellipse(cx, cy - h * 0.1, l * 0.95, h * 1.15, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // l'étiquette de la cible
    ctx.font = `600 ${Math.round(11 * dpr)}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = teinte(0.85);
    ctx.textAlign = "left";
    ctx.fillText(`CIBLE 01 · ${Math.round(cx / dpr)},${Math.round(cy / dpr)}`, bx, by - 8 * dpr);
    ctx.textAlign = "right";
    ctx.fillText(`LACET ${this.lacet >= 0.5 ? "+" : "−"}${Math.round(Math.abs(this.lacet - 0.5) * 120)}°`, bx + bl, by + bh + 16 * dpr);

    // la ligne de scan qui balaie le visage, de haut en bas
    const haut = y - h * 0.25;
    const bas = y + h * 1.05;
    const scanY = haut + ((t * 0.7) % 1) * (bas - haut);
    const g = this.ctx.createLinearGradient(0, scanY - 30 * dpr, 0, scanY + 2 * dpr);
    g.addColorStop(0, teinte(0));
    g.addColorStop(1, teinte(0.35));
    ctx.fillStyle = g;
    ctx.fillRect(cx - l * 0.75, scanY - 30 * dpr, l * 1.5, 32 * dpr);
    ctx.fillStyle = teinte(0.9);
    ctx.fillRect(cx - l * 0.75, scanY, l * 1.5, 1.5 * dpr);

    // le maillage : ses traits, puis ses points (plus vifs là où passe le scan)
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1 * dpr;
    for (const [a, b] of MAILLAGE) {
      const [x1, y1] = this.pts[a];
      const [x2, y2] = this.pts[b];
      const pres = Math.max(0, 1 - Math.abs((y1 + y2) / 2 - scanY) / (40 * dpr));
      ctx.strokeStyle = teinte(0.28 + pres * 0.6);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (const [px, py] of this.pts) {
      const pres = Math.max(0, 1 - Math.abs(py - scanY) / (30 * dpr));
      ctx.fillStyle = teinte(0.6 + pres * 0.4);
      ctx.beginPath();
      ctx.arc(px, py, (1.6 + pres * 2.2) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private dessinerDonnees(t: number, L: number, H: number, dpr: number, teinte: (a: number) => string, police: (n: number, g?: number) => string, rouge: boolean): void {
    const ctx = this.ctx;
    const m = 28 * dpr;
    ctx.textAlign = "left";
    ctx.font = police(12, 700);
    ctx.fillStyle = teinte(0.95);
    ctx.fillText("MAX // PROTOCOLE D'IDENTIFICATION", m, m + 8 * dpr);
    ctx.font = police(11);
    const vu = this.etat === "analyse" || this.etat === "refuse";
    const lignes = [
      ["CAPTEUR", "EN LIGNE"],
      ["POINTS", vu ? "68 / 68" : "— / 68"],
      ["EMPREINTE", vu ? "128 DIM" : "—"],
      ["VIVACITÉ", this.avance >= 0.8 ? "CONFIRMÉE" : vu ? "EN COURS" : "—"],
      ["CHIFFREMENT", "LOCAL · CE MAC"],
    ];
    lignes.forEach(([k, val], i) => {
      ctx.fillStyle = teinte(0.55);
      ctx.fillText(k.padEnd(13, "."), m, m + (34 + i * 18) * dpr);
      ctx.fillStyle = teinte(0.95);
      ctx.fillText(val, m + 110 * dpr, m + (34 + i * 18) * dpr);
    });
    // une colonne d'hexadécimal qui défile, à droite (pas sur un petit écran : elle toucherait les données)
    ctx.textAlign = "right";
    ctx.font = police(10);
    for (let i = 0; i < (L / dpr < 700 ? 0 : 14); i++) {
      const n = Math.floor(t * 9) + i;
      const hex = ((n * 2654435761) >>> 0).toString(16).padStart(8, "0").toUpperCase();
      ctx.fillStyle = teinte(0.12 + (i / 14) * 0.35);
      ctx.fillText(`${hex} ${((n * 40503) >>> 0) % 997}`, L - m, m + (8 + i * 14) * dpr);
    }
    // l'anneau de progression, en bas à droite
    const R = 34 * dpr;
    const ax = L - m - R;
    const ay = H - m - R - 70 * dpr;
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = teinte(0.18);
    ctx.beginPath();
    ctx.arc(ax, ay, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = teinte(0.95);
    ctx.beginPath();
    ctx.arc(ax, ay, R, -Math.PI / 2, -Math.PI / 2 + this.avance * Math.PI * 2);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.font = police(15, 700);
    ctx.fillStyle = teinte(1);
    ctx.fillText(`${Math.round(this.avance * 100)}%`, ax, ay + 5 * dpr);
    ctx.font = police(10);
    ctx.fillStyle = teinte(0.75);
    ctx.textAlign = "right";
    ctx.fillText(this.etape.toUpperCase(), ax + R, ay + R + 18 * dpr);
    if (rouge) {
      ctx.fillStyle = "rgba(255,40,40,0.12)";
      ctx.fillRect(0, 0, L, H);
      ctx.textAlign = "center";
      ctx.font = police(34, 800);
      ctx.fillStyle = "rgba(255,90,80,0.95)";
      ctx.fillText("ACCÈS REFUSÉ", L / 2, H * 0.16);
    }
  }

  private dessinerAccorde(dt: number, L: number, H: number, dpr: number, police: (n: number, g?: number) => string): void {
    const ctx = this.ctx;
    // l'éclair blanc-or du début
    if (dt < 0.35) {
      ctx.fillStyle = `rgba(255,225,160,${0.35 * (1 - dt / 0.35)})`;
      ctx.fillRect(0, 0, L, H);
    }
    // ton visage se défait en particules qui montent vers Max
    const vers = [L / 2, H * 0.33];
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particules) {
      const k = facile((dt - 0.35 - p.d) / 1.4);
      const x = p.x + (vers[0] - p.x) * k + p.vx * 40 * dpr * Math.sin(k * Math.PI);
      const y = p.y + (vers[1] - p.y) * k + p.vy * 40 * dpr * Math.sin(k * Math.PI);
      const a = dt < 2 ? 1 : Math.max(0, 1 - (dt - 2) / 0.6);
      const or = 1 - k;
      ctx.fillStyle = `rgba(${Math.round(255 * or + 120 * (1 - or))},${Math.round(205 * or + 225 * (1 - or))},${Math.round(110 * or + 255 * (1 - or))},${a * (0.6 + 0.4 * p.t)})`;
      ctx.beginPath();
      ctx.arc(x, y, (1.2 + p.t * 1.6) * dpr * (1 - k * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    // le texte : il s'écrit en s'espaçant
    const a = Math.min(1, dt / 0.25) * (dt < 2.1 ? 1 : Math.max(0, 1 - (dt - 2.1) / 0.5));
    const esp = 0.12 + facile(dt / 1.2) * 0.3;
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255,215,140,${a})`;
    ctx.shadowColor = "rgba(255,170,60,0.9)";
    ctx.shadowBlur = 24 * dpr;
    ctx.font = police(Math.min(54, L / dpr / 14), 800);
    const titre = "ACCÈS AUTORISÉ";
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${esp}em`;
    ctx.fillText(titre, L / 2, H * 0.72);
    ctx.shadowBlur = 0;
    ctx.font = police(16, 600);
    ctx.fillStyle = `rgba(200,240,255,${a})`;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0.3em";
    ctx.fillText(this.prenom ? `BIENVENUE, ${this.prenom.toUpperCase()}` : "BIENVENUE", L / 2, H * 0.72 + 38 * dpr);
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  }
}
