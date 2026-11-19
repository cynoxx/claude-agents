import { describe, it, expect } from "vitest";
import { choisirVoix, couper, extraireResume, texteParle } from "../shared/parole.ts";

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

describe("couper", () => {
  it("laisse un texte court intact", () => {
    expect(couper("Court.", 30)).toBe("Court.");
  });
});
