import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ReveilMac, VOLUMES, texteInsistance } from "../server/max/reveil-mac.ts";

const local = (j: string, h: string) => new Date(`${j}T${h}:00`);

function creer(o: { musique?: boolean; verrouille?: boolean; mixOk?: boolean } = {}) {
  const journal: string[] = [];
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-reveil-mac-"));
  const r = new ReveilMac({
    mac: {
      volume: async (n) => void journal.push(`volume ${n}`),
      lireVolume: async () => 35,
    },
    musique: {
      disponible: o.musique ?? true,
      mixerReveil: async (_v, _d, sortie) => (o.mixOk === false ? null : (fs.writeFileSync(sortie, "mp3"), sortie)),
      jouerFichier: (f) => (journal.push(`joue ${path.basename(f)}`), true),
      arreterLecture: () => void journal.push("stop musique"),
    },
    bouche: {
      enregistrer: async (_t, f) => (fs.writeFileSync(f, "wav"), true),
      dire: (t) => void journal.push(`dit ${t.slice(0, 20)}`),
      taire: () => void journal.push("tais-toi"),
    },
    premierMessage: () => "Debout Johan ! C'est Max.",
    verrou: { verrouille: !!o.verrouille, demander: () => void journal.push("caméra") },
    ecouter: () => void journal.push("écoute"),
    ouvrirPage: () => void journal.push("page"),
    prenom: () => "Johan",
    dossier,
    maintenant: () => local("2026-10-27", "07:04"),
  });
  return { r, journal };
}

describe("réveil sur le Mac", () => {
  it("monte le volume à chaque tentative et joue la voix de Max sur la musique", async () => {
    const { r, journal } = creer();
    await r.sonner({ essai: 1, heure: local("2026-10-27", "07:00"), test: false });
    expect(journal).toEqual(["page", "écoute", `volume ${VOLUMES[0]}`, "joue reveil-mac-1.mp3"]);
    journal.length = 0;
    await r.sonner({ essai: 9, heure: local("2026-10-27", "07:00"), test: false });
    expect(journal).toEqual(["écoute", "volume 100", "joue reveil-mac-2.mp3"]); // la page n'est ouverte qu'une fois
  });

  it("allume la caméra quand Max est verrouillé, et parle seul sans musique", async () => {
    const { r, journal } = creer({ verrouille: true, musique: false });
    await r.sonner({ essai: 2, heure: local("2026-10-27", "07:00"), test: false });
    expect(journal[1]).toBe("caméra");
    expect(journal.at(-1)).toMatch(/^dit /);
  });

  it("parle seul si le mixage rate, et remet le volume d'avant quand c'est fini", async () => {
    const { r, journal } = creer({ mixOk: false });
    await r.sonner({ essai: 1, heure: local("2026-10-27", "07:00"), test: false });
    expect(journal.at(-1)).toMatch(/^dit Debout Johan/);
    await r.arreter();
    expect(journal.slice(-3)).toEqual(["stop musique", "tais-toi", "volume 35"]);
    journal.length = 0;
    await r.arreter();
    expect(journal).toEqual([]); // déjà arrêté
  });

  it("insiste de plus en plus, et dit comment l'arrêter", () => {
    const t = texteInsistance({ essai: 3, heure: local("2026-10-27", "07:00"), maintenant: local("2026-10-27", "07:04"), verrouille: false, prenom: "Johan" });
    expect(t).toContain("ça fait 4 minutes");
    expect(t).toContain("« Max, je suis réveillé »");
    expect(texteInsistance({ essai: 2, heure: local("2026-10-27", "07:00"), maintenant: local("2026-10-27", "07:02"), verrouille: true })).toContain("Regarde la caméra");
  });
});

describe("réveil sur le Mac : la voix est lente (XTTS)", () => {
  function lent(voixMs: number, delaiVoixMs: number) {
    const evts: string[] = [];
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-reveil-lent-"));
    const r = new ReveilMac({
      mac: { volume: async () => {}, lireVolume: async () => 35 },
      musique: {
        disponible: true,
        jouerAmorce: async () => (evts.push("amorce"), true),
        mixerReveil: async (_v, _d, sortie) => (fs.writeFileSync(sortie, "mp3"), sortie),
        jouerFichier: (f) => (evts.push(`joue ${path.basename(f)}`), true),
        arreterLecture: () => void evts.push("stop"),
      },
      bouche: {
        enregistrer: (_t, f) => new Promise((res) => setTimeout(() => (fs.writeFileSync(f, "wav"), res(true)), voixMs)),
        dire: (t) => void evts.push(`dit ${t.slice(0, 5)}`),
        taire: () => {},
      },
      premierMessage: () => "Debout !",
      verrou: null,
      ecouter: () => {},
      ouvrirPage: () => {},
      prenom: () => "",
      dossier,
      delaiVoixMs,
      journal: (m) => void evts.push(`journal: ${m.slice(0, 30)}`),
    });
    return { r, evts };
  }

  it("la musique démarre tout de suite, puis la voix mêlée à la musique la remplace", async () => {
    const { r, evts } = lent(30, 1000);
    await r.sonner({ essai: 1, heure: new Date(), test: false });
    expect(evts).toEqual(["amorce", "joue reveil-mac-1.mp3"]);
  });

  it("si la voix est trop lente, la musique joue quand même et Max parle en direct", async () => {
    const { r, evts } = lent(500, 40);
    await r.sonner({ essai: 1, heure: new Date(), test: false });
    expect(evts[0]).toBe("amorce");
    expect(evts[1]).toMatch(/^journal: ⏰ Réveil : la voix n/);
    expect(evts.at(-1)).toMatch(/^dit Debou/);
    expect(evts).not.toContain("stop");
  });
});
