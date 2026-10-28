// Les artefacts de Johan sur claude.ai, posés dans le bureau : ils gardent leurs données, leur IA et leur Gmail sur
// claude.ai, donc Max les ouvre dans le navigateur (où il est connecté) au lieu de les copier.
export interface Artefact {
  id: "jarvis-ultime" | "agent-financier" | "muse";
  nom: string;
  emoji: string;
  /** Ce qu'il fait, pour Max et pour l'écran. */
  description: string;
  url: string;
}

export const ARTEFACTS: Artefact[] = [
  {
    id: "jarvis-ultime",
    nom: "JARVIS ULTIME",
    emoji: "👁",
    description: "son assistant claude.ai : planning du jour, études PASS (UE, fiches, interrogation orale, récitation), sport, prière, budget, courses, corvées, proches, bilan du soir",
    url: "https://claude.ai/artifact/AMmh5P3szhb2MXL2YtRp2s",
  },
  { id: "agent-financier", nom: "Agent financier", emoji: "💶", description: "ses finances : budget, dépenses, revenus, objectifs d'épargne", url: "https://claude.ai/artifact/5Envk91bbCznx7bKLdpCHD" },
  {
    id: "muse",
    nom: "Muse",
    emoji: "✦",
    description: "des idées de business IA chaque jour, le boost Asclepium et les guides pas à pas",
    url: "https://claude.ai/artifact/ChtV57zUDqYdQGJsKotktQ",
  },
];
