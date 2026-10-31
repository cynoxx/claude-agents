// L'ouverture « hacker », en noir et rouge : deux pluies de code (une lointaine, une proche) tombent, des dumps
// mémoire défilent sur les côtés, le terminal se déchiffre ligne par ligne, puis un grand œil fait de code s'ouvre :
// paupières où le code coule le long de la courbe, iris en anneaux de code qui tournent, données aspirées vers la
// pupille pendant le scan, viseurs qui se verrouillent… et la caméra plonge dans la pupille, en vitesse lumière.
//
// Fluidité : rien de lourd n'est redessiné à chaque image. Les anneaux de l'iris et leur halo sont préparés une seule
// fois (ensuite on ne fait que les tourner ; le scintillement est une poignée de caractères posés par-dessus), les
// pluies vivent dans leurs propres toiles où seules les nouvelles têtes sont dessinées, tout avance selon le temps
// écoulé (pas par images), et la résolution reste raisonnable sur les écrans Retina.

const GLYPHES = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ<>/\\{}[]#$%&*+=ABCDEF0123456789ΣΔΨΩ";
const HEX = "0123456789ABCDEF";
export const DUREE_OEIL_MS = 4400;

// la palette : noir profond, rouge sang, rouge clair, blanc chaud
const FOND = "#030000";
const ROUGE = "255, 34, 34";
const CLAIR = "255, 120, 105";
const BLANC = "255, 228, 222";

const hasard = (n: number) => Math.floor(Math.random() * n);
const glyphe = () => GLYPHES[hasard(GLYPHES.length)];
const hex = (n: number) => Array.from({ length: n }, () => HEX[hasard(16)]).join("");
const entre = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const doux = (x: number) => x * x * (3 - 2 * x);
const sortie = (x: number) => 1 - (1 - x) ** 3;
const entree = (x: number) => x * x * x;
const frac = (x: number) => x - Math.floor(x);
/** Une ouverture avec un léger rebond, comme une paupière. */
const rebond = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2);
const MONO = "ui-monospace, Menlo, monospace";

/** Les lignes du terminal, déchiffrées pendant que l'œil s'ouvre. */
export function lignesTerminal(joueur: string): string[] {
  return [
    "> system.core --boot",
    `> mem 0x${hex(8)} ............ OK`,
    "> link neural.interface ....... OK",
    "> load player.profile",
    `> player = "${joueur}"`,
    "> biometric.scan --iris",
    `> hash ${hex(16)}`,
    "> MATCH 99.97 %",
    "> ACCESS GRANTED",
  ];
}

/** Une pluie de code dans sa propre toile, avec sa traîne : seules les têtes y sont dessinées. */
class Pluie {
  toile = document.createElement("canvas");
  private c = this.toile.getContext("2d")!;
  private colonnes: { y: number; vitesse: number; case: number }[] = [];

  constructor(
    private pas: number,
    private vitesse: [number, number],
    private couleurs: { tete: string; corps: string },
    private traine: number,
  ) {}

  dimensionner(L: number, H: number): void {
    this.toile.width = L;
    this.toile.height = H;
    this.c.fillStyle = FOND;
    this.c.fillRect(0, 0, L, H);
    this.colonnes = Array.from({ length: Math.ceil(L / this.pas) }, () => this.colonne(H, true));
  }

  private colonne(H: number, partout = false) {
    const y = partout ? Math.random() * H * 1.1 - H * 0.2 : -Math.random() * H * 0.4;
    return { y, vitesse: this.pas * (this.vitesse[0] + Math.random() * (this.vitesse[1] - this.vitesse[0])), case: Math.floor(y / this.pas) };
  }

  avancer(dt: number): void {
    const { c, pas } = this;
    const L = this.toile.width;
    const H = this.toile.height;
    // une traîne qui dure le même temps quelle que soit la cadence
    c.fillStyle = `rgba(3, 0, 0, ${1 - Math.exp(-dt * this.traine)})`;
    c.fillRect(0, 0, L, H);
    c.font = `${pas}px ${MONO}`;
    c.textAlign = "center";
    c.textBaseline = "top";
    for (let i = 0; i < this.colonnes.length; i++) {
      const col = this.colonnes[i];
      col.y += col.vitesse * dt;
      const k = Math.floor(col.y / pas);
      const x = i * pas + pas / 2;
      for (let n = col.case + 1; n <= k; n++) {
        // la case d'avant redevient rouge, la nouvelle tête brille
        c.fillStyle = FOND;
        c.fillRect(x - pas / 2, (n - 1) * pas, pas, pas);
        c.fillStyle = this.couleurs.corps;
        c.fillText(glyphe(), x, (n - 1) * pas);
        c.fillStyle = this.couleurs.tete;
        c.fillText(glyphe(), x, n * pas);
      }
      // de temps en temps, un caractère de la traîne change (le code « vit »)
      if (Math.random() < 0.03 && k > 2) {
        const n = k - 1 - hasard(Math.min(k - 1, 12));
        c.fillStyle = FOND;
        c.fillRect(x - pas / 2, n * pas, pas, pas);
        c.fillStyle = this.couleurs.corps;
        c.fillText(glyphe(), x, n * pas);
      }
      col.case = k;
      if (col.y > H + pas * 4 && Math.random() < 0.08) this.colonnes[i] = this.colonne(H);
    }
  }
}

interface Anneau {
  r: number;
  n: number;
  sens: number;
  vitesse: number;
  taille: number;
  toile: HTMLCanvasElement;
}

export class OeilCode {
  private ctx: CanvasRenderingContext2D;
  private debut = 0;
  private avant = 0;
  private image = 0;
  private pas = 16;
  private anneaux: Anneau[] = [];
  private loin = new Pluie(11, [6, 11], { tete: `rgba(${CLAIR}, 0.8)`, corps: `rgba(${ROUGE}, 0.32)` }, 9);
  private pres = new Pluie(18, [14, 26], { tete: `rgb(${BLANC})`, corps: `rgba(${ROUGE}, 0.85)` }, 6);
  /** Les données aspirées vers la pupille pendant le scan. */
  private flux = Array.from({ length: 70 }, () => ({ ang: Math.random() * Math.PI * 2, phase: Math.random(), g: glyphe(), v: 0.6 + Math.random() * 0.8 }));
  /** Les dumps mémoire qui défilent sur les côtés. */
  private dumps: string[] = Array.from({ length: 64 }, () => `0x${hex(4)}  ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)}  ${hex(2)} ${hex(2)}`);
  private lignes: string[] = [];
  private fini: (() => void) | null = null;

  constructor(
    private toile: HTMLCanvasElement,
    joueur: string,
  ) {
    this.ctx = toile.getContext("2d", { alpha: false })!;
    this.lignes = lignesTerminal(joueur);
  }

  jouer(fin: () => void): void {
    this.fini = fin;
    this.dimensionner();
    this.debut = performance.now();
    this.avant = this.debut;
    cancelAnimationFrame(this.image);
    const boucle = (t: number) => {
      const s = (t - this.debut) / 1000;
      const dt = Math.max(0, Math.min(0.05, (t - this.avant) / 1000));
      this.avant = t;
      this.dessiner(s, dt);
      if (s * 1000 < DUREE_OEIL_MS) this.image = requestAnimationFrame(boucle);
      else {
        this.fini?.();
        this.fini = null;
      }
    };
    this.image = requestAnimationFrame(boucle);
  }

  arreter(): void {
    cancelAnimationFrame(this.image);
    this.fini = null;
  }

  private dimensionner(): void {
    // au-delà de 1,25, l'œil ne voit guère la différence ; la carte graphique, si
    const dpr = Math.min(1.25, devicePixelRatio || 1);
    const L = (this.toile.width = Math.round(innerWidth * dpr));
    const H = (this.toile.height = Math.round(innerHeight * dpr));
    this.pas = Math.round(15 * dpr);
    // les pluies, à la résolution de l'écran (sans le Retina) : une lointaine, fine et lente, une proche, vive
    this.loin.dimensionner(innerWidth, innerHeight);
    this.pres.dimensionner(innerWidth, innerHeight);
    // l'iris : des anneaux de code, de la pupille vers le bord, en sens alternés, préparés une fois
    const R = Math.min(L * 0.26, H * 0.3);
    this.anneaux = Array.from({ length: 7 }, (_, i) => this.anneau(R * (0.34 + i * 0.105), i));
    this.ctx.fillStyle = FOND;
    this.ctx.fillRect(0, 0, L, H);
  }

  /** Un anneau de code dessiné une fois (avec son halo) dans sa propre toile : ensuite on ne fait que le tourner. */
  private anneau(r: number, i: number): Anneau {
    const taille = Math.round(this.pas * (0.72 + i * 0.05));
    const cote = Math.ceil((r + taille * 2) * 2);
    const n = Math.max(12, Math.round((2 * Math.PI * r) / (taille * 0.78)));
    const net = document.createElement("canvas");
    net.width = net.height = cote;
    const cn = net.getContext("2d")!;
    cn.font = `600 ${taille}px ${MONO}`;
    cn.textAlign = "center";
    cn.textBaseline = "middle";
    // du centre (rouge clair, presque blanc) vers le bord (rouge sombre)
    const lum = 1 - i / 7;
    cn.fillStyle = `rgba(255, ${Math.round(40 + 150 * lum * lum)}, ${Math.round(30 + 140 * lum * lum)}, ${0.45 + 0.55 * lum})`;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      const a = ang + Math.PI / 2;
      cn.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cote / 2 + Math.cos(ang) * r, cote / 2 + Math.sin(ang) * r);
      cn.fillText(i % 2 ? HEX[hasard(16)] : glyphe(), 0, 0);
    }
    cn.setTransform(1, 0, 0, 1, 0, 0);
    // le halo : le même anneau flouté, dessous (une seule fois)
    const toile = document.createElement("canvas");
    toile.width = toile.height = cote;
    const c = toile.getContext("2d")!;
    c.filter = `blur(${Math.round(taille * 0.5)}px)`;
    c.drawImage(net, 0, 0);
    c.filter = "none";
    c.drawImage(net, 0, 0);
    return { r, n, taille, sens: i % 2 ? -1 : 1, vitesse: (0.22 + 0.1 * (6 - i)) * (i % 3 === 2 ? 1.6 : 1), toile };
  }

  private dessiner(s: number, dt: number): void {
    const { ctx, toile } = this;
    const L = toile.width;
    const H = toile.height;
    const cx = L / 2;
    const cy = H * 0.46;
    const P = this.pas;
    // les temps forts
    const ouvert = rebond(entre(s, 0.55, 1.65)); // les paupières s'ouvrent, avec un petit rebond
    const scan = doux(entre(s, 1.9, 3.3));
    const reconnu = s > 3.25;
    const plonge = entree(entre(s, 3.45, 4.3)); // la caméra plonge dans la pupille
    const zoom = 1 + 0.06 * doux(entre(s, 0.4, 3.4)) + 14 * plonge;
    const fondu = 1 - plonge;

    // 1. le fond : les deux pluies (la lointaine d'abord), qui s'effacent quand l'œil s'ouvre puis quand on plonge
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = FOND;
    ctx.fillRect(0, 0, L, H);
    const pluie = (1 - 0.65 * Math.min(1, ouvert)) * fondu;
    if (pluie > 0.01) {
      this.loin.avancer(dt);
      this.pres.avancer(dt);
      ctx.globalAlpha = pluie * 0.9;
      ctx.drawImage(this.loin.toile, 0, 0, L, H);
      ctx.globalAlpha = pluie;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(this.pres.toile, 0, 0, L, H);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    // une lueur rouge qui monte du centre
    const lueur = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(L, H) * 0.6);
    lueur.addColorStop(0, `rgba(${ROUGE}, ${0.1 + 0.08 * ouvert})`);
    lueur.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = lueur;
    ctx.fillRect(0, 0, L, H);

    // 2. les dumps mémoire, qui défilent en continu sur les bords
    if (fondu > 0.01) {
      ctx.font = `${Math.round(P * 0.62)}px ${MONO}`;
      ctx.textBaseline = "top";
      const h = P * 0.95;
      for (const [cote, sens] of [
        [0, 1],
        [1, -1],
      ] as const) {
        ctx.textAlign = cote ? "right" : "left";
        const x = cote ? L - P * 1.2 : P * 1.2;
        const decal = frac((s * 1.6 * sens) / 4) * this.dumps.length;
        const n = Math.ceil(H / h) + 1;
        for (let k = 0; k < n; k++) {
          const y = (k - frac(decal)) * h;
          if (!cote && y < P * 15) continue; // laisse la place au terminal
          const idx = (((Math.floor(decal) + k) % this.dumps.length) + this.dumps.length) % this.dumps.length;
          const vif = idx % 9 === 0;
          ctx.fillStyle = vif ? `rgba(${CLAIR}, ${0.55 * fondu})` : `rgba(${ROUGE}, ${0.22 * fondu})`;
          ctx.fillText(this.dumps[idx], x, y);
        }
      }
      if (Math.random() < 0.3) this.dumps[hasard(this.dumps.length)] = `0x${hex(4)}  ${hex(2)} ${hex(2)} ${hex(2)} ${hex(2)}  ${hex(2)} ${hex(2)}`;
    }

    // 3. l'œil, vu par une caméra qui avance doucement puis plonge
    const W = Math.min(L * 0.74, H * 1.2);
    const demiH = W * 0.26 * Math.max(0, ouvert);
    ctx.setTransform(zoom, 0, 0, zoom, cx * (1 - zoom), cy * (1 - zoom));
    if (ouvert > 0.005) {
      const amande = () => {
        ctx.beginPath();
        ctx.moveTo(cx - W / 2, cy);
        ctx.bezierCurveTo(cx - W * 0.22, cy - demiH * 1.38, cx + W * 0.22, cy - demiH * 1.38, cx + W / 2, cy);
        ctx.bezierCurveTo(cx + W * 0.22, cy + demiH * 1.38, cx - W * 0.22, cy + demiH * 1.38, cx - W / 2, cy);
        ctx.closePath();
      };
      ctx.save();
      amande();
      ctx.fillStyle = "rgba(6, 0, 0, 0.95)";
      ctx.fill();
      ctx.clip();
      // les anneaux de l'iris : de simples images tournées
      for (const a of this.anneaux) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s * a.vitesse * a.sens);
        ctx.drawImage(a.toile, -a.toile.width / 2, -a.toile.height / 2);
        ctx.restore();
      }
      // le scintillement : une poignée de caractères vifs, posés sur les anneaux (ils tournent avec eux)
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let k = 0; k < 18; k++) {
        const a = this.anneaux[hasard(this.anneaux.length)];
        const ang = (hasard(a.n) / a.n) * Math.PI * 2 + s * a.vitesse * a.sens;
        ctx.font = `700 ${a.taille}px ${MONO}`;
        ctx.fillStyle = `rgba(${BLANC}, ${0.5 + Math.random() * 0.5})`;
        ctx.save();
        ctx.translate(cx + Math.cos(ang) * a.r, cy + Math.sin(ang) * a.r);
        ctx.rotate(ang + Math.PI / 2);
        ctx.fillText(glyphe(), 0, 0);
        ctx.restore();
      }
      const R0 = this.anneaux[0].r;
      const R6 = this.anneaux[6].r * 1.06;
      const pupille = R0 * (0.78 - 0.26 * Math.sin(scan * Math.PI) + 0.04 * Math.sin(s * 3.1));
      // les fibres de l'iris
      ctx.strokeStyle = `rgba(${ROUGE}, 0.18)`;
      ctx.lineWidth = Math.max(1, P / 14);
      ctx.beginPath();
      for (let k = 0; k < 72; k++) {
        const ang = (k / 72) * Math.PI * 2 + s * 0.06;
        ctx.moveTo(cx + Math.cos(ang) * pupille, cy + Math.sin(ang) * pupille);
        ctx.lineTo(cx + Math.cos(ang) * R6, cy + Math.sin(ang) * R6);
      }
      ctx.stroke();
      // les données aspirées vers la pupille (pendant le scan, et un peu avant)
      const aspire = entre(s, 1.5, 2.0) * (1 - entre(s, 3.3, 3.5));
      if (aspire > 0) {
        ctx.font = `600 ${Math.round(P * 0.7)}px ${MONO}`;
        for (const f of this.flux) {
          const u = frac(f.phase + s * 0.55 * f.v);
          const r = R6 - (R6 - pupille) * (u * u);
          ctx.fillStyle = `rgba(${u > 0.75 ? BLANC : CLAIR}, ${aspire * Math.sin(Math.PI * u)})`;
          ctx.fillText(f.g, cx + Math.cos(f.ang) * r, cy + Math.sin(f.ang) * r);
          if (u > 0.97) f.g = glyphe();
        }
      }
      // le limbe : un cercle rouge autour de l'iris
      ctx.strokeStyle = `rgba(${CLAIR}, 0.6)`;
      ctx.lineWidth = P * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, R6 * 1.04, 0, Math.PI * 2);
      ctx.stroke();
      // la pupille : un trou noir cerclé de rouge, avec un reflet
      const g = ctx.createRadialGradient(cx, cy, pupille * 0.2, cx, cy, pupille * 1.3);
      g.addColorStop(0, "#000");
      g.addColorStop(0.76, "#000");
      g.addColorStop(0.88, `rgba(${CLAIR}, 0.95)`);
      g.addColorStop(1, `rgba(${ROUGE}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, pupille * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${BLANC}, 0.8)`;
      ctx.beginPath();
      ctx.arc(cx - pupille * 0.36, cy - pupille * 0.36, pupille * 0.11, 0, Math.PI * 2);
      ctx.fill();
      // le scan : une bande de lumière rouge qui balaie l'œil de haut en bas
      if (scan > 0 && scan < 1) {
        const ys = cy - demiH * 1.05 + scan * demiH * 2.1;
        const gs = ctx.createLinearGradient(0, ys - P * 3, 0, ys + P * 3);
        gs.addColorStop(0, `rgba(${ROUGE}, 0)`);
        gs.addColorStop(0.5, `rgba(${BLANC}, 0.7)`);
        gs.addColorStop(1, `rgba(${ROUGE}, 0)`);
        ctx.fillStyle = gs;
        ctx.fillRect(cx - W / 2, ys - P * 3, W, P * 6);
      }
      ctx.restore();

      // les paupières : un trait lumineux (halo en deux passes) et du code qui coule le long de la courbe
      ctx.save();
      amande();
      ctx.strokeStyle = `rgba(${ROUGE}, 0.28)`;
      ctx.lineWidth = P * 0.7;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${BLANC}, 0.95)`;
      ctx.lineWidth = Math.max(1.5, P / 7);
      ctx.stroke();
      ctx.font = `${Math.round(P * 0.78)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const bez = (u: number, a: number, b: number, c: number, d: number) => (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;
      const visible = Math.min(1, ouvert * 1.5);
      const N = 48;
      for (const haut of [1, -1]) {
        for (let rang = 1; rang <= 3; rang++) {
          // chaque rang coule dans son sens, à sa vitesse : le code glisse en continu le long de la paupière
          const glisse = s * (0.05 + 0.025 * rang) * (rang % 2 ? 1 : -1) * haut;
          for (let k = 0; k < N; k++) {
            const u = frac(k / N + glisse);
            const x = bez(u, cx - W / 2, cx - W * 0.22, cx + W * 0.22, cx + W / 2);
            const y = bez(u, cy, cy - haut * demiH * 1.38, cy - haut * demiH * 1.38, cy);
            const bord = Math.sin(Math.PI * u);
            ctx.fillStyle = `rgba(${rang === 1 ? BLANC : rang === 2 ? CLAIR : ROUGE}, ${(0.95 / rang) * visible * Math.min(1, bord * 3)})`;
            ctx.fillText(GLYPHES[(k * 7 + rang * 13) % GLYPHES.length], x, y - haut * P * 0.75 * rang * (0.4 + 0.6 * bord));
          }
        }
      }
      ctx.restore();

      // les viseurs : quatre coins qui se referment sur l'iris pendant le scan, puis se verrouillent
      const v = sortie(entre(s, 1.7, 2.5));
      if (v > 0) {
        const ecart = R6 * (2.2 - 1.05 * v);
        const bras = P * 1.6;
        ctx.strokeStyle = reconnu ? `rgb(${BLANC})` : `rgba(${CLAIR}, ${0.5 + 0.5 * v})`;
        ctx.lineWidth = Math.max(1.5, P / 7);
        ctx.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          const x = cx + sx * ecart;
          const y = cy + sy * ecart * 0.62;
          ctx.moveTo(x - sx * bras, y);
          ctx.lineTo(x, y);
          ctx.lineTo(x, y - sy * bras);
        }
        ctx.stroke();
        // un anneau de graduations qui tourne autour de l'iris
        ctx.strokeStyle = `rgba(${ROUGE}, ${0.45 * v})`;
        ctx.lineWidth = Math.max(1, P / 10);
        ctx.beginPath();
        const rg = R6 * 1.22;
        for (let k = 0; k < 90; k++) {
          const ang = (k / 90) * Math.PI * 2 - s * 0.35;
          const l = k % 5 === 0 ? P * 0.6 : P * 0.25;
          ctx.moveTo(cx + Math.cos(ang) * rg, cy + Math.sin(ang) * rg);
          ctx.lineTo(cx + Math.cos(ang) * (rg + l), cy + Math.sin(ang) * (rg + l));
        }
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 4. la plongée : des traînées de code jaillissent du centre (vitesse lumière)
    if (plonge > 0 && plonge < 1) {
      ctx.strokeStyle = `rgba(${CLAIR}, ${0.7 * (1 - plonge)})`;
      ctx.lineWidth = Math.max(1, P / 9);
      ctx.beginPath();
      for (let k = 0; k < 140; k++) {
        const ang = (k / 140) * Math.PI * 2 + (k % 7) * 0.13;
        const r0 = Math.max(L, H) * frac(k * 0.618 + plonge * 1.8) * 0.8;
        const r1 = r0 * (1 + 0.35 * plonge);
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      }
      ctx.stroke();
    }

    // 5. le terminal, en haut à gauche : chaque ligne se déchiffre (caractères au hasard qui se figent)
    if (fondu > 0.01) {
      ctx.font = `${Math.round(P * 0.85)}px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.globalAlpha = fondu;
      this.lignes.forEach((l, i) => {
        const t0 = 0.15 + i * 0.3;
        if (s < t0) return;
        const fige = Math.floor(entre(s, t0, t0 + 0.3) * l.length);
        const vu = l.slice(0, fige) + Array.from({ length: Math.min(l.length - fige, 6) }, glyphe).join("");
        const fin = i === this.lignes.length - 1;
        ctx.fillStyle = fin ? `rgb(${BLANC})` : fige < l.length ? `rgba(${CLAIR}, 0.9)` : `rgba(${ROUGE}, 0.9)`;
        ctx.fillText(vu, P * 1.5, P * (1.5 + i * 1.35));
      });
      ctx.globalAlpha = 1;

      // 6. sous l'œil : l'état du scan et sa barre ; « JOUEUR RECONNU » arrive avec un glitch
      if (s > 1.2) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${Math.round(P * 1.1)}px "Rajdhani", "Avenir Next", system-ui, sans-serif`;
        const apparait = doux(entre(s, 1.2, 1.5)) * fondu;
        const texte = reconnu ? "J O U E U R   R E C O N N U" : s > 1.9 ? `S C A N   D E   L ' I R I S   ${Math.round(scan * 100)} %` : "I D E N T I F I C A T I O N";
        const yTexte = cy + W * 0.27 + P * 4.4;
        const glitch = reconnu ? (1 - entre(s, 3.25, 3.6)) * P * 0.5 : 0;
        if (glitch > 0.5) {
          ctx.globalAlpha = apparait * 0.8;
          ctx.fillStyle = `rgb(${ROUGE})`;
          ctx.fillText(texte, cx - glitch, yTexte);
          ctx.fillStyle = "rgb(120, 220, 255)";
          ctx.fillText(texte, cx + glitch, yTexte);
        }
        ctx.globalAlpha = apparait * (reconnu ? 1 : 0.75 + 0.25 * Math.sin(s * 10));
        ctx.fillStyle = reconnu ? `rgb(${BLANC})` : `rgb(${CLAIR})`;
        ctx.fillText(texte, cx, yTexte);
        ctx.globalAlpha = apparait;
        const lb = W * 0.3;
        const ep = Math.max(2, P / 7);
        ctx.fillStyle = `rgba(${ROUGE}, 0.25)`;
        ctx.fillRect(cx - lb / 2, yTexte + P * 1.1, lb, ep);
        ctx.fillStyle = reconnu ? `rgb(${BLANC})` : `rgb(${ROUGE})`;
        ctx.fillRect(cx - lb / 2, yTexte + P * 1.1, lb * scan, ep);
        ctx.globalAlpha = 1;
      }
    }

    // 7. au fond de la pupille : le noir, d'où sortira la fenêtre du Système ; un éclair à la reconnaissance
    if (plonge > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${doux(entre(plonge, 0.55, 1))})`;
      ctx.fillRect(0, 0, L, H);
    }
    const eclair = entre(s, 3.25, 3.35) * (1 - entre(s, 3.35, 3.6));
    if (eclair > 0) {
      ctx.fillStyle = `rgba(${CLAIR}, ${0.3 * eclair})`;
      ctx.fillRect(0, 0, L, H);
    }
  }
}
