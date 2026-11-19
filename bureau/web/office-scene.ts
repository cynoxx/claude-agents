import Phaser from "phaser";
import type { AssistantVue, ConseillerVue, EtatMax, MissionVue, RobotVue } from "../shared/protocol.ts";
import { creerTextureConseiller, creerTextures } from "./sprites.ts";
import { ECHELLE, Robot, type Point } from "./robot.ts";
import { Chat } from "./chat.ts";
import { Decor, texteBandeau } from "./decor.ts";

export const LARGEUR = 960;
export const HAUTEUR = 690;
/** En dessous : l'aile des conseillers, un bureau par domaine de la vie. */
const AILE = 540;
const AILE_POSTE_Y = 590;
const AILE_DEVANT = 48;

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
  private conseillers = new Map<string, { robot: Robot; poste: Phaser.GameObjects.Image }>();
  private conseillersEnAttente?: ConseillerVue[];
  private decor!: Decor;
  private allumes = new Set<Phaser.GameObjects.Image>();

  constructor(private rappels: Rappels) {
    super("bureau");
  }

  create(): void {
    creerTextures(this);
    this.dessinerDecor();
    this.max = new Robot(this, MAX.x, MAX.y, "max", "👑 Max", ALLEE_Y, () => this.rappels.onClic("max"));
    this.max.setBulle("Donne-moi une mission\u00a0!");
    new Chat(this, [
      { x: 250, y: 360 },
      { x: 560, y: 360 },
      { x: 820, y: 470 },
      { x: 300, y: 500 },
      { x: 640, y: 500 },
      { x: 400, y: 280 },
      { x: 860, y: 330 },
    ]);
    this.time.addEvent({ delay: 500, loop: true, callback: () => this.cacherBullesFinies() });
    if (this.enAttente !== undefined) this.sync(this.enAttente.m, this.enAttente.a);
    if (this.conseillersEnAttente) this.syncConseillers(this.conseillersEnAttente);
  }

  /** Les conseillers à leur bureau : ils travaillent quand Max leur pose une question. */
  syncConseillers(liste: ConseillerVue[] | undefined): void {
    if (!liste) return;
    if (!this.max) {
      this.conseillersEnAttente = liste;
      return;
    }
    const pas = LARGEUR / Math.max(liste.length, 1);
    liste.forEach((c, i) => {
      let place = this.conseillers.get(c.id);
      if (!place) {
        const x = Math.round(pas * (i + 0.5));
        const cle = `conseiller-${c.id}`;
        creerTextureConseiller(this, cle, c.couleur);
        const poste = this.add.image(x, AILE_POSTE_Y, "bureau-off").setScale(ECHELLE).setDepth(AILE_POSTE_Y + 22);
        const robot = new Robot(this, x, AILE_POSTE_Y + AILE_DEVANT, cle, `${c.emoji} ${c.nom}`, AILE_POSTE_Y + AILE_DEVANT, () => this.rappels.onClic(`conseiller:${c.id}`));
        place = { robot, poste };
        this.conseillers.set(c.id, place);
      }
      const occupe = c.statut === "reflechit";
      place.robot.travailler(occupe);
      place.robot.setIcone(occupe ? "💭" : "");
      place.robot.setBulle(c.bulle);
      this.allumer(place.poste, occupe);
    });
  }

  private dessinerDecor(): void {
    this.decor = new Decor(this, {
      largeur: LARGEUR,
      mur: MUR,
      aile: AILE,
      fenetres: [190, 690],
      enseigne: { x: 360, y: 10, l: 240, h: 64 },
      lumieres: [BUREAU_MAX, ...POSTES.map((p) => ({ x: p.x, y: p.y + 30 })), { x: CAFE.x - 30, y: 240 }],
      cafe: CAFE,
    });
    this.decor.creer();
    this.decor.annoncer(texteBandeau(null));

    // l'enseigne de l'aile des conseillers
    const g = this.add.graphics().setDepth(-7);
    g.fillStyle(0x05040c, 1).fillRect(LARGEUR / 2 - 104, AILE - 16, 208, 28);
    g.fillStyle(0x1b1b2f, 1).fillRect(LARGEUR / 2 - 100, AILE - 12, 200, 20);
    this.add
      .text(LARGEUR / 2, AILE - 2, "TES PÔLES", { fontFamily: '"Press Start 2P", monospace', fontSize: "9px", color: "#7df9ff" })
      .setOrigin(0.5)
      .setShadow(0, 0, "#00c8ff", 8, false, true)
      .setDepth(-6);

    this.add.image(PORTE.x, MUR, "porte").setOrigin(0.5, 1).setScale(ECHELLE).setDepth(-8);
    this.add.image(CAFE.x, CAFE.y, "cafe").setOrigin(0.5, 1).setScale(ECHELLE).setDepth(CAFE.y);
    this.add
      .text(CAFE.x, CAFE.y + 4, "CAFÉ", { fontFamily: '"Press Start 2P", monospace', fontSize: "7px", color: "#f4f4f4" })
      .setOrigin(0.5, 0)
      .setStroke("#1b1b2f", 3)
      .setDepth(CAFE.y);
    for (const p of [{ x: 34, y: 520 }, { x: 930, y: 520 }, { x: 300, y: 140 }, { x: 660, y: 140 }]) {
      const plante = this.add.image(p.x, p.y, "plante").setOrigin(0.5, 1).setScale(ECHELLE).setDepth(p.y);
      // les plantes bougent un peu, comme s'il y avait de l'air
      this.tweens.add({ targets: plante, scaleX: ECHELLE * 1.04, duration: 1800 + (p.x % 7) * 150, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
    this.add.image(BUREAU_MAX.x, BUREAU_MAX.y, "bureau-off").setScale(ECHELLE * 1.25).setDepth(BUREAU_MAX.y + 30);
    this.postes = POSTES.map((p) => this.add.image(p.x, p.y, "bureau-off").setScale(ECHELLE).setDepth(p.y + 22));
    // les écrans allumés font défiler du code
    let image = 0;
    this.time.addEvent({
      delay: 260,
      loop: true,
      callback: () => {
        image = (image + 1) % 3;
        for (const poste of this.allumes) poste.setTexture(`bureau-code-${image}`);
      },
    });
  }

  private allumer(poste: Phaser.GameObjects.Image, oui: boolean): void {
    if (oui === this.allumes.has(poste)) return;
    if (oui) {
      this.allumes.add(poste);
      poste.setTexture("bureau-code-0");
    } else {
      this.allumes.delete(poste);
      poste.setTexture("bureau-off");
    }
  }

  /** Met la scène en accord avec l'état reçu du serveur (mission et conversation avec Max). */
  sync(m: MissionVue | null, a?: AssistantVue): void {
    if (!this.max) {
      this.enAttente = { m, a };
      return;
    }
    if ((m?.nom ?? null) !== this.missionNom) this.nouvelleMission(m);
    this.decor.annoncer(texteBandeau(m));

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
      this.allumer(this.postes[i % POSTES.length], r.statut === "travail");
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
    this.postes.forEach((p) => this.allumer(p, false));
    this.fete = false;
    this.missionNom = m?.nom ?? null;
  }
}
