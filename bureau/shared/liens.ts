// Les raccourcis directs de la barre de Max : un clic ouvre l'appli (ou la page web si elle n'est pas installée).
export interface Lien {
  id: "notion" | "super-productivity" | "excel";
  nom: string;
  emoji: string;
  description: string;
}

export const LIENS: Lien[] = [
  { id: "notion", nom: "Notion", emoji: "📝", description: "ouvre Notion (ta page, si tu en as mis une dans bureau.config.json)" },
  { id: "super-productivity", nom: "Super Productivity", emoji: "✅", description: "ouvre Super Productivity, ta liste de tâches et ton suivi du temps" },
  { id: "excel", nom: "Suivi d'habitudes", emoji: "📊", description: "ouvre ton tableau Excel de suivi d'habitudes, rempli par Max" },
];
