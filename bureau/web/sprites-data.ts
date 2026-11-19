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

/** Une bibliothèque : trois étagères de livres de hauteurs et de couleurs variées. */
const bibliotheque = (): string[] => {
  const L = 20;
  const couleurs = "rutvoyl";
  const lignes: string[] = ["K".repeat(L), "K" + "N".repeat(L - 2) + "K"];
  for (let etage = 0; etage < 3; etage++) {
    const hauteurs = [6, 5, 6, 4, 6, 5, 6, 6, 4];
    for (let y = 0; y < 6; y++) {
      let l = "KN";
      for (let livre = 0; livre < 8; livre++) {
        const h = hauteurs[(livre + etage * 3) % hauteurs.length];
        const c = couleurs[(livre * 3 + etage) % couleurs.length];
        l += y >= 6 - h ? c + c : "dd";
      }
      lignes.push(l + "NK");
    }
    lignes.push("K" + "N".repeat(L - 2) + "K");
  }
  lignes.push("K" + "d".repeat(L - 2) + "K", "K" + "K".repeat(L - 2) + "K");
  return lignes;
};

/** Un serveur : une armoire métallique (les voyants clignotants sont dessinés par-dessus). */
const serveur = (): string[] => {
  const l = ["KKKKKKKKKKKK", "KffffffffffK"];
  for (let i = 0; i < 6; i++) l.push("KjjjjjjjjjjK", "KjeeeeeeeejK", "KjjjjjjjjjjK");
  l.push("KffffffffffK", "KKKKKKKKKKKK");
  return l;
};

/** Le bureau d'un robot ; `motif` remplit l'écran (des lignes de code quand il est allumé). */
const bureauAvec = (motif: string[]): string[] => [
  "........KKKKKKKKKKKKKKKK........",
  `........K${motif[0]}K........`,
  `........K${motif[1]}K........`,
  `........K${motif[2]}K........`,
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
];
const ECRAN_VIDE = ["MMMMMMMMMMMMMM", "MMMMMMMMMMMMMM", "MMMMMMMMMMMMMM"];
/** Trois images de code qui défile, pour les écrans allumés. */
export const ECRANS_CODE = [
  ["MllMlllMMMMMMM", "MMMllMlllllMMM", "MllllMMMMMMMMM"],
  ["MMMllMlllllMMM", "MllllMMMMMMMMM", "MllMMlllMllMMM"],
  ["MllllMMMMMMMMM", "MllMMlllMllMMM", "MMllllMlllMMMM"],
];

export const CARTES = {
  robot: [...TETE_ROBOT, ...CORPS_ROBOT, ...JAMBES],
  robotMarche: [...TETE_ROBOT, ...CORPS_ROBOT, ...JAMBES_MARCHE],
  max: [...TETE_MAX, ...CORPS_MAX, ...JAMBES],
  maxMarche: [...TETE_MAX, ...CORPS_MAX, ...JAMBES_MARCHE],
  bureau: bureauAvec(ECRAN_VIDE),
  bureauCode0: bureauAvec(ECRANS_CODE[0]),
  bureauCode1: bureauAvec(ECRANS_CODE[1]),
  bureauCode2: bureauAvec(ECRANS_CODE[2]),
  bibliotheque: bibliotheque(),
  serveur: serveur(),
  arcade: [
    "..KKKKKKKKKKKK..",
    ".KyyyyyyyyyyyyK.",
    ".KyKKyKKyKKyKyK.",
    ".KyyyyyyyyyyyyK.",
    "KKKKKKKKKKKKKKKK",
    "KuKKKKKKKKKKKKuK",
    "KuKssssssssssKuK",
    "KuKsllssssslsKuK",
    "KuKssssllssssKuK",
    "KuKsssvssssssKuK",
    "KuKssssssssssKuK",
    "KuKKKKKKKKKKKKuK",
    "KuuuuuuuuuuuuuuK",
    "KKKKKKKKKKKKKKKK",
    "KjjjjjjjjjjjjjjK",
    "KjjrjjjjjojzjjjK",
    "KjjKjjjjjjjjjjjK",
    "KKKKKKKKKKKKKKKK",
    "KuuuuuuuuuuuuuuK",
    "KuuuuuuuuuuuuuuK",
    "KuuuuuuyyuuuuuuK",
    "KuuuuuuuuuuuuuuK",
    "KuuuuuuuuuuuuuuK",
    "KKKKKKKKKKKKKKKK",
  ],
  chat: [
    ".K......K...",
    ".KoK..KoK...",
    "KooKKKKooK..",
    "KooooooooK..",
    "KoxKooKxoK..",
    "KoooppoooK..",
    ".KoowwooK...",
    "..KooooK..K.",
    ".KoooooooKoK",
    "KoooowoooKoK",
    "KoooowoooKK.",
    "KKKKKKKKKK..",
  ],
  chatDort: [
    "............",
    "............",
    "............",
    "............",
    ".K......K...",
    ".KoK..KoK...",
    "KooKKKKooK..",
    "KoKKooKKoKKK",
    "KoooppoooKoK",
    "KooowwooooK.",
    "KoooooooooK.",
    "KKKKKKKKKKK.",
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
  // bibliothèque, serveur, borne d'arcade
  u: "#3b5dc9",
  v: "#a7f070",
  o: "#ef7d57",
  l: "#41a6f6",
  s: "#1a1c2c",
  e: "#566c86",
  f: "#94b0c2",
  j: "#333c57",
  z: "#ffffff",
};

/** Le chat : roux, ventre crème, yeux verts, nez rose. */
export const PALETTE_CHAT: Record<string, string> = {
  K: "#1b1b2f",
  o: "#ef7d57",
  w: "#ffe6c7",
  x: "#a7f070",
  p: "#ff9eb5",
};

/** Les lignes de code d'un écran allumé. */
export const CODE_ECRAN = "#e8fdff";

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
