// Le niveau du joueur : chaque minute de vrai travail (sessions du coach) rapporte 1 XP.
// Les premiers niveaux viennent vite (pour l'élan), puis chacun demande une heure de plus que le précédent.

export interface Niveau {
  niveau: number;
  /** XP gagnés dans le niveau en cours. */
  xp: number;
  /** XP nécessaires pour passer au niveau suivant. */
  prochain: number;
}

/** XP pour passer du niveau n au niveau n + 1 : 1 h, 2 h, 3 h… */
export const xpPourNiveau = (n: number) => n * 60;

export function niveau(minutesTotales: number): Niveau {
  let reste = Math.max(0, Math.floor(minutesTotales));
  let n = 1;
  while (reste >= xpPourNiveau(n)) {
    reste -= xpPourNiveau(n);
    n++;
  }
  return { niveau: n, xp: reste, prochain: xpPourNiveau(n) };
}
