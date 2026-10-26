import Phaser from "phaser";
import type { AssistantVue, EtatMax, MissionVue, RobotVue } from "../shared/protocol.ts";
import { creerTextures } from "./sprites.ts";
import { ECHELLE, Robot, type Point } from "./robot.ts";

export const LARGEUR = 960;
export const HAUTEUR = 540;

const MUR = 100;
const ALLEE_Y = 392;
const PORTE: Point = { x: 76, y: MUR + 6 };
const POSTES: Point[] = [
  { x: 210, y: 290 },
  { x: 480, y: 290 },
  { x: 750, y: 290 },
  { x: 210, y: 430 },
  { x: 480, y: 430 },
  { x: 750, y: 430 },
];
const DEVANT_POSTE = 52; // les robots se tiennent devant leur bureau
const BUREAU_MAX: Point = { x: 480, y: 150 };
const MAX: Point = { x: 480, y: 205 };
const TABLE: Point[] = [
  { x: 395, y: 215 },
  { x: 565, y: 215 },
  { x: 335, y: 240 },
  { x: 625, y: 240 },
  { x: 275, y: 215 },
];
const CAFE: Point = { x: 905, y: 168 };
const FILE_CAFE: Point[] = [
  { x: 862, y: 215 },
  { x: 912, y: 236 },
  { x: 862, y: 257 },
  { x: 912, y: 278 },
  { x: 862, y: 299 },
];

const ICONES: Record<RobotVue["statut"], string> = {
  attente: "☕",
  travail: "",
  fini: "✅",
  quota: "💤",
  erreur: "❗",
  arrete: "",
};

const BULLE_REPOS: Record<EtatMax, string> = {
  veille: "Zzz…",
  ecoute: "Je t'écoute\u00a0!",
  reflechit: "Hmm…",
  parle: "",
};

export interface Rappels {
  onClic(id: string): void;
}

/** La scène du bureau : décor, Max et les robots, synchronisés avec l'état de la mission. */
export class OfficeScene extends Phaser.Scene {
  private max!: Robot;
  private robots = new Map<string, Robot>();
  private postes: Phaser.GameObjects.Image[] = [];
  private missionNom: string | null = null;
  private fete = false;
  private enAttente: { m: MissionVue | null; a?: AssistantVue } | undefined;
  private finiDepuis = new Map<string, number>();

  constructor(private rappels: Rappels) {
    super("bureau");
  }

  create(): void {
    creerTextures(this);
    this.dessinerDecor();
    this.max = new Robot(this, MAX.x, MAX.y, "max", "👑 Max", ALLEE_Y, () => this.rappels.onClic("max"));
    this.max.setBulle("Donne-moi une mission\u00a0!");
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.cacherBullesFinies() });
    if (this.enAttente !== undefined) this.sync(this.enAttente.m, this.enAttente.a);
  }

  private dessinerDecor(): void {
    const g = this.add.graphics().setDepth(-10);
    // sol en damier
    const t = 48;
    for (let y = MUR; y < HAUTEUR; y += t) {
      for (let x = 0; x < LARGEUR; x += t) {
        g.fillStyle(((x + y) / t) % 2 === 0 ? 0x7a5c48 : 0x6f5241, 1).fillRect(x, y, t, t);
      }
    }
    // mur, plinthe, fenêtres
    g.fillStyle(0x3b3f63, 1).fillRect(0, 0, LARGEUR, MUR);
    g.fillStyle(0x4a4f7a, 1).fillRect(0, 0, LARGEUR, 10);
    g.fillStyle(0x2a2c45, 1).fillRect(0, MUR - 8, LARGEUR, 8);
    for (const fx of [190, 690]) {
      g.fillStyle(0x1b1b2f, 1).fillRect(fx - 4, 18, 128, 62);
      g.fillStyle(0x8fd3ff, 1).fillRect(fx, 22, 120, 54);
      g.fillStyle(0xc9ecff, 1).fillRect(fx + 8, 28, 30, 10);
      g.fillStyle(0x1b1b2f, 1).fillRect(fx + 58, 22, 4, 54).fillRect(fx, 47, 120, 4);
    }
    // tapis sous le bureau de Max
    g.fillStyle(0x9e4a5a, 0.9).fillRoundedRect(BUREAU_MAX.x - 170, 118, 340, 140, 18);
    g.lineStyle(4, 0xc76b7c, 1).strokeRoundedRect(BUREAU_MAX.x - 160, 126, 320, 124, 14);
    // enseigne
    g.fillStyle(0x1b1b2f, 1).fillRoundedRect(LARGEUR / 2 - 110, 26, 220, 44, 6);
    this.add
      .text(LARGEUR / 2, 48, "LE BUREAU", { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "24px", fontStyle: "bold", color: "#f2c14e" })
      .setOrigin(0.5)
      .setDepth(-9);

    this.add.image(PORTE.x, MUR, "porte").setOrigin(0.5, 1).setScale(ECHELLE).setDepth(-8);
    this.add.image(CAFE.x, CAFE.y, "cafe").setOrigin(0.5, 1).setScale(ECHELLE).setDepth(CAFE.y);
    this.add.text(CAFE.x, CAFE.y + 4, "café", { fontFamily: "ui-monospace, monospace", fontSize: "11px", color: "#f4f4f4" }).setOrigin(0.5, 0).setDepth(CAFE.y);
    for (const p of [{ x: 34, y: 520 }, { x: 930, y: 520 }, { x: 300, y: 140 }, { x: 660, y: 140 }]) {
      this.add.image(p.x, p.y, "plante").setOrigin(0.5, 1).setScale(ECHELLE).setDepth(p.y);
    }
    this.add.image(BUREAU_MAX.x, BUREAU_MAX.y, "bureau-off").setScale(ECHELLE * 1.25).setDepth(BUREAU_MAX.y + 30);
    this.postes = POSTES.map((p) => this.add.image(p.x, p.y, "bureau-off").setScale(ECHELLE).setDepth(p.y + 22));
  }

  /** Met la scène en accord avec l'état reçu du serveur (mission et conversation avec Max). */
  sync(m: MissionVue | null, a?: AssistantVue): void {
    if (!this.max) {
      this.enAttente = { m, a };
      return;
    }
    if ((m?.nom ?? null) !== this.missionNom) this.nouvelleMission(m);

    // la bulle de Max : ce qu'il dit à voix haute, sinon l'état de la mission, sinon son humeur du moment
    const auRepos = a ? BULLE_REPOS[a.etat] : "Donne-moi une mission\u00a0!";
    this.max.setBulle(a?.phrase || (m && m.max.bulle) || auRepos);
    const occupe = (!!m && (m.phase === "planification" || m.phase === "relecture")) || a?.etat === "parle" || a?.etat === "reflechit";
    this.max.travailler(occupe);
    if (!m) return;

    m.robots.forEach((r, i) => {
      let robot = this.robots.get(r.id);
      if (!robot) {
        robot = new Robot(this, PORTE.x, PORTE.y, r.role, `${r.nom}`, ALLEE_Y, () => this.rappels.onClic(r.id));
        robot.setAlpha(0);
        this.tweens.add({ targets: robot, alpha: 1, duration: 300 });
        this.robots.set(r.id, robot);
      }
      if (r.statut === "arrete") {
        this.robots.delete(r.id);
        robot.partir(PORTE);
        return;
      }
      robot.allerA(this.position(r, i), () => robot!.travailler(r.statut === "travail"));
      if (r.statut !== "travail") robot.travailler(false);
      robot.setIcone(ICONES[r.statut]);
      if (r.statut === "fini" && !this.finiDepuis.has(r.id)) this.finiDepuis.set(r.id, Date.now());
      if (r.statut !== "fini") this.finiDepuis.delete(r.id);
      if (r.statut !== "fini" || Date.now() - (this.finiDepuis.get(r.id) ?? 0) < 4000) {
        robot.setBulle(r.statut === "attente" ? "" : r.bulle);
      }
      this.postes[i % POSTES.length].setTexture(r.statut === "travail" ? "bureau-on" : "bureau-off");
    });

    if (m.phase === "termine" && !this.fete) {
      this.fete = true;
      this.time.delayedCall(800, () => {
        this.max.feter();
        this.robots.forEach((r) => r.feter());
      });
    }
  }

  private position(r: RobotVue, i: number): Point {
    if (r.statut === "attente") return FILE_CAFE[i % FILE_CAFE.length];
    if (r.statut === "fini") return TABLE[i % TABLE.length];
    const p = POSTES[i % POSTES.length];
    return { x: p.x, y: p.y + DEVANT_POSTE };
  }

  private cacherBullesFinies(): void {
    for (const [id, depuis] of this.finiDepuis) {
      if (Date.now() - depuis >= 4000) this.robots.get(id)?.setBulle("");
    }
  }

  private nouvelleMission(m: MissionVue | null): void {
    this.robots.forEach((r) => r.partir(PORTE));
    this.robots.clear();
    this.finiDepuis.clear();
    this.postes.forEach((p) => p.setTexture("bureau-off"));
    this.fete = false;
    this.missionNom = m?.nom ?? null;
  }
}
