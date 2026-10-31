// Le chat du bureau : il se promène d'un coin à l'autre, s'assoit, s'endort parfois (des « z » s'envolent),
// et miaule quand on clique dessus. Juste pour le plaisir.
import Phaser from "phaser";
import type { Point } from "./robot.ts";

const ECHELLE = 2.5;
const VITESSE = 55; // pixels par seconde

export class Chat {
  private sprite: Phaser.GameObjects.Image;
  private ombre: Phaser.GameObjects.Ellipse;
  private bulle?: Phaser.GameObjects.Text;
  private dort = false;
  private zzz?: Phaser.Time.TimerEvent;

  constructor(
    private scene: Phaser.Scene,
    private coins: Point[],
  ) {
    const depart = coins[0];
    this.ombre = scene.add.ellipse(depart.x, depart.y, 26, 7, 0x000000, 0.25);
    this.sprite = scene.add.image(depart.x, depart.y, "chat").setOrigin(0.5, 1).setScale(ECHELLE).setDepth(depart.y);
    this.sprite.setInteractive({ cursor: "pointer" }).on("pointerdown", () => this.caresser());
    scene.time.delayedCall(2000, () => this.suite());
  }

  /** Choisit quoi faire ensuite : marcher (souvent), s'asseoir, ou dormir un moment. */
  private suite(): void {
    const tirage = Math.random();
    if (tirage < 0.6) this.marcher();
    else if (tirage < 0.85) this.scene.time.delayedCall(Phaser.Math.Between(3000, 7000), () => this.suite());
    else this.dormir();
  }

  private marcher(): void {
    const autres = this.coins.filter((c) => Math.hypot(c.x - this.sprite.x, c.y - this.sprite.y) > 20);
    const but = Phaser.Utils.Array.GetRandom(autres) as Point;
    const duree = (Math.hypot(but.x - this.sprite.x, but.y - this.sprite.y) / VITESSE) * 1000;
    this.sprite.setFlipX(but.x < this.sprite.x);
    // petits sauts en marchant
    const sautille = this.scene.tweens.add({ targets: this.sprite, scaleY: ECHELLE * 0.92, duration: 140, yoyo: true, repeat: -1 });
    this.scene.tweens.add({
      targets: [this.sprite, this.ombre],
      x: but.x,
      y: but.y,
      duration: duree,
      onUpdate: () => this.sprite.setDepth(this.sprite.y),
      onComplete: () => {
        sautille.stop();
        this.sprite.setScale(ECHELLE);
        this.scene.time.delayedCall(Phaser.Math.Between(1500, 5000), () => this.suite());
      },
    });
  }

  private dormir(): void {
    this.dort = true;
    this.sprite.setTexture("chat-dort");
    this.zzz = this.scene.time.addEvent({ delay: 900, loop: true, callback: () => this.unZ() });
    this.scene.time.delayedCall(Phaser.Math.Between(12_000, 25_000), () => this.reveiller());
  }

  private reveiller(): void {
    if (!this.dort) return;
    this.dort = false;
    this.zzz?.remove();
    this.sprite.setTexture("chat");
    this.suite();
  }

  private unZ(): void {
    const z = this.scene.add
      .text(this.sprite.x + 12, this.sprite.y - 24, "z", { fontFamily: '"Press Start 2P", monospace', fontSize: "8px", color: "#dfe6ff" })
      .setDepth(this.sprite.y + 1);
    this.scene.tweens.add({ targets: z, x: z.x + 10, y: z.y - 22, alpha: 0, duration: 1600, onComplete: () => z.destroy() });
  }

  /** Un clic : il miaule (et se réveille s'il dormait). */
  private caresser(): void {
    this.bulle?.destroy();
    const texte = this.dort ? "Mrrr… 💤" : Phaser.Utils.Array.GetRandom(["Miaou !", "Mrrrou ?", "Miaaou ♥", "Prrrr…"]);
    this.bulle = this.scene.add
      .text(this.sprite.x, this.sprite.y - 36, texte, { fontFamily: '"Pixelify Sans", sans-serif', fontSize: "14px", color: "#1b1b2f", backgroundColor: "#ffffff", padding: { x: 6, y: 3 } })
      .setOrigin(0.5, 1)
      .setDepth(2000);
    this.scene.tweens.add({ targets: this.bulle, y: this.bulle.y - 8, alpha: { from: 1, to: 0 }, delay: 900, duration: 700, onComplete: () => this.bulle?.destroy() });
    const coeur = this.scene.add.text(this.sprite.x - 4, this.sprite.y - 30, "♥", { fontSize: "14px", color: "#ff6b9d" }).setDepth(2000);
    this.scene.tweens.add({ targets: coeur, y: coeur.y - 30, alpha: 0, duration: 1100, onComplete: () => coeur.destroy() });
    if (this.dort) this.scene.time.delayedCall(1200, () => this.reveiller());
  }
}
