// L'ouverture « hacker » : une pluie de code bleue tombe, un terminal s'écrit, puis un grand œil fait de code s'ouvre
// (paupières en caractères, iris en anneaux de code qui tournent, pupille qui respire), des viseurs se verrouillent
// dessus, il scanne le Joueur… et la caméra plonge dans la pupille : la fenêtre du Système apparaît de l'autre côté.
//
// Fluidité : rien de lourd n'est dessiné à chaque image. Les anneaux de l'iris et leur halo sont préparés une fois
// dans des toiles à part (puis seulement tournés), la pluie avance au pixel près selon le temps écoulé (pas par
// cases), tous les mouvements sont adoucis, et la résolution reste raisonnable sur les écrans Retina.

const GLYPHES = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ<>/\\{}[]#$%&*+=ABCDEF0123456789ΣΔΨΩ";
const HEX = "0123456789ABCDEF";
export const DUREE_OEIL_MS = 4400;

const hasard = (n: number) => Math.floor(Math.random() * n);
const glyphe = () => GLYPHES[hasard(GLYPHES.length)];
const hex = (n: number) => Array.from({ length: n }, () => HEX[hasard(16)]).join("");
const entre = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const doux = (x: number) => x * x * (3 - 2 * x);
const sortie = (x: number) => 1 - (1 - x) ** 3;
const entree = (x: number) => x * x * x;
/** Une ouverture avec un léger rebond, comme une paupière. */
const rebond = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2);
const MONO = "ui-monospace, Menlo, monospace";

/** Les lignes du terminal, tapées pendant que l'œil s'ouvre. */
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

interface Anneau {
  r: number;
  sens: number;
  vitesse: number;
  toile: HTMLCanvasElement;
  dessiner: () => void;
}

interface Colonne {
  y: number;
  vitesse: number;
  /** La dernière case dessinée. */
  case: number;
}

export class OeilCode {
  private ctx: CanvasRenderingContext2D;
  private debut = 0;
  private avant = 0;
  private image = 0;
  private pas = 16;
  private dpr = 1;
  private colonnes: Colonne[] = [];
  /** La pluie vit dans sa propre toile (avec sa traîne), à demi-résolution : seules les têtes y sont dessinées. */
  private pluie = document.createElement("canvas");
  private pctx = this.pluie.getContext("2d")!;
  private pasPluie = 12;
  private anneaux: Anneau[] = [];
  private prochainScintillement = 0;
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
    // au-delà de 1,5, l'œil ne voit pas la différence, mais la carte graphique si
    this.dpr = Math.min(1.5, devicePixelRatio || 1);
    const L = (this.toile.width = Math.round(innerWidth * this.dpr));
    const H = (this.toile.height = Math.round(innerHeight * this.dpr));
    this.pas = Math.round(15 * this.dpr);
    // la pluie, à sa résolution (celle de l'écran, sans le Retina) : chaque colonne a sa vitesse
    this.pluie.width = innerWidth;
    this.pluie.height = innerHeight;
    this.pasPluie = 15;
    this.pctx.fillStyle = "#010309";
    this.pctx.fillRect(0, 0, innerWidth, innerHeight);
    this.colonnes = Array.from({ length: Math.ceil(innerWidth / this.pasPluie) }, () => this.nouvelleColonne(innerHeight, true));
    // l'iris : des anneaux de code, de la pupille vers le bord, en sens alternés, préparés une fois
    const R = Math.min(L * 0.26, H * 0.3);
    this.anneaux = Array.from({ length: 7 }, (_, i) => this.anneau(R * (0.34 + i * 0.105), i));
    this.ctx.fillStyle = "#010309";
    this.ctx.fillRect(0, 0, L, H);
  }

  private nouvelleColonne(H: number, partout = false): Colonne {
    const y = partout ? Math.random() * H * 1.1 - H * 0.2 : -Math.random() * H * 0.4;
    return { y, vitesse: this.pasPluie * (10 + Math.random() * 18), case: Math.floor(y / this.pasPluie) };
  }

  /** La pluie avance : on assombrit un peu (la traîne), puis chaque colonne dessine les cases qu'elle vient d'atteindre. */
  private avancerPluie(dt: number): void {
    const c = this.pctx;
    const L = this.pluie.width;
    const H = this.pluie.height;
    const p = this.pasPluie;
    // une traîne qui dure le même temps quelle que soit la cadence
    c.fillStyle = `rgba(1, 3, 9, ${1 - Math.exp(-dt * 7)})`;
    c.fillRect(0, 0, L, H);
    c.font = `${p}px ${MONO}`;
    c.textAlign = "center";
    c.textBaseline = "top";
    for (let i = 0; i < this.colonnes.length; i++) {
      const col = this.colonnes[i];
      col.y += col.vitesse * dt;
      const k = Math.floor(col.y / p);
      const x = i * p + p / 2;
      for (let n = col.case + 1; n <= k; n++) {
        // la case d'avant redevient bleue, la nouvelle tête brille
        c.fillStyle = "#010309";
        c.fillRect(x - p / 2, (n - 1) * p, p, p);
        c.fillStyle = "rgba(79, 183, 255, 0.9)";
        c.fillText(glyphe(), x, (n - 1) * p);
        c.fillStyle = "#e6f8ff";
        c.fillText(glyphe(), x, n * p);
      }
      col.case = k;
      if (col.y > H + p * 4 && Math.random() < 0.08) this.colonnes[i] = this.nouvelleColonne(H);
    }
  }

  /** Un anneau de code dessiné une fois (avec son halo) dans sa propre toile : ensuite on ne fait que le tourner. */
  private anneau(r: number, i: number): Anneau {
    const taille = Math.round(this.pas * (0.72 + i * 0.05));
    const cote = Math.ceil((r + taille * 2) * 2);
    const toile = document.createElement("canvas");
    toile.width = toile.height = cote;
    const c = toile.getContext("2d")!;
    const n = Math.max(12, Math.round((2 * Math.PI * r) / (taille * 0.78)));
    const texte = Array.from({ length: n }, () => (i % 2 ? HEX[hasard(16)] : glyphe()));
    const lum = 1 - i / 9;
    const couleur = `rgba(${Math.round(120 + 100 * lum)}, ${Math.round(200 + 50 * lum)}, 255, ${0.4 + 0.6 * lum})`;
    const net = document.createElement("canvas");
    net.width = net.height = cote;
    const cn = net.getContext("2d")!;
    const dessiner = () => {
      // quelques caractères changent : le code « vit »
      for (let k = 0; k < n; k++) if (Math.random() < 0.08) texte[k] = i % 2 ? HEX[hasard(16)] : glyphe();
      cn.setTransform(1, 0, 0, 1, 0, 0);
      cn.clearRect(0, 0, cote, cote);
      cn.font = `600 ${taille}px ${MONO}`;
      cn.textAlign = "center";
      cn.textBaseline = "middle";
      cn.fillStyle = couleur;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const a = ang + Math.PI / 2;
        cn.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cote / 2 + Math.cos(ang) * r, cote / 2 + Math.sin(ang) * r);
        cn.fillText(texte[k], 0, 0);
      }
      cn.setTransform(1, 0, 0, 1, 0, 0);
      // le halo : le même anneau flouté, dessous
      c.clearRect(0, 0, cote, cote);
      c.filter = `blur(${Math.round(taille * 0.45)}px)`;
      c.globalAlpha = 0.9;
      c.drawImage(net, 0, 0);
      c.filter = "none";
      c.globalAlpha = 1;
      c.drawImage(net, 0, 0);
    };
    dessiner();
    return { r, sens: i % 2 ? -1 : 1, vitesse: (0.22 + 0.1 * (6 - i)) * (i % 3 === 2 ? 1.6 : 1), toile, dessiner };
  }

  private dessiner(s: number, dt: number): void {
    const { ctx, toile } = this;
    const L = toile.width;
    const H = toile.height;
    const cx = L / 2;
    const cy = H * 0.46;
    // les temps forts
    const ouvert = rebond(entre(s, 0.55, 1.65)); // les paupières s'ouvrent, avec un petit rebond
    const scan = doux(entre(s, 1.9, 3.3));
    const reconnu = s > 3.25;
    const plonge = entree(entre(s, 3.45, 4.3)); // la caméra plonge dans la pupille
    const zoom = 1 + 0.06 * doux(entre(s, 0.4, 3.4)) + 14 * plonge;

    // 1. le fond : la pluie (sa propre toile, agrandie), qui s'efface quand l'œil s'ouvre puis quand on plonge
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#010309";
    ctx.fillRect(0, 0, L, H);
    const pluie = (1 - 0.7 * Math.min(1, ouvert)) * (1 - plonge);
    if (pluie > 0.01) {
      this.avancerPluie(dt);
      ctx.globalAlpha = pluie;
      ctx.drawImage(this.pluie, 0, 0, L, H);
      ctx.globalAlpha = 1;
    }

    // 2. l'œil, vu par une caméra qui avance doucement puis plonge
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
      ctx.fillStyle = "rgba(1, 6, 18, 0.94)";
      ctx.fill();
      ctx.clip();
      // les anneaux de l'iris (de simples images tournées), rafraîchis un par un de temps en temps
      if (s > this.prochainScintillement) {
        this.anneaux[hasard(this.anneaux.length)].dessiner();
        this.prochainScintillement = s + 0.14;
      }
      for (const a of this.anneaux) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s * a.vitesse * a.sens);
        ctx.drawImage(a.toile, -a.toile.width / 2, -a.toile.height / 2);
        ctx.restore();
      }
      // les fibres de l'iris
      const R0 = this.anneaux[0].r;
      const R6 = this.anneaux[6].r * 1.06;
      const pupille = R0 * (0.78 - 0.26 * Math.sin(scan * Math.PI) + 0.04 * Math.sin(s * 3.1));
      ctx.strokeStyle = "rgba(79, 183, 255, 0.16)";
      ctx.lineWidth = Math.max(1, this.pas / 14);
      ctx.beginPath();
      for (let k = 0; k < 72; k++) {
        const ang = (k / 72) * Math.PI * 2 + s * 0.06;
        ctx.moveTo(cx + Math.cos(ang) * pupille, cy + Math.sin(ang) * pupille);
        ctx.lineTo(cx + Math.cos(ang) * R6, cy + Math.sin(ang) * R6);
      }
      ctx.stroke();
      // le limbe : un cercle de lumière autour de l'iris
      ctx.strokeStyle = "rgba(120, 210, 255, 0.55)";
      ctx.lineWidth = this.pas * 0.12;
      ctx.beginPath();
      ctx.arc(cx, cy, R6 * 1.04, 0, Math.PI * 2);
      ctx.stroke();
      // la pupille : un trou noir cerclé de lumière, avec un reflet
      const g = ctx.createRadialGradient(cx, cy, pupille * 0.2, cx, cy, pupille * 1.3);
      g.addColorStop(0, "#000");
      g.addColorStop(0.76, "#000");
      g.addColorStop(0.88, "rgba(140, 220, 255, 0.95)");
      g.addColorStop(1, "rgba(79, 183, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, pupille * 1.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(230, 248, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(cx - pupille * 0.36, cy - pupille * 0.36, pupille * 0.11, 0, Math.PI * 2);
      ctx.fill();
      // le scan : une bande de lumière qui balaie l'œil de haut en bas
      if (scan > 0 && scan < 1) {
        const ys = cy - demiH * 1.05 + scan * demiH * 2.1;
        const gs = ctx.createLinearGradient(0, ys - this.pas * 3, 0, ys + this.pas * 3);
        gs.addColorStop(0, "rgba(79, 183, 255, 0)");
        gs.addColorStop(0.5, "rgba(210, 244, 255, 0.75)");
        gs.addColorStop(1, "rgba(79, 183, 255, 0)");
        ctx.fillStyle = gs;
        ctx.fillRect(cx - W / 2, ys - this.pas * 3, W, this.pas * 6);
      }
      ctx.restore();

      // les paupières : un trait lumineux (halo en deux passes, sans flou coûteux) et des cils de code
      ctx.save();
      amande();
      ctx.strokeStyle = "rgba(79, 183, 255, 0.22)";
      ctx.lineWidth = this.pas * 0.7;
      ctx.stroke();
      ctx.strokeStyle = "rgba(190, 236, 255, 0.95)";
      ctx.lineWidth = Math.max(1.5, this.pas / 7);
      ctx.stroke();
      ctx.font = `${Math.round(this.pas * 0.78)}px ${MONO}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const bez = (u: number, a: number, b: number, c: number, d: number) => (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;
      const visible = Math.min(1, ouvert * 1.5);
      for (const haut of [1, -1]) {
        for (let k = 0; k <= 46; k++) {
          const u = k / 46;
          const x = bez(u, cx - W / 2, cx - W * 0.22, cx + W * 0.22, cx + W / 2);
          const y = bez(u, cy, cy - haut * demiH * 1.38, cy - haut * demiH * 1.38, cy);
          // plusieurs rangs qui s'éloignent et s'estompent
          for (let rang = 1; rang <= 3; rang++) {
            ctx.fillStyle = `rgba(200, 240, 255, ${(0.85 / rang) * visible})`;
            const graine = (k * 7 + rang * 13 + Math.floor(s * 9)) % GLYPHES.length;
            ctx.fillText(GLYPHES[graine], x, y - haut * this.pas * (0.75 * rang) * (0.4 + 0.6 * Math.sin(Math.PI * u)));
          }
        }
      }
      ctx.restore();

      // les viseurs : quatre coins qui se referment sur l'iris pendant le scan, puis se verrouillent
      const v = sortie(entre(s, 1.7, 2.5));
      if (v > 0) {
        const ecart = R6 * (2.2 - 1.05 * v);
        const bras = this.pas * 1.6;
        ctx.strokeStyle = reconnu ? "rgba(235, 250, 255, 1)" : `rgba(120, 210, 255, ${0.5 + 0.5 * v})`;
        ctx.lineWidth = Math.max(1.5, this.pas / 7);
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
        ctx.strokeStyle = `rgba(79, 183, 255, ${0.35 * v})`;
        ctx.lineWidth = Math.max(1, this.pas / 10);
        ctx.beginPath();
        const rg = R6 * 1.22;
        for (let k = 0; k < 90; k++) {
          const ang = (k / 90) * Math.PI * 2 - s * 0.35;
          const l = k % 5 === 0 ? this.pas * 0.6 : this.pas * 0.25;
          ctx.moveTo(cx + Math.cos(ang) * rg, cy + Math.sin(ang) * rg);
          ctx.lineTo(cx + Math.cos(ang) * (rg + l), cy + Math.sin(ang) * (rg + l));
        }
        ctx.stroke();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 3. le terminal, en haut à gauche, tapé ligne après ligne
    const fondu = 1 - plonge;
    if (fondu > 0.01) {
      const tape = entre(s, 0.15, 3.0) * this.lignes.join("").length;
      ctx.font = `${Math.round(this.pas * 0.85)}px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      let reste = tape;
      ctx.globalAlpha = fondu;
      this.lignes.forEach((l, i) => {
        if (reste <= 0) return;
        const vu = l.slice(0, Math.floor(reste));
        reste -= l.length;
        ctx.fillStyle = i === this.lignes.length - 1 ? "rgba(235, 250, 255, 1)" : "rgba(120, 200, 255, 0.85)";
        ctx.fillText(vu + (vu.length < l.length && Math.floor(s * 6) % 2 ? "█" : ""), this.pas * 1.5, this.pas * (1.5 + i * 1.35));
      });
      ctx.globalAlpha = 1;

      // 4. sous l'œil : l'état du scan et sa barre
      if (s > 1.2) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `700 ${Math.round(this.pas * 1.1)}px "Rajdhani", "Avenir Next", system-ui, sans-serif`;
        const apparait = doux(entre(s, 1.2, 1.5)) * fondu;
        ctx.globalAlpha = apparait * (reconnu ? 1 : 0.75 + 0.25 * Math.sin(s * 10));
        ctx.fillStyle = reconnu ? "#ebfaff" : "#8fd3ff";
        const texte = reconnu ? "J O U E U R   R E C O N N U" : s > 1.9 ? `S C A N   D E   L ' I R I S   ${Math.round(scan * 100)} %` : "I D E N T I F I C A T I O N";
        const yTexte = cy + W * 0.27 + this.pas * 4.4;
        ctx.fillText(texte, cx, yTexte);
        ctx.globalAlpha = apparait;
        const lb = W * 0.3;
        const ep = Math.max(2, this.pas / 7);
        ctx.fillStyle = "rgba(79, 183, 255, 0.25)";
        ctx.fillRect(cx - lb / 2, yTexte + this.pas * 1.1, lb, ep);
        ctx.fillStyle = reconnu ? "#ebfaff" : "#4fb7ff";
        ctx.fillRect(cx - lb / 2, yTexte + this.pas * 1.1, lb * scan, ep);
        ctx.globalAlpha = 1;
      }
    }

    // 5. au fond de la pupille : le noir, d'où sortira la fenêtre du Système ; un éclair au moment de la reconnaissance
    if (plonge > 0) {
      ctx.fillStyle = `rgba(1, 3, 9, ${doux(entre(plonge, 0.55, 1))})`;
      ctx.fillRect(0, 0, L, H);
    }
    const eclair = entre(s, 3.25, 3.35) * (1 - entre(s, 3.35, 3.6));
    if (eclair > 0) {
      ctx.fillStyle = `rgba(190, 235, 255, ${0.35 * eclair})`;
      ctx.fillRect(0, 0, L, H);
    }
  }
}
