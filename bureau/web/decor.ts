// Le décor vivant du bureau : parquet, mur, fenêtres dont le ciel suit l'heure réelle (aube, jour, soir, nuit
// étoilée, nuages qui passent), horloge à l'heure, affiche, enseigne néon avec un bandeau lumineux qui annonce la
// quête, lumières, bibliothèque, serveur qui clignote, borne d'arcade, vapeur du café.
import Phaser from "phaser";
import { momentDe, type Moment } from "./decor-pur.ts";

export { momentDe, texteBandeau, type Moment } from "./decor-pur.ts";

interface Ciel {
  haut: number;
  bas: number;
  astre: { couleur: number; y: number } | null;
  etoiles: boolean;
  /** Assombrissement de la pièce (0 = plein jour). */
  ombre: number;
  /** Intensité des lampes. */
  lampes: number;
}

const CIELS: Record<Moment, Ciel> = {
  aube: { haut: 0x6f7fc9, bas: 0xffb38a, astre: { couleur: 0xffe08a, y: 62 }, etoiles: false, ombre: 0.12, lampes: 0.5 },
  jour: { haut: 0x5fb4ff, bas: 0xbfe6ff, astre: { couleur: 0xfff3a0, y: 34 }, etoiles: false, ombre: 0, lampes: 0.25 },
  soir: { haut: 0x3b2f78, bas: 0xff7a59, astre: { couleur: 0xff9d4d, y: 66 }, etoiles: false, ombre: 0.18, lampes: 0.75 },
  nuit: { haut: 0x0b0f2e, bas: 0x24336b, astre: { couleur: 0xf0f0ff, y: 34 }, etoiles: true, ombre: 0.32, lampes: 1 },
};

export interface Plan {
  largeur: number;
  mur: number;
  aile: number;
  fenetres: number[];
  enseigne: { x: number; y: number; l: number; h: number };
  lumieres: { x: number; y: number }[];
  cafe: { x: number; y: number };
}

const melanger = (a: number, b: number, t: number) => {
  const c = (d: number) => Math.round(((a >> d) & 255) * (1 - t) + ((b >> d) & 255) * t);
  return (c(16) << 16) | (c(8) << 8) | c(0);
};

export class Decor {
  private ciel!: Phaser.GameObjects.Graphics;
  private nuages: Phaser.GameObjects.Graphics[] = [];
  private ombre!: Phaser.GameObjects.Rectangle;
  private lampes!: Phaser.GameObjects.Graphics;
  private horloge!: Phaser.GameObjects.Graphics;
  private bandeau!: Phaser.GameObjects.Text;
  private bandeauTexte = "";
  private bandeauX = 0;
  private enseigne!: Phaser.GameObjects.Text;
  private voyants!: Phaser.GameObjects.Graphics;
  private moment?: Moment;

  constructor(
    private scene: Phaser.Scene,
    private p: Plan,
  ) {}

  creer(): void {
    this.sol();
    this.mur();
    this.fenetres();
    this.affiche();
    this.creerHorloge();
    this.creerEnseigne();
    this.mobilier();
    this.ombre = this.scene.add.rectangle(0, 0, this.p.largeur, this.p.aile, 0x0a0a2a, 0).setOrigin(0).setDepth(-6);
    this.lampes = this.scene.add.graphics().setDepth(-5).setBlendMode(Phaser.BlendModes.ADD);
    this.majHeure(new Date());
    this.scene.time.addEvent({ delay: 20_000, loop: true, callback: () => this.majHeure(new Date()) });
    this.scene.time.addEvent({ delay: 30, loop: true, callback: () => this.defiler() });
    this.scene.time.addEvent({ delay: 500, loop: true, callback: () => this.clignoter() });
    this.scene.time.addEvent({ delay: 450, loop: true, callback: () => this.vapeur() });
    // l'enseigne néon grésille de temps en temps
    this.scene.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        if (Math.random() < 0.5) this.scene.tweens.add({ targets: this.enseigne, alpha: 0.45, duration: 60, yoyo: true, repeat: 2 });
      },
    });
  }

  /** Change le texte du bandeau lumineux (la quête en cours). */
  annoncer(texte: string): void {
    if (texte === this.bandeauTexte) return;
    this.bandeauTexte = texte;
    this.bandeau.setText(texte.repeat(3));
    this.bandeauX = 0;
  }

  /** Le ciel, la lumière et l'horloge suivent l'heure réelle. */
  majHeure(d: Date): void {
    this.dessinerHorloge(d);
    const m = momentDe(d.getHours());
    if (m === this.moment) return;
    this.moment = m;
    const c = CIELS[m];
    this.dessinerCiel(c);
    this.ombre.setFillStyle(0x0a0a2a, c.ombre);
    this.dessinerLampes(c.lampes);
  }

  // --- construction ------------------------------------------------------------------------------

  private sol(): void {
    const g = this.scene.add.graphics().setDepth(-10);
    const { largeur: L, mur, aile } = this.p;
    // parquet : des lames de longueurs décalées, avec joints et reflets
    const h = 24;
    const teintes = [0x8a5a3b, 0x7f5236, 0x86573a, 0x7a4f34];
    for (let y = mur, rang = 0; y < aile; y += h, rang++) {
      const decalage = (rang % 3) * 40;
      for (let x = -decalage, i = 0; x < L; x += 120, i++) {
        g.fillStyle(teintes[(rang + i) % teintes.length], 1).fillRect(x, y, 120, h);
        g.fillStyle(0x000000, 0.25).fillRect(x, y, 2, h);
        g.fillStyle(0xffffff, 0.06).fillRect(x + 2, y + 1, 116, 2);
        g.fillStyle(0x000000, 0.12).fillRect(x + 30 + ((rang * 7 + i * 13) % 60), y + 9, 6, 2);
      }
      g.fillStyle(0x000000, 0.3).fillRect(0, y + h - 2, L, 2);
    }
    // tapis sous le bureau de Max, à motif
    const tx = 310;
    g.fillStyle(0x7c2d3f, 1).fillRect(tx, 116, 340, 144);
    g.fillStyle(0xb5455c, 1).fillRect(tx + 6, 122, 328, 132);
    g.fillStyle(0x7c2d3f, 1).fillRect(tx + 14, 130, 312, 116);
    for (let x = tx + 22; x < tx + 318; x += 24) g.fillStyle(0xe8a33d, 1).fillRect(x, 136, 8, 8).fillRect(x + 12, 232, 8, 8);
    g.fillStyle(0xe8a33d, 1).fillRect(tx, 112, 340, 4).fillRect(tx, 260, 340, 4);
    // l'aile des conseillers : moquette bleue à rayures et bordure
    g.fillStyle(0x2f4b6e, 1).fillRect(0, aile, L, 700);
    for (let x = 0; x < L; x += 24) g.fillStyle(0x34547a, 1).fillRect(x, aile, 12, 700);
    g.fillStyle(0x1e3352, 1).fillRect(0, aile + 6, L, 4);
  }

  private mur(): void {
    const g = this.scene.add.graphics().setDepth(-10);
    const { largeur: L, mur } = this.p;
    g.fillStyle(0x3b3f63, 1).fillRect(0, 0, L, mur);
    for (let x = 0; x < L; x += 16) g.fillStyle(0x434870, 1).fillRect(x, 10, 8, mur - 18);
    g.fillStyle(0x52578a, 1).fillRect(0, 0, L, 10);
    g.fillStyle(0x2a2c45, 1).fillRect(0, 8, L, 3);
    // plinthe en bois
    g.fillStyle(0x5a3a29, 1).fillRect(0, mur - 10, L, 10);
    g.fillStyle(0x8f563b, 1).fillRect(0, mur - 10, L, 3);
    // cloison de l'aile des conseillers
    g.fillStyle(0x2a2c45, 1).fillRect(0, this.p.aile - 6, L, 10);
  }

  private fenetres(): void {
    this.ciel = this.scene.add.graphics().setDepth(-9);
    const cadres = this.scene.add.graphics().setDepth(-7);
    const forme = this.scene.make.graphics({}, false);
    for (const fx of this.p.fenetres) {
      forme.fillStyle(0xffffff).fillRect(fx, 22, 120, 54);
      cadres.fillStyle(0x1b1b2f, 1).fillRect(fx - 6, 16, 132, 6).fillRect(fx - 6, 76, 132, 6).fillRect(fx - 6, 16, 6, 66).fillRect(fx + 120, 16, 6, 66);
      cadres.fillStyle(0xd9d9e8, 1).fillRect(fx - 4, 18, 128, 2).fillRect(fx - 4, 78, 128, 3);
      cadres.fillStyle(0x1b1b2f, 1).fillRect(fx + 58, 22, 4, 54).fillRect(fx, 47, 120, 4);
      // rideaux
      cadres.fillStyle(0x9e3a52, 1).fillRect(fx - 12, 14, 10, 70).fillRect(fx + 122, 14, 10, 70);
      cadres.fillStyle(0xc4566f, 1).fillRect(fx - 10, 14, 3, 70).fillRect(fx + 124, 14, 3, 70);
      cadres.fillStyle(0x5a3a29, 1).fillRect(fx - 16, 10, 152, 5);
    }
    const masque = forme.createGeometryMask();
    this.ciel.setMask(masque);
    // des nuages qui passent lentement devant les fenêtres
    for (let i = 0; i < 4; i++) {
      const n = this.scene.add.graphics().setDepth(-8).setMask(masque);
      n.fillStyle(0xffffff, 0.85).fillRect(0, 6, 34, 8).fillRect(8, 0, 18, 8).fillRect(26, 3, 10, 8);
      n.y = 26 + (i % 2) * 18;
      n.x = Phaser.Math.Between(0, this.p.largeur);
      this.nuages.push(n);
      this.scene.tweens.add({
        targets: n,
        x: { from: -60, to: this.p.largeur + 40 },
        duration: Phaser.Math.Between(60_000, 110_000),
        delay: -Phaser.Math.Between(0, 60_000),
        repeat: -1,
      });
    }
  }

  private dessinerCiel(c: Ciel): void {
    const g = this.ciel;
    g.clear();
    for (const fx of this.p.fenetres) {
      for (let y = 22; y < 76; y += 3) g.fillStyle(melanger(c.haut, c.bas, (y - 22) / 54), 1).fillRect(fx, y, 120, 3);
      if (c.etoiles) {
        for (let i = 0; i < 14; i++) g.fillStyle(0xffffff, i % 3 ? 0.5 : 1).fillRect(fx + ((i * 37 + fx) % 116) + 2, 24 + ((i * 23) % 44), 2, 2);
      }
    }
    if (c.astre) {
      const fx = this.p.fenetres[1];
      g.fillStyle(c.astre.couleur, 0.35).fillCircle(fx + 92, c.astre.y, 13);
      g.fillStyle(c.astre.couleur, 1).fillCircle(fx + 92, c.astre.y, 8);
      if (c.etoiles) g.fillStyle(CIELS.nuit.haut, 1).fillCircle(fx + 96, c.astre.y - 3, 7);
    }
    for (const n of this.nuages) n.setAlpha(c.etoiles ? 0.25 : 1);
  }

  private dessinerLampes(intensite: number): void {
    const g = this.lampes;
    g.clear();
    for (const l of this.p.lumieres) {
      for (let r = 6; r >= 1; r--) g.fillStyle(0xffd38a, 0.025 * intensite).fillEllipse(l.x, l.y, 40 * r, 16 * r);
    }
  }

  private affiche(): void {
    const g = this.scene.add.graphics().setDepth(-7);
    const x = 322;
    const y = 26;
    g.fillStyle(0x1b1b2f, 1).fillRect(x - 3, y - 3, 38, 52);
    g.fillStyle(0x2b2d6e, 1).fillRect(x, y, 32, 46);
    g.fillStyle(0xff7a59, 1).fillCircle(x + 22, y + 13, 6);
    g.fillStyle(0x38b764, 1).fillTriangle(x, y + 38, x + 12, y + 18, x + 24, y + 38);
    g.fillStyle(0x257179, 1).fillTriangle(x + 10, y + 38, x + 24, y + 22, x + 32, y + 38);
    g.fillStyle(0xf4f4f4, 1).fillTriangle(x + 9, y + 23, x + 12, y + 18, x + 15, y + 23);
    g.fillStyle(0x1b1b2f, 1).fillRect(x, y + 38, 32, 8);
    this.scene.add.text(x + 16, y + 42, "GO !", { fontFamily: '"Press Start 2P", monospace', fontSize: "6px", color: "#ffcd3c" }).setOrigin(0.5).setDepth(-6);
  }

  private creerHorloge(): void {
    const g = this.scene.add.graphics().setDepth(-7);
    g.fillStyle(0x1b1b2f, 1).fillCircle(640, 48, 20);
    g.fillStyle(0xf4f4f4, 1).fillCircle(640, 48, 17);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle(0x1b1b2f, 1).fillRect(640 + Math.sin(a) * 13 - 1, 48 - Math.cos(a) * 13 - 1, 2, 2);
    }
    this.horloge = this.scene.add.graphics().setDepth(-6);
  }

  private dessinerHorloge(d: Date): void {
    const g = this.horloge;
    g.clear();
    const aiguille = (angle: number, longueur: number, epaisseur: number, couleur: number) => {
      g.lineStyle(epaisseur, couleur, 1).lineBetween(640, 48, 640 + Math.sin(angle) * longueur, 48 - Math.cos(angle) * longueur);
    };
    const minutes = d.getMinutes();
    aiguille((((d.getHours() % 12) + minutes / 60) / 12) * Math.PI * 2, 8, 3, 0x1b1b2f);
    aiguille((minutes / 60) * Math.PI * 2, 12, 2, 0xe43b44);
    g.fillStyle(0x1b1b2f, 1).fillCircle(640, 48, 2);
  }

  private creerEnseigne(): void {
    const e = this.p.enseigne;
    const g = this.scene.add.graphics().setDepth(-7);
    g.fillStyle(0x05040c, 1).fillRect(e.x - 4, e.y - 4, e.l + 8, e.h + 8);
    g.fillStyle(0x1b1b2f, 1).fillRect(e.x, e.y, e.l, e.h);
    g.lineStyle(2, 0xff4fa3, 0.9).strokeRect(e.x + 4, e.y + 4, e.l - 8, e.h - 8);
    // le bandeau lumineux
    g.fillStyle(0x0b0700, 1).fillRect(e.x + 10, e.y + 40, e.l - 20, 18);
    for (let x = e.x + 10; x < e.x + e.l - 10; x += 3) g.fillStyle(0x1f1500, 1).fillRect(x, e.y + 40, 1, 18);
    this.enseigne = this.scene.add
      .text(e.x + e.l / 2, e.y + 22, "LE BUREAU", { fontFamily: '"Press Start 2P", monospace', fontSize: "16px", color: "#ffcd3c" })
      .setOrigin(0.5)
      .setShadow(0, 0, "#ff9d00", 10, false, true)
      .setDepth(-6);
    const forme = this.scene.make.graphics({}, false).fillStyle(0xffffff).fillRect(e.x + 12, e.y + 40, e.l - 24, 18);
    this.bandeau = this.scene.add
      .text(e.x + 12, e.y + 45, "", { fontFamily: '"Press Start 2P", monospace', fontSize: "8px", color: "#ffb000" })
      .setShadow(0, 0, "#ff7a00", 6, false, true)
      .setDepth(-6)
      .setMask(forme.createGeometryMask());
  }

  private defiler(): void {
    if (!this.bandeau) return;
    const e = this.p.enseigne;
    const largeurTexte = this.bandeau.width / 3;
    this.bandeauX -= 1;
    if (largeurTexte && -this.bandeauX >= largeurTexte) this.bandeauX += largeurTexte;
    this.bandeau.x = e.x + 12 + this.bandeauX;
  }

  private mobilier(): void {
    const s = this.scene;
    s.add.image(150, 140, "bibliotheque").setOrigin(0.5, 1).setScale(3).setDepth(140);
    s.add.image(30, 360, "serveur").setOrigin(0.5, 1).setScale(3).setDepth(360);
    this.voyants = s.add.graphics().setDepth(361);
    s.add.image(130, 528, "arcade").setOrigin(0.5, 1).setScale(3).setDepth(528);
    // l'écran de la borne d'arcade brille
    const lueur = s.add.rectangle(130, 474, 30, 14, 0x41a6f6, 0.25).setDepth(529).setBlendMode(Phaser.BlendModes.ADD);
    s.tweens.add({ targets: lueur, alpha: 0.05, duration: 700, yoyo: true, repeat: -1, ease: "Stepped" });
  }

  private clignoter(): void {
    const g = this.voyants;
    g.clear();
    for (let rang = 0; rang < 6; rang++) {
      for (let i = 0; i < 3; i++) {
        if (Math.random() < 0.55) g.fillStyle([0x47d16c, 0x7df9ff, 0xffcd3c][(rang + i) % 3], 1).fillRect(30 - 12 + i * 5, 360 - 66 + 9 + rang * 9, 3, 3);
      }
    }
  }

  private vapeur(): void {
    const { x, y } = this.p.cafe;
    const bouffee = this.scene.add.rectangle(x - 6 + Phaser.Math.Between(-3, 3), y - 42, 4, 4, 0xffffff, 0.7).setDepth(y + 1);
    this.scene.tweens.add({
      targets: bouffee,
      y: y - 74,
      x: bouffee.x + Phaser.Math.Between(-6, 6),
      alpha: 0,
      duration: 1800,
      onComplete: () => bouffee.destroy(),
    });
  }
}
