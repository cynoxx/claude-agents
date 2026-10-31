import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Mac, expliquerErreur, lireContacts, lireAgendaIcal, type Executer } from "../server/max/mac.ts";

interface Appel {
  bin: string;
  args: string[];
}

/** Faux exécuteur : note les appels et répond selon la commande. */
function fauxExecuteur(reponses: (a: Appel) => { code?: number; stdout?: string; stderr?: string } | undefined = () => undefined) {
  const appels: Appel[] = [];
  const executer: Executer = async (bin, args) => {
    const a = { bin, args };
    appels.push(a);
    const r = reponses(a) ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { appels, executer };
}

const script = (a: Appel) => a.args.filter((_, i) => a.args[i - 1] === "-e").join("\n");
const argv = (a: Appel) => a.args.slice(a.args.lastIndexOf("-e") + 2);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "bureau-mac-"));

describe("Mac — hors Mac", () => {
  it("refuse poliment quand il n'est pas sur un Mac", async () => {
    const { appels, executer } = fauxExecuteur();
    const mac = new Mac({ actif: false, executer, dossierCaptures: tmp() });
    const r = await mac.ouvrirApp("Safari");
    expect(r.ok).toBe(false);
    expect(r.texte).toContain("Mac");
    expect(appels).toEqual([]);
  });
});

describe("Mac — apps, sites, réglages", () => {
  let f: ReturnType<typeof fauxExecuteur>;
  let mac: Mac;
  let captures: string;
  beforeEach(() => {
    f = fauxExecuteur();
    captures = tmp();
    mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: captures, maintenant: () => new Date("2026-10-26T14:32:05") });
  });

  it("ouvre une app avec open -a, sans shell", async () => {
    expect((await mac.ouvrirApp("Visual Studio Code")).ok).toBe(true);
    expect(f.appels[0]).toEqual({ bin: "open", args: ["-a", "Visual Studio Code"] });
  });

  it("refuse un nom d'app bizarre", async () => {
    expect((await mac.ouvrirApp("Safari; rm -rf ~")).ok).toBe(false);
    expect((await mac.ouvrirApp("")).ok).toBe(false);
    expect(f.appels).toEqual([]);
  });

  it("dit quand une app n'existe pas", async () => {
    f = fauxExecuteur(() => ({ code: 1, stderr: "Unable to find application named 'Spotifi'" }));
    mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: captures });
    const r = await mac.ouvrirApp("Spotifi");
    expect(r.ok).toBe(false);
    expect(r.texte).toContain("Spotifi");
  });

  it("ferme une app en passant son nom en argument du script (jamais dans le script)", async () => {
    await mac.fermerApp('Safari" to quit\ndo shell script "x');
    expect(f.appels).toEqual([]);
    await mac.fermerApp("Safari");
    expect(f.appels[0].bin).toBe("osascript");
    expect(script(f.appels[0])).toContain("tell application (item 1 of argv) to quit");
    expect(argv(f.appels[0])).toEqual(["Safari"]);
  });

  it("n'ouvre que des adresses web", async () => {
    expect((await mac.ouvrirSite("https://www.doctolib.fr")).ok).toBe(true);
    expect(f.appels[0]).toEqual({ bin: "open", args: ["https://www.doctolib.fr/"] });
    expect((await mac.ouvrirSite("file:///etc/passwd")).ok).toBe(false);
    expect((await mac.ouvrirSite("javascript:alert(1)")).ok).toBe(false);
    expect(f.appels).toHaveLength(1);
  });

  it("cherche sur YouTube", async () => {
    await mac.chercherYoutube("cours anatomie crâne");
    expect(f.appels[0].args[0]).toBe("https://www.youtube.com/results?search_query=cours%20anatomie%20cr%C3%A2ne");
  });

  it("règle le volume (niveau, plus, moins, muet)", async () => {
    await mac.volume("40");
    expect(argv(f.appels[0])).toEqual(["40"]);
    await mac.volume("plus");
    expect(argv(f.appels[1])).toEqual(["plus"]);
    await mac.volume("muet");
    expect(argv(f.appels[2])).toEqual(["muet"]);
    expect((await mac.volume("150")).ok).toBe(false);
    expect((await mac.volume("fort")).ok).toBe(false);
  });

  it("monte ou baisse la luminosité par crans", async () => {
    await mac.luminosite("moins", 3);
    expect(script(f.appels[0])).toContain("key code");
    expect(argv(f.appels[0])).toEqual(["moins", "3"]);
    expect((await mac.luminosite("plus", 50)).ok).toBe(false);
  });

  it("fait une capture d'écran datée dans le dossier des captures", async () => {
    const r = await mac.capture();
    expect(f.appels[0]).toEqual({ bin: "screencapture", args: ["-x", path.join(captures, "Capture Max 2026-10-26 14h32m05.png")] });
    expect(r.texte).toContain("Capture Max 2026-10-26 14h32m05.png");
  });

  it("verrouille l'écran", async () => {
    await mac.verrouiller();
    expect(f.appels[0]).toEqual({ bin: "pmset", args: ["displaysleepnow"] });
  });
});

describe("Mac — musique", () => {
  it("pilote Spotify s'il est installé, sinon Musique", async () => {
    const f = fauxExecuteur((a) => (a.bin === "open" && a.args.includes("-Ra") ? { code: 0 } : { stdout: "Lofi Girl — beats" }));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp() });
    const r = await mac.musique("pause");
    expect(r.ok).toBe(true);
    expect(script(f.appels.at(-1)!)).toContain('tell application "Spotify"');

    const g = fauxExecuteur((a) => (a.bin === "open" && a.args.includes("-Ra") ? { code: 1 } : { stdout: "" }));
    const mac2 = new Mac({ actif: true, executer: g.executer, dossierCaptures: tmp() });
    await mac2.musique("suivant");
    expect(script(g.appels.at(-1)!)).toContain('tell application "Music"');
  });

  it("respecte l'app choisie dans la config et dit ce qui joue", async () => {
    const f = fauxExecuteur(() => ({ stdout: "Clair de lune — Debussy" }));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp(), musique: "musique" });
    const r = await mac.musique("quoi");
    expect(f.appels).toHaveLength(1);
    expect(r.texte).toContain("Clair de lune — Debussy");
  });

  it("cherche une musique : Spotify ouvre la recherche, Musique joue ce qu'il trouve", async () => {
    const f = fauxExecuteur((a) => (a.bin === "open" && a.args.includes("-Ra") ? { code: 0 } : {}));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp() });
    await mac.musique("jouer", "lofi hip hop");
    expect(f.appels.at(-1)!.args).toEqual(["spotify:search:lofi%20hip%20hop"]);

    const g = fauxExecuteur(() => ({ stdout: "Lofi Study — Chill" }));
    const mac2 = new Mac({ actif: true, executer: g.executer, dossierCaptures: tmp(), musique: "musique" });
    const r = await mac2.musique("jouer", "lofi");
    expect(argv(g.appels[0])).toEqual(["lofi"]);
    expect(r.texte).toContain("Lofi Study — Chill");
  });
});

describe("Mac — contacts et iMessage", () => {
  it("lit la sortie des Contacts (libellés Apple nettoyés)", () => {
    expect(lireContacts("Maman\t+33 6 12 34 56 78\t_$!<Mobile>!$_\nMaman\tmaman@icloud.com\temail\n\n")).toEqual([
      { nom: "Maman", valeur: "+33 6 12 34 56 78", type: "Mobile" },
      { nom: "Maman", valeur: "maman@icloud.com", type: "email" },
    ]);
  });

  it("cherche un contact par son nom (en argument du script)", async () => {
    const f = fauxExecuteur(() => ({ stdout: "Maman\t+33 6 12 34 56 78\t_$!<Mobile>!$_\n" }));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp() });
    const r = await mac.chercherContact("maman");
    expect(argv(f.appels[0])).toEqual(["maman"]);
    expect(r.contacts).toEqual([{ nom: "Maman", valeur: "+33 6 12 34 56 78", type: "Mobile" }]);
  });

  it("envoie un iMessage, destinataire et texte en arguments", async () => {
    const f = fauxExecuteur();
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp() });
    const r = await mac.envoyerIMessage("+33612345678", 'Je rentre à 20 h "promis"');
    expect(r.ok).toBe(true);
    expect(script(f.appels[0])).toContain('tell application "Messages"');
    expect(argv(f.appels[0])).toEqual(["+33612345678", 'Je rentre à 20 h "promis"']);
  });
});

describe("Mac — mails, agenda, météo", () => {
  it("lit les derniers mails", async () => {
    const f = fauxExecuteur(() => ({ stdout: "---\nDe : Fac <scol@univ.fr>\nSujet : Planning\n" }));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp() });
    const r = await mac.lireMails(5, true);
    expect(argv(f.appels[0])).toEqual(["5", "1"]);
    expect(r.texte).toContain("Sujet : Planning");
  });

  it("dit quand il n'y a aucun mail", async () => {
    const f = fauxExecuteur(() => ({ stdout: "" }));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp() });
    expect((await mac.lireMails(5, true)).texte).toContain("Aucun mail");
  });

  it("lit la sortie d'icalBuddy pour un jour donné", () => {
    const sortie = "Anatomie (amphi A)\t2026-10-27 at 08:30\nBiochimie\t2026-10-27 at 14:00\nAnniversaire Léa\t2026-10-27\nSport\t2026-10-28 at 18:00\n";
    expect(lireAgendaIcal(sortie, "2026-10-27")).toEqual([
      { heure: "", titre: "Anniversaire Léa" },
      { heure: "08:30", titre: "Anatomie (amphi A)" },
      { heure: "14:00", titre: "Biochimie" },
    ]);
  });

  it("lit l'agenda avec icalBuddy (événements répétés compris), sinon avec Calendrier", async () => {
    const f = fauxExecuteur((a) => (a.bin === "icalBuddy" ? { stdout: "Anatomie\t2026-10-27 at 08:30\n" } : {}));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp(), maintenant: () => new Date("2026-10-26T22:00:00") });
    const r = await mac.agenda("demain");
    expect(f.appels[0].bin).toBe("icalBuddy");
    expect(f.appels[0].args.at(-2)).toBe("eventsFrom:2026-10-27");
    expect(r.texte).toContain("08:30 Anatomie");
    expect(r.evenements).toEqual([{ heure: "08:30", titre: "Anatomie" }]);

    const g = fauxExecuteur((a) => (a.bin === "icalBuddy" ? { code: 127, stderr: "introuvable" } : { stdout: "9\t0\tPartiel blanc\n" }));
    const mac2 = new Mac({ actif: true, executer: g.executer, dossierCaptures: tmp(), maintenant: () => new Date("2026-10-26T22:00:00") });
    const r2 = await mac2.agenda("2026-11-03");
    expect(g.appels[1].bin).toBe("osascript");
    expect(argv(g.appels[1])).toEqual(["2026", "11", "3"]);
    expect(r2.evenements).toEqual([{ heure: "09:00", titre: "Partiel blanc" }]);
  });

  it("dit quand la journée est libre", async () => {
    const f = fauxExecuteur(() => ({ stdout: "" }));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp(), maintenant: () => new Date("2026-10-26T10:00:00") });
    expect((await mac.agenda("aujourdhui")).texte).toContain("Rien dans l'agenda");
    expect((await mac.agenda("la semaine des quatre jeudis")).ok).toBe(false);
  });

  it("crée un rendez-vous (date, heure, durée et titre en arguments)", async () => {
    const f = fauxExecuteur(() => ({ stdout: "Google" }));
    const mac = new Mac({ actif: true, executer: f.executer, dossierCaptures: tmp() });
    const r = await mac.creerRdv({ titre: "Dentiste", date: "2026-11-04", heure: "17:30", minutes: 45 });
    expect(argv(f.appels[0])).toEqual(["2026", "11", "4", "1050", "45", "Dentiste", ""]);
    expect(r.texte).toContain("Google");
  });

  it("donne la météo depuis wttr.in", async () => {
    const reponse = {
      current_condition: [{ temp_C: "12", FeelsLikeC: "10", lang_fr: [{ value: "Nuageux" }] }],
      weather: [{ maxtempC: "15", mintempC: "8" }],
      nearest_area: [{ areaName: [{ value: "Lyon" }] }],
    };
    const urls: string[] = [];
    const mac = new Mac({
      actif: true,
      executer: fauxExecuteur().executer,
      dossierCaptures: tmp(),
      ville: "Lyon",
      fetch: (async (u: string) => {
        urls.push(u);
        return new Response(JSON.stringify(reponse));
      }) as typeof fetch,
    });
    const r = await mac.meteo();
    expect(urls[0]).toBe("https://wttr.in/Lyon?format=j1&lang=fr");
    expect(r.texte).toBe("Lyon : 12 degrés, nuageux (ressenti 10). Aujourd'hui entre 8 et 15 degrés.");
    expect(r.court).toBe("12° · Nuageux");
  });
});

describe("Mac — erreurs expliquées", () => {
  it("traduit les refus d'autorisation de macOS", () => {
    expect(expliquerErreur("execution error: Not authorized to send Apple events to Messages. (-1743)")).toContain("Automatisation");
    expect(expliquerErreur("System Events got an error: osascript is not allowed assistive access. (-1719)")).toContain("Accessibilité");
    expect(expliquerErreur("boom")).toContain("boom");
  });
});
