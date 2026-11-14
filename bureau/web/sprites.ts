import Phaser from "phaser";
import { ROLE_AFFICHAGE, COULEUR_MAX } from "../shared/roles-affichage.ts";
import type { RoleId } from "../shared/protocol.ts";
import { CARTES, CODE_ECRAN, ECRAN_ALLUME, PALETTE_BASE, PALETTE_CHAT, paletteRobot } from "./sprites-data.ts";

function dessiner(scene: Phaser.Scene, cle: string, carte: string[], palette: Record<string, string>): void {
  if (scene.textures.exists(cle)) return;
  const tex = scene.textures.createCanvas(cle, carte[0].length, carte.length)!;
  const ctx = tex.getContext();
  carte.forEach((ligne, y) =>
    [...ligne].forEach((c, x) => {
      if (c === ".") return;
      ctx.fillStyle = palette[c];
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  tex.refresh();
}

export const cleRobot = (role: string, marche = false) => `robot-${role}${marche ? "-marche" : ""}`;

/** Les textures d'un conseiller (sa couleur à lui), créées à son arrivée dans le bureau. */
export function creerTextureConseiller(scene: Phaser.Scene, cle: string, couleur: string): void {
  dessiner(scene, cleRobot(cle), CARTES.robot, paletteRobot(couleur));
  dessiner(scene, cleRobot(cle, true), CARTES.robotMarche, paletteRobot(couleur));
}

/** Crée toutes les textures du bureau à partir des cartes de pixels. */
export function creerTextures(scene: Phaser.Scene): void {
  for (const [role, a] of Object.entries(ROLE_AFFICHAGE) as [RoleId, { couleur: string }][]) {
    dessiner(scene, cleRobot(role), CARTES.robot, paletteRobot(a.couleur));
    dessiner(scene, cleRobot(role, true), CARTES.robotMarche, paletteRobot(a.couleur));
  }
  dessiner(scene, cleRobot("max"), CARTES.max, paletteRobot(COULEUR_MAX));
  dessiner(scene, cleRobot("max", true), CARTES.maxMarche, paletteRobot(COULEUR_MAX));
  dessiner(scene, "bureau-off", CARTES.bureau, PALETTE_BASE);
  dessiner(scene, "bureau-on", CARTES.bureau, { ...PALETTE_BASE, M: ECRAN_ALLUME });
  const ecran = { ...PALETTE_BASE, M: "#1d6f8a", l: CODE_ECRAN };
  dessiner(scene, "bureau-code-0", CARTES.bureauCode0, ecran);
  dessiner(scene, "bureau-code-1", CARTES.bureauCode1, ecran);
  dessiner(scene, "bureau-code-2", CARTES.bureauCode2, ecran);
  dessiner(scene, "bibliotheque", CARTES.bibliotheque, PALETTE_BASE);
  dessiner(scene, "serveur", CARTES.serveur, PALETTE_BASE);
  dessiner(scene, "arcade", CARTES.arcade, PALETTE_BASE);
  dessiner(scene, "chat", CARTES.chat, PALETTE_CHAT);
  dessiner(scene, "chat-dort", CARTES.chatDort, PALETTE_CHAT);
  dessiner(scene, "cafe", CARTES.cafe, PALETTE_BASE);
  dessiner(scene, "plante", CARTES.plante, PALETTE_BASE);
  dessiner(scene, "porte", CARTES.porte, PALETTE_BASE);
}
