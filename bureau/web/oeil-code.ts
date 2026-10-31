// L'ouverture « hacker » : une pluie de code bleue envahit l'écran, des lignes de terminal s'écrivent, puis un
// grand œil fait de code s'ouvre (paupières tracées en caractères, iris en anneaux de code qui tournent, pupille
// noire qui se rétracte pendant le scan), il scanne le Joueur, et se ferme d'un coup. Tout est dessiné à la volée
// (canvas), rien n'est chargé. Durée : ~3,9 s, puis la fenêtre du Système prend le relais.

const GLYPHES = "01アイウエオカキクケコサシスセソ<>/\\{}[]#$%&*+=ABCDEF0123456789ΣΔΨΩ";
const HEX = "0123456789ABCDEF";
export const DUREE_OEIL_MS = 3900;

const hasard = (n: number) => Math.floor(Math.random() * n);
const glyphe = () => GLYPHES[hasard(GLYPHES.length)];
const hex = (n: number) => Array.from({ length: n }, () => HEX[hasard(16)]).join("");
const entre = (t: number, a: number, b: number) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const doux = (x: number) => x * x * (3 - 2 * x);

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

export class OeilCode {
  private ctx: CanvasRenderingContext2D;
  private debut = 0;
  private image = 0;
  private colonnes: number[] = [];
  private pas = 16;
  private anneaux: { r: number; texte: string; sens: number; vitesse: number }[] = [];
  private lignes: string[] = [];
  private fini: (() => void) | null = null;

  constructor(
    private toile: HTMLCanvasElement,
    joueur: string,
  ) {
    this.ctx = toile.getContext("2d")!;
    this.lignes = lignesTerminal(joueur);
  }

  jouer(fin: () => void): void {
    this.fini = fin;
    this.dimensionner();
    this.debut = performance.now();
    cancelAnimationFrame(this.image);
    const boucle = (t: number) => {
      const s = (t - this.debut) / 1000;
      this.dessiner(s);
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
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.toile.width = Math.round(innerWidth * dpr);
    this.toile.height = Math.round(innerHeight * dpr);
    this.pas = Math.round(16 * dpr);
    // les colonnes partent de partout (certaines déjà en bas de l'écran) : la pluie envahit l'écran tout de suite
    const rangs = Math.ceil(this.toile.height / this.pas);
    this.colonnes = Array.from({ length: Math.ceil(this.toile.width / this.pas) }, () => hasard(rangs) - Math.floor(rangs / 3));
    const H = this.toile.height;
    const R = Math.min(this.toile.width * 0.3, H * 0.3);
    // l'iris : des anneaux de code, de la pupille vers le bord, qui tournent en sens alternés
    this.anneaux = Array.from({ length: 7 }, (_, i) => {
      const r = R * (0.36 + i * 0.1);
      const n = Math.max(12, Math.round((2 * Math.PI * r) / (this.pas * (0.55 + i * 0.04))));
      return { r, texte: Array.from({ length: n }, () => (i % 2 ? HEX[hasard(16)] : glyphe())).join(""), sens: i % 2 ? -1 : 1, vitesse: 0.25 + 0.12 * (6 - i) };
    });
    this.ctx.fillStyle = "#010309";
    this.ctx.fillRect(0, 0, this.toile.width, H);
  }

  private dessiner(s: number): void {
    const { ctx, toile } = this;
    const L = toile.width;
    const H = toile.height;
    const cx = L / 2;
    const cy = H * 0.47;
    // ouverture des paupières (0,9 → 1,9 s), fermeture d'un coup à la fin (3,55 → 3,8 s)
    const ouvert = doux(entre(s, 0.9, 1.9)) * (1 - doux(entre(s, 3.55, 3.8)));
    const scan = entre(s, 2.4, 3.4);

    // la traîne de la pluie de code
    ctx.fillStyle = `rgba(1, 3, 9, ${0.16 + 0.2 * ouvert})`;
    ctx.fillRect(0, 0, L, H);

    // 1. la pluie de code : forte au début, elle s'estompe quand l'œil s'ouvre
    const pluie = 1 - 0.7 * ouvert;
    ctx.font = `${this.pas}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let i = 0; i < this.colonnes.length; i++) {
      const y = this.colonnes[i] * this.pas;
      if (y > 0) {
        ctx.fillStyle = `rgba(200, 240, 255, ${0.9 * pluie})`;
        ctx.fillText(glyphe(), i * this.pas + this.pas / 2, y);
        ctx.fillStyle = `rgba(79, 183, 255, ${0.55 * pluie})`;
        ctx.fillText(glyphe(), i * this.pas + this.pas / 2, y - this.pas);
      }
      if (y > H && Math.random() > 0.975) this.colonnes[i] = -hasard(20);
      else this.colonnes[i] += Math.random() > 0.25 ? 1 : 0;
    }

    // 2. l'œil
    const W = Math.min(L * 0.78, H * 1.25);
    const demiH = W * 0.27 * ouvert;
    if (ouvert > 0.01) {
      const amande = () => {
        ctx.beginPath();
        ctx.moveTo(cx - W / 2, cy);
        ctx.quadraticCurveTo(cx, cy - demiH * 2, cx + W / 2, cy);
        ctx.quadraticCurveTo(cx, cy + demiH * 2, cx - W / 2, cy);
        ctx.closePath();
      };
      ctx.save();
      amande();
      ctx.fillStyle = "rgba(1, 6, 18, 0.92)";
      ctx.fill();
      ctx.clip();
      // l'iris en anneaux de code
      const pupille = this.anneaux[0].r * (0.82 - 0.3 * Math.sin(scan * Math.PI));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      this.anneaux.forEach((a, i) => {
        const taille = Math.round(this.pas * (0.7 + i * 0.05));
        ctx.font = `600 ${taille}px ui-monospace, Menlo, monospace`;
        const lum = 1 - i / 9;
        ctx.fillStyle = `rgba(${Math.round(120 + 100 * lum)}, ${Math.round(200 + 50 * lum)}, 255, ${0.35 + 0.6 * lum})`;
        ctx.shadowColor = "rgba(79, 183, 255, 0.9)";
        ctx.shadowBlur = this.pas * 0.6;
        const n = a.texte.length;
        const rot = s * a.vitesse * a.sens;
        for (let k = 0; k < n; k++) {
          const ang = (k / n) * Math.PI * 2 + rot;
          ctx.save();
          ctx.translate(cx + Math.cos(ang) * a.r, cy + Math.sin(ang) * a.r);
          ctx.rotate(ang + Math.PI / 2);
          // quelques caractères changent en permanence : le code « vit »
          ctx.fillText(Math.random() > 0.97 ? glyphe() : a.texte[k], 0, 0);
          ctx.restore();
        }
      });
      ctx.shadowBlur = 0;
      // les fibres de l'iris : des traits de lumière qui partent de la pupille
      ctx.strokeStyle = "rgba(79, 183, 255, 0.18)";
      ctx.lineWidth = Math.max(1, this.pas / 14);
      for (let k = 0; k < 64; k++) {
        const ang = (k / 64) * Math.PI * 2 + s * 0.05;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * pupille, cy + Math.sin(ang) * pupille);
        ctx.lineTo(cx + Math.cos(ang) * this.anneaux[6].r * 1.05, cy + Math.sin(ang) * this.anneaux[6].r * 1.05);
        ctx.stroke();
      }
      // la pupille : un trou noir cerclé de lumière, avec un reflet
      const g = ctx.createRadialGradient(cx, cy, pupille * 0.2, cx, cy, pupille * 1.25);
      g.addColorStop(0, "#000");
      g.addColorStop(0.78, "#000");
      g.addColorStop(0.9, "rgba(120, 210, 255, 0.95)");
      g.addColorStop(1, "rgba(79, 183, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, pupille * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(230, 248, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(cx - pupille * 0.35, cy - pupille * 0.35, pupille * 0.12, 0, Math.PI * 2);
      ctx.fill();
      // le scan : une ligne de lumière balaie l'œil
      if (scan > 0 && scan < 1) {
        const ys = cy - demiH + scan * demiH * 2;
        const gs = ctx.createLinearGradient(0, ys - this.pas * 2, 0, ys + this.pas * 2);
        gs.addColorStop(0, "rgba(79, 183, 255, 0)");
        gs.addColorStop(0.5, "rgba(200, 240, 255, 0.85)");
        gs.addColorStop(1, "rgba(79, 183, 255, 0)");
        ctx.fillStyle = gs;
        ctx.fillRect(cx - W / 2, ys - this.pas * 2, W, this.pas * 4);
      }
      ctx.restore();
      // les paupières, tracées en caractères le long de la courbe, avec un trait lumineux
      ctx.save();
      ctx.shadowColor = "rgba(79, 183, 255, 1)";
      ctx.shadowBlur = this.pas;
      ctx.strokeStyle = "rgba(160, 225, 255, 0.95)";
      ctx.lineWidth = Math.max(1.5, this.pas / 8);
      amande();
      ctx.stroke();
      ctx.font = `${Math.round(this.pas * 0.8)}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = "rgba(200, 240, 255, 0.9)";
      for (const haut of [true, false]) {
        for (let k = 0; k <= 40; k++) {
          const u = k / 40;
          const x = (1 - u) * (1 - u) * (cx - W / 2) + 2 * (1 - u) * u * cx + u * u * (cx + W / 2);
          const y = (1 - u) * (1 - u) * cy + 2 * (1 - u) * u * (cy + (haut ? -1 : 1) * demiH * 2) + u * u * cy;
          ctx.fillText(glyphe(), x, y + (haut ? -this.pas * 0.7 : this.pas * 0.7));
        }
      }
      ctx.restore();
    }

    // 3. le terminal, en haut à gauche, tapé ligne après ligne
    const tape = entre(s, 0.2, 3.0) * this.lignes.join("").length;
    ctx.font = `${Math.round(this.pas * 0.85)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let reste = tape;
    this.lignes.forEach((l, i) => {
      if (reste <= 0) return;
      const vu = l.slice(0, Math.floor(reste));
      reste -= l.length;
      const fin = i === this.lignes.length - 1;
      ctx.fillStyle = fin ? "rgba(230, 248, 255, 1)" : "rgba(120, 200, 255, 0.85)";
      ctx.shadowColor = "rgba(79, 183, 255, 0.8)";
      ctx.shadowBlur = fin ? this.pas * 0.8 : 0;
      ctx.fillText(vu + (vu.length < l.length && Math.floor(s * 6) % 2 ? "█" : ""), this.pas * 1.5, this.pas * (1.5 + i * 1.35));
    });
    ctx.shadowBlur = 0;

    // 4. sous l'œil : l'état du scan
    if (s > 1.6) {
      ctx.textAlign = "center";
      ctx.font = `700 ${Math.round(this.pas * 1.05)}px "Rajdhani", "Avenir Next", system-ui, sans-serif`;
      const reconnu = s > 3.3;
      ctx.fillStyle = reconnu ? "rgba(230, 248, 255, 1)" : `rgba(120, 200, 255, ${0.6 + 0.4 * Math.sin(s * 14)})`;
      ctx.shadowColor = "rgba(79, 183, 255, 1)";
      ctx.shadowBlur = this.pas;
      const texte = reconnu ? "J O U E U R   R E C O N N U" : s > 2.4 ? `S C A N   D E   L ' I R I S   ${Math.round(scan * 100)} %` : "I D E N T I F I C A T I O N";
      ctx.fillText(texte, cx, cy + W * 0.27 + this.pas * 2.2);
      ctx.shadowBlur = 0;
    }

    // 5. au moment où l'œil se ferme : un éclair blanc-bleu
    const eclair = entre(s, 3.6, 3.75) * (1 - entre(s, 3.75, 3.9));
    if (eclair > 0) {
      ctx.fillStyle = `rgba(190, 235, 255, ${0.55 * eclair})`;
      ctx.fillRect(0, 0, L, H);
    }
  }
}
