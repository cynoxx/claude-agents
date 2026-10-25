import { describe, it, expect } from "vitest";
import { Dictee, Parole } from "../web/voix-navigateur.ts";

class FauxEnonce {
  lang = "";
  voice: unknown = null;
  constructor(public text: string) {}
}

function fausseSynthese(voices: { name: string; lang: string; localService: boolean }[] = []) {
  return {
    dits: [] as FauxEnonce[],
    annulations: 0,
    getVoices: () => voices,
    speak(e: FauxEnonce) {
      this.dits.push(e);
    },
    cancel() {
      this.annulations++;
    },
  };
}

describe("Parole", () => {
  it("parle en français et coupe la parole précédente", () => {
    const s = fausseSynthese();
    const p = new Parole(s, FauxEnonce);
    p.parler("Bonjour");
    expect(s.annulations).toBe(1);
    expect(s.dits.map((e) => [e.text, e.lang])).toEqual([["Bonjour", "fr-FR"]]);
  });

  it("choisit la meilleure voix française installée", () => {
    const thomas = { name: "Thomas", lang: "fr-FR", localService: true };
    const s = fausseSynthese([{ name: "Samantha", lang: "en-US", localService: true }, thomas]);
    new Parole(s, FauxEnonce).parler("Salut");
    expect(s.dits[0].voice).toBe(thomas);
  });

  it("parle quand même avec la voix par défaut si le navigateur refuse la voix choisie", () => {
    class EnonceQuiRefuseLaVoix {
      lang = "";
      constructor(public text: string) {}
      set voice(_: unknown) {
        throw new TypeError("Failed to convert value to 'SpeechSynthesisVoice'");
      }
    }
    const s = fausseSynthese([{ name: "Thomas", lang: "fr-FR", localService: true }]);
    expect(() => new Parole(s, EnonceQuiRefuseLaVoix).parler("Salut")).not.toThrow();
    expect(s.dits.map((e) => e.text)).toEqual(["Salut"]);
  });

  it("se tait quand il est coupé ou quand il n'y a rien à dire", () => {
    const s = fausseSynthese();
    const p = new Parole(s, FauxEnonce);
    p.muet = true;
    p.parler("Bonjour");
    p.muet = false;
    p.parler("   ");
    expect(s.dits).toHaveLength(0);
  });

  it("taire() coupe la parole en cours, même quand il est muet", () => {
    const s = fausseSynthese();
    const p = new Parole(s, FauxEnonce);
    p.muet = true;
    p.taire();
    expect(s.annulations).toBe(1);
  });

  it("n'est pas disponible sans synthèse vocale et ne plante pas", () => {
    const p = new Parole(undefined, undefined);
    expect(p.disponible).toBe(false);
    expect(() => {
      p.parler("x");
      p.taire();
    }).not.toThrow();
  });
});

type Rappel = { onTexte: string[][]; onFin: string[]; onErreur: string[] };

class FausseReconnaissance {
  lang = "";
  interimResults = false;
  continuous = true;
  maxAlternatives = 0;
  demarree = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  starts = 0;
  start() {
    this.demarree = true;
    this.starts++;
  }
  stop() {
    this.demarree = false;
    this.onend?.();
  }
  entendre(morceaux: string[], final: boolean) {
    const results = morceaux.map((transcript, i) => Object.assign([{ transcript }], { isFinal: final && i === morceaux.length - 1 }));
    this.onresult?.({ results });
  }
}

function dictee() {
  let reco!: FausseReconnaissance;
  const Ctor = class extends FausseReconnaissance {
    constructor() {
      super();
      reco = this;
    }
  };
  const rappels: Rappel = { onTexte: [], onFin: [], onErreur: [] };
  const d = new Dictee(Ctor);
  const demarrer = () =>
    d.demarrer({
      onTexte: (t, final) => rappels.onTexte.push([t, String(final)]),
      onFin: (t) => rappels.onFin.push(t),
      onErreur: (m) => rappels.onErreur.push(m),
    });
  return { d, demarrer, reco: () => reco, rappels };
}

describe("Dictee", () => {
  it("écoute en français, en direct, sans continuer après une pause", () => {
    const { demarrer, reco } = dictee();
    demarrer();
    expect(reco()).toMatchObject({ lang: "fr-FR", interimResults: true, continuous: false, demarree: true });
  });

  it("transmet le texte au fur et à mesure puis le texte final à la fin", () => {
    const { d, demarrer, reco, rappels } = dictee();
    demarrer();
    expect(d.ecoute).toBe(true);
    reco().entendre(["compare trois"], false);
    reco().entendre(["compare trois", "mutuelles"], true);
    reco().stop();
    expect(rappels.onTexte).toEqual([
      ["compare trois", "false"],
      ["compare trois mutuelles", "true"],
    ]);
    expect(rappels.onFin).toEqual(["compare trois mutuelles"]);
    expect(d.ecoute).toBe(false);
  });

  it("ne garde pas un texte qui n'est pas terminé comme texte final", () => {
    const { demarrer, reco, rappels } = dictee();
    demarrer();
    reco().entendre(["compare"], false);
    reco().stop();
    expect(rappels.onFin).toEqual([""]);
  });

  it("explique un micro bloqué et ne finit pas avec du texte", () => {
    const { demarrer, reco, rappels } = dictee();
    demarrer();
    reco().onerror?.({ error: "not-allowed" });
    reco().stop();
    expect(rappels.onErreur[0]).toMatch(/micro.*Autorise/s);
    expect(rappels.onFin).toEqual([""]);
  });

  it("ne dit rien quand tu arrêtes toi-même", () => {
    const { d, demarrer, reco, rappels } = dictee();
    demarrer();
    d.arreter();
    expect(reco().demarree).toBe(false);
    reco().onerror?.({ error: "aborted" });
    expect(rappels.onErreur).toEqual([]);
  });

  it("ignore un deuxième démarrage pendant l'écoute", () => {
    const { demarrer, reco } = dictee();
    demarrer();
    demarrer();
    expect(reco().starts).toBe(1);
  });

  it("n'est pas disponible sans reconnaissance vocale (Firefox)", () => {
    const d = new Dictee(undefined);
    expect(d.disponible).toBe(false);
    expect(() => d.demarrer({ onTexte() {}, onFin() {}, onErreur() {} })).not.toThrow();
  });
});
