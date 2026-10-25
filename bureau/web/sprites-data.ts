// Cartes de pixels du bureau (un caractère = un pixel, « . » = transparent).

const porte = (): string[] => {
  const l: string[] = ["KKKKKKKKKKKKKK"];
  for (let i = 1; i < 23; i++) {
    if (i === 5 || i === 17) l.push("KdNNNNNNNNNNdK");
    else if (i === 12) l.push("KddddddddddhdK");
    else l.push("KddddddddddddK");
  }
  l.push("KKKKKKKKKKKKKK");
  return l;
};

const TETE_ROBOT = [
  ".......AA.......",
  ".......KK.......",
  "....KKKKKKKK....",
  "...KLLLLLLLLK...",
  "...KLSSSSSSLK...",
  "...KLSESSESLK...",
  "...KLSSSSSSLK...",
  "...KLLLLLLLLK...",
  "....KKKKKKKK....",
];
const TETE_MAX = [
  ".....KKKKKK.....",
  "....KWWWWWWK....",
  "....KWWWWWWK....",
  "...KKKKKKKKKK...",
  "...KLSSSSSSLK...",
  "...KLSESSESLK...",
  "...KLSSSSSSLK...",
  "...KLLLLLLLLK...",
  "....KKKKKKKK....",
];
const CORPS_ROBOT = [
  "..KKBBBBBBBBKK..",
  ".KDKBBBWWBBBKDK.",
  ".KDKBBBBBBBBKDK.",
  "..KKBBBBBBBBKK..",
  "....KKKKKKKK....",
];
const CORPS_MAX = [
  "..KKBBBRRBBBKK..",
  ".KDKBBBRRBBBKDK.",
  ".KDKBBBBRBBBKDK.",
  "..KKBBBBBBBBKK..",
  "....KKKKKKKK....",
];
const JAMBES = [".....GG..GG.....", "....KKK..KKK...."];
const JAMBES_MARCHE = ["....GG....GG....", "...KKK....KKK..."];

export const CARTES = {
  robot: [...TETE_ROBOT, ...CORPS_ROBOT, ...JAMBES],
  robotMarche: [...TETE_ROBOT, ...CORPS_ROBOT, ...JAMBES_MARCHE],
  max: [...TETE_MAX, ...CORPS_MAX, ...JAMBES],
  maxMarche: [...TETE_MAX, ...CORPS_MAX, ...JAMBES_MARCHE],
  bureau: [
    "........KKKKKKKKKKKKKKKK........",
    "........KMMMMMMMMMMMMMMK........",
    "........KMMMMMMMMMMMMMMK........",
    "........KMMMMMMMMMMMMMMK........",
    "........KKKKKKKKKKKKKKKK........",
    "...............KK...............",
    "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
    "KOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOK",
    "KOOOOOOOOOOOccccccccOOOOOOOOOOOK",
    "KOOOOOOOOOOOccccccccOOOOOOOOOOOK",
    "KOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOK",
    "KNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNK",
    "KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK",
    ".KN..........................NK.",
    ".KK..........................KK.",
  ],
  cafe: [
    "KKKKKKKKKKKK",
    "KggggggggggK",
    "KgrrgggyyggK",
    "KggggggggggK",
    "KKKKKKKKKKKK",
    "KgKKKKKKKKgK",
    "KgK......KgK",
    "KgK......KgK",
    "KgK..ww..KgK",
    "KgK..bb..KgK",
    "KgKKKKKKKKgK",
    "KggggggggggK",
    "KggggggggggK",
    "KKKKKKKKKKKK",
  ],
  plante: [
    "...pp.....",
    "..pqp.pp..",
    ".pqqppqp..",
    "pqpqqpqqp.",
    ".pqpqqpqp.",
    "..pqpqpp..",
    "...pqqp...",
    "....qq....",
    "..KKKKKK..",
    "..KttttK..",
    "...KttK...",
    "...KttK...",
    "...KKKK...",
  ],
  porte: porte(),
} satisfies Record<string, string[]>;

export type NomCarte = keyof typeof CARTES;

export const PALETTE_BASE: Record<string, string> = {
  K: "#1b1b2f",
  M: "#2b2d42",
  N: "#8f563b",
  O: "#c28569",
  c: "#c2c3c7",
  g: "#83769c",
  r: "#e43b44",
  w: "#f4f4f4",
  y: "#ffec27",
  b: "#5a3a29",
  p: "#38b764",
  q: "#257179",
  t: "#b13e53",
  d: "#6b4226",
  h: "#ffcd75",
};

/** Écran allumé : le moniteur d'un poste où un robot travaille. */
export const ECRAN_ALLUME = "#7df9ff";

const melange = (hex: string, f: (c: number) => number) =>
  "#" + [1, 3, 5].map((i) => Math.round(f(parseInt(hex.slice(i, i + 2), 16))).toString(16).padStart(2, "0")).join("");

/** Palette d'un robot à partir de la couleur de son métier. */
export function paletteRobot(couleur: string): Record<string, string> {
  return {
    K: "#1b1b2f",
    B: couleur,
    D: melange(couleur, (c) => c * 0.7),
    L: melange(couleur, (c) => c + (255 - c) * 0.3),
    S: "#1d2b53",
    E: "#7df9ff",
    A: "#ffec27",
    W: "#f4f4f4",
    G: "#5f6b7a",
    R: "#e43b44",
  };
}
