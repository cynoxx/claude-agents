import Phaser from "phaser";
import type { RoleId } from "../shared/protocol.ts";
import { cleRobot } from "./sprites.ts";

export const ECHELLE = 3;
const VITESSE = 170; // pixels par seconde
const LARGEUR_SCENE = 960;

export interface Point {
  x: number;
  y: number;
}

/** Un personnage du bureau : sprite, nom, bulle et icône d'état. */
export class Robot extends Phaser.GameObjects.Container {
  private sprite: Phaser.GameObjects.Image;
  private bulle: Phaser.GameObjects.Container;
  private bulleFond: Phaser.GameObjects.Graphics;
  private bulleTexte: Phaser.GameObjects.Text;
  private icone: Phaser.GameObjects.Text;
  private cible?: Point;
  private mouvement?: Phaser.Tweens.Tween;
  private marcheTimer?: Phaser.Time.TimerEvent;
  private travailTween?: Phaser.Tweens.Tween;
  private iconeTween?: Phaser.Tweens.Tween;
  private texteBulle = "";

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private role: RoleId | "max" | string,
    nom: string,
    corridorY: number,
    onClic: () => void,
  ) {
    super(scene, x, y);
    this.corridorY = corridorY;
    const ombre = scene.add.ellipse(0, -1, 34, 9, 0x000000, 0.28);
    this.sprite = scene.add.image(0, 0, cleRobot(role)).setOrigin(0.5, 1).setScale(ECHELLE);
    // une plaque de nom, façon jeu vidéo
    const etiquette = scene.add
      .text(0, 5, nom, { fontFamily: '"Pixelify Sans", sans-serif', fontSize: "13px", color: "#ffffff", backgroundColor: "#1b1b2fd9", padding: { x: 5, y: 1 } })
      .setOrigin(0.5, 0);
    this.icone = scene.add.text(20, -58, "", { fontSize: "20px" }).setOrigin(0.5, 1);

    this.bulleFond = scene.add.graphics();
    this.bulleTexte = scene.add.text(0, 0, "", {
      fontFamily: '"Pixelify Sans", sans-serif',
      fontSize: "14px",
      color: "#1b1b2f",
      wordWrap: { width: 176 },
    });
    this.bulle = scene.add.container(0, -56, [this.bulleFond, this.bulleTexte]).setVisible(false);

    this.add([ombre, this.sprite, etiquette, this.icone, this.bulle]);
    this.setSize(48, 60);
    // la zone cliquable est relative au coin haut-gauche du conteneur (48×60) : on la recale sur le sprite
    this.setInteractive(new Phaser.Geom.Rectangle(0, -24, 48, 64), Phaser.Geom.Rectangle.Contains);
    this.input!.cursor = "pointer";
    this.on("pointerdown", onClic);
    this.setDepth(y);
    scene.add.existing(this);
  }

  private corridorY: number;

  /** Marche jusqu'au point, en passant par l'allée centrale. */
  allerA(p: Point, apres?: () => void): void {
    if (this.cible && this.cible.x === p.x && this.cible.y === p.y) return;
    this.cible = p;
    this.mouvement?.stop();
    this.travailler(false);
    const etapes: Point[] = [];
    if (Math.abs(this.y - p.y) > 4 || Math.abs(this.x - p.x) > 4) {
      if (Math.abs(this.x - p.x) > 4) {
        etapes.push({ x: this.x, y: this.corridorY }, { x: p.x, y: this.corridorY });
      }
      etapes.push(p);
    }
    if (!etapes.length) return apres?.();
    this.marcher(true);
    const suivante = () => {
      const e = etapes.shift();
      if (!e) {
        this.marcher(false);
        return apres?.();
      }
      const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
      this.mouvement = this.scene.tweens.add({
        targets: this,
        x: e.x,
        y: e.y,
        duration: Math.max(1, (d / VITESSE) * 1000),
        onUpdate: () => this.miseAJourProfondeur(),
        onComplete: suivante,
      });
    };
    suivante();
  }

  private marcher(oui: boolean): void {
    this.marcheTimer?.remove();
    this.marcheTimer = undefined;
    this.sprite.setTexture(cleRobot(this.role));
    if (!oui) return;
    let pas = false;
    this.marcheTimer = this.scene.time.addEvent({
      delay: 140,
      loop: true,
      callback: () => {
        pas = !pas;
        this.sprite.setTexture(cleRobot(this.role, pas));
      },
    });
  }

  /** Petit rebond au clavier pendant le travail (ou la réflexion pour Max). */
  travailler(oui: boolean): void {
    if (oui && this.travailTween) return;
    this.travailTween?.stop();
    this.travailTween = undefined;
    this.sprite.y = 0;
    if (oui) {
      this.travailTween = this.scene.tweens.add({ targets: this.sprite, y: -3, duration: 220, yoyo: true, repeat: -1 });
    }
  }

  feter(): void {
    this.scene.tweens.add({ targets: this.sprite, y: -16, duration: 180, yoyo: true, repeat: 3, ease: "Quad.easeOut" });
  }

  setIcone(icone: string): void {
    if (this.icone.text === icone) return;
    this.icone.setText(icone);
    this.iconeTween?.stop();
    this.icone.y = -58;
    if (icone) this.iconeTween = this.scene.tweens.add({ targets: this.icone, y: -64, duration: 700, yoyo: true, repeat: -1 });
  }

  setBulle(texte: string): void {
    if (texte === this.texteBulle) return;
    this.texteBulle = texte;
    if (!texte) {
      this.bulle.setVisible(false);
      return;
    }
    const apparait = !this.bulle.visible;
    this.bulleTexte.setText(texte);
    const pad = 7;
    const l = this.bulleTexte.width + pad * 2;
    const h = this.bulleTexte.height + pad * 2;
    this.bulleTexte.setPosition(-l / 2 + pad, -h - 8 + pad);
    // une bulle de BD en pixels : coins carrés, bord épais, petite ombre
    this.bulleFond.clear();
    this.bulleFond.fillStyle(0x000000, 0.3).fillRect(-l / 2 + 3, -h - 5, l, h);
    this.bulleFond.fillStyle(0x1b1b2f, 1).fillRect(-l / 2 - 2, -h - 10, l + 4, h + 4);
    this.bulleFond.fillStyle(0xffffff, 1).fillRect(-l / 2, -h - 8, l, h);
    this.bulleFond.fillStyle(0x1b1b2f, 1).fillTriangle(-7, -7, 7, -7, 0, 1);
    this.bulleFond.fillStyle(0xffffff, 1).fillTriangle(-4, -8, 4, -8, 0, -2);
    this.bulle.setVisible(true);
    if (apparait) {
      this.bulle.setScale(0.4);
      this.scene.tweens.add({ targets: this.bulle, scale: 1, duration: 180, ease: "Back.easeOut" });
    }
    this.bulleL = l;
    this.recadrerBulle();
  }

  private bulleL = 0;

  /** Garde la bulle dans l'écran quand le robot est près d'un bord. */
  private recadrerBulle(): void {
    const demi = this.bulleL / 2;
    let dx = 0;
    if (this.x - demi < 4) dx = 4 - (this.x - demi);
    if (this.x + demi > LARGEUR_SCENE - 4) dx = LARGEUR_SCENE - 4 - (this.x + demi);
    this.bulle.x = dx;
  }

  private miseAJourProfondeur(): void {
    this.setDepth(this.y);
    if (this.bulle.visible) this.recadrerBulle();
  }

  /** Sort par la porte puis disparaît. */
  partir(porte: Point): void {
    this.setBulle("");
    this.setIcone("");
    this.allerA(porte, () => {
      this.scene.tweens.add({ targets: this, alpha: 0, duration: 300, onComplete: () => this.destroy() });
    });
  }
}
