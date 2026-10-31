import type { RoleId } from "./protocol.ts";

/** Ce que l'écran affiche de chaque métier (le serveur y ajoute outils et consignes). */
export const ROLE_AFFICHAGE: Record<RoleId, { nom: string; emoji: string; couleur: string }> = {
  chercheur: { nom: "Chercheur", emoji: "🔎", couleur: "#4f9dde" },
  codeur: { nom: "Codeur", emoji: "💻", couleur: "#5cbf60" },
  designer: { nom: "Designer", emoji: "🎨", couleur: "#d96bc8" },
  redacteur: { nom: "Rédacteur", emoji: "✍️", couleur: "#e8a33d" },
  analyste: { nom: "Analyste", emoji: "📊", couleur: "#9b7be0" },
};

export const COULEUR_MAX = "#f2c14e";
