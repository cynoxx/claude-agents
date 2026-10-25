import { describe, it, expect } from "vitest";
import { assemblerTexte, choisirVoix, extraireResume, messageErreurDictee, quoiDire, texteParle } from "../web/voix.ts";
import type { MissionVue } from "../shared/protocol.ts";

const mission = (o: Partial<MissionVue> = {}): MissionVue => ({
  nom: "m1",
  texte: "t",
  titre: "T",
  phase: "planification",
  etape: 0,
  totalEtapes: 2,
  debut: "2026-10-25T10:00:00.000Z",
  max: { bulle: "", actions: [] },
  robots: [],
  ...o,
});

describe("texteParle", () => {
  it("retire titres, gras, liens et emojis", () => {
    expect(texteParle("# Titre\n\nVoici **important** et [le site](https://a.fr/x) ✅")).toBe("Titre. Voici important et le site.");
  });

  it("saute les tableaux et les blocs de code", () => {
    expect(texteParle("Avant\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```bash\ngit merge x\n```\n\nAprès")).toBe("Avant. Après.");
  });

  it("lit les listes comme des phrases", () => {
    expect(texteParle("- un\n- deux.\n1. trois")).toBe("un. deux. trois.");
  });

  it("supprime les adresses web", () => {
    expect(texteParle("Voir https://exemple.fr/page pour plus.")).toBe("Voir pour plus.");
  });

  it("recolle les lignes d'un même paragraphe", () => {
    expect(texteParle("une phrase\nsur deux lignes")).toBe("une phrase sur deux lignes.");
  });

  it("garde les nombres, les euros et le code en ligne", () => {
    expect(texteParle("Prix : 32 € soit `12 %`")).toBe("Prix : 32 € soit 12 %.");
  });

  it("ne lit pas les underscores d'un nom de fichier comme de l'italique", () => {
    expect(texteParle("Ouvre mon_fichier_final maintenant")).toBe("Ouvre mon_fichier_final maintenant.");
  });
});

describe("extraireResume", () => {
  const resultat = `# Résultat : 3 recettes protéinées rapides
## En 3 lignes
- Trois idées de recettes
- Seule l'escalope a un temps
- Les chiffres sont des calculs.
## Tableau des protéines par portion
| Recette | Protéines |
|---|---|
| Poulet | 25 |`;

  it("lit la section « En 3 lignes » et pas le tableau", () => {
    expect(extraireResume(resultat)).toBe("Trois idées de recettes. Seule l'escalope a un temps. Les chiffres sont des calculs.");
  });

  it("à défaut, lit le début après le titre", () => {
    expect(extraireResume("# Résultat\n\nSynthèse de test par Max.\n\n## Détails\n\nBeaucoup de texte")).toBe("Synthèse de test par Max.");
  });

  it("lit un texte sans aucun titre", () => {
    expect(extraireResume("Juste une phrase.")).toBe("Juste une phrase.");
  });

  it("coupe à la fin d'une phrase sous la limite", () => {
    expect(extraireResume("Première phrase ici. Deuxième phrase plus longue encore.", 30)).toBe("Première phrase ici.");
  });

  it("coupe une phrase unique trop longue au dernier mot, avec …", () => {
    const r = extraireResume("mot ".repeat(50).trim(), 30);
    expect(r.length).toBeLessThanOrEqual(31);
    expect(r.endsWith("…")).toBe(true);
  });

  it("renvoie une chaîne vide s'il n'y a rien à lire", () => {
    expect(extraireResume("")).toBe("");
    expect(extraireResume("| a | b |\n|---|---|")).toBe("");
  });
});

describe("choisirVoix", () => {
  const v = (name: string, lang: string, localService = true) => ({ name, lang, localService });

  it("renvoie null sans voix française", () => {
    expect(choisirVoix([v("Samantha", "en-US")])).toBeNull();
    expect(choisirVoix([])).toBeNull();
  });

  it("préfère le français de France au français canadien", () => {
    expect(choisirVoix([v("Amélie", "fr-CA"), v("Thomas", "fr-FR")])?.name).toBe("Thomas");
  });

  it("préfère une voix de qualité supérieure", () => {
    expect(choisirVoix([v("Thomas", "fr-FR"), v("Audrey (Premium)", "fr-FR")])?.name).toBe("Audrey (Premium)");
  });

  it("accepte les codes de langue avec underscore et renvoie l'objet d'origine", () => {
    const voix = v("Thomas", "fr_FR");
    expect(choisirVoix([v("Samantha", "en-US"), voix])).toBe(voix);
  });
});

describe("quoiDire", () => {
  it("ne dit rien au premier état reçu (rechargement de la page)", () => {
    expect(quoiDire(undefined, mission({ phase: "termine", resultat: "# R\n\nFini." }))).toBeNull();
  });

  it("annonce l'équipe quand la planification se termine", () => {
    const avant = mission();
    const apres = mission({ phase: "travail", max: { bulle: "Deux chercheurs, c'est parti !", actions: [] } });
    // l'espace insécable de la bulle devient une espace normale : sans effet à l'oral
    expect(quoiDire(avant, apres)).toBe("Deux chercheurs, c'est parti !");
  });

  it("annonce quand même quand la bulle est vide", () => {
    expect(quoiDire(mission(), mission({ phase: "travail" }))).toBe("L'équipe se met au travail.");
  });

  it("lit le résumé à la fin de la mission", () => {
    const avant = mission({ phase: "relecture" });
    const apres = mission({ phase: "termine", resultat: "# Résultat\n## En 3 lignes\n- Tout va bien.\n## Détail\nlong" });
    expect(quoiDire(avant, apres)).toBe("Mission terminée. Tout va bien.");
  });

  it("dit seulement « Mission terminée. » sans résultat", () => {
    expect(quoiDire(mission({ phase: "relecture" }), mission({ phase: "termine" }))).toBe("Mission terminée.");
  });

  it("prévient quand le quota est atteint", () => {
    expect(quoiDire(mission({ phase: "travail" }), mission({ phase: "pause" }))).toBe("Le quota est atteint : je mets la mission en pause.");
  });

  it("dit pourquoi la mission a échoué, en abrégé", () => {
    const erreur = "Max n'a pas réussi à planifier : " + "x".repeat(300);
    const dit = quoiDire(mission(), mission({ phase: "echec", erreur }))!;
    expect(dit.startsWith("La mission a échoué. Max n'a pas réussi à planifier")).toBe(true);
    expect(dit.length).toBeLessThan(200);
    expect(quoiDire(mission(), mission({ phase: "echec" }))).toBe("La mission a échoué.");
  });

  it("ne répète rien quand la phase ne change pas, à la reprise ou à l'arrêt", () => {
    expect(quoiDire(mission({ phase: "travail" }), mission({ phase: "travail" }))).toBeNull();
    expect(quoiDire(mission({ phase: "pause" }), mission({ phase: "travail" }))).toBeNull();
    expect(quoiDire(mission({ phase: "travail" }), mission({ phase: "arrete" }))).toBeNull();
  });

  it("ne dit rien au lancement d'une nouvelle mission ni sans mission", () => {
    expect(quoiDire(null, mission())).toBeNull();
    expect(quoiDire(mission({ phase: "termine" }), mission({ nom: "m2" }))).toBeNull();
    expect(quoiDire(mission(), null)).toBeNull();
  });
});

describe("assemblerTexte", () => {
  it("ajoute ce qui est dicté après le texte déjà écrit", () => {
    expect(assemblerTexte("", "bonjour")).toBe("bonjour");
    expect(assemblerTexte("Compare ", " trois mutuelles ")).toBe("Compare trois mutuelles");
    expect(assemblerTexte("déjà écrit", "")).toBe("déjà écrit");
  });
});

describe("messageErreurDictee", () => {
  it("explique le micro bloqué", () => {
    expect(messageErreurDictee("not-allowed")).toMatch(/micro.*Autorise/s);
    expect(messageErreurDictee("service-not-allowed")).toMatch(/Dictée.*Réglages Système/s);
  });
  it("explique le silence, l'absence de micro et le réseau", () => {
    expect(messageErreurDictee("no-speech")).toMatch(/rien entendu/);
    expect(messageErreurDictee("audio-capture")).toMatch(/Aucun micro/);
    expect(messageErreurDictee("network")).toMatch(/internet/);
  });
  it("ne dit rien quand c'est toi qui arrêtes", () => {
    expect(messageErreurDictee("aborted")).toBeNull();
  });
  it("donne le code d'une erreur inconnue", () => {
    expect(messageErreurDictee("bizarre")).toContain("bizarre");
  });
});
