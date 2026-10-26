import { describe, it, expect } from "vitest";
import { DetecteurParole } from "../server/voix/vad.ts";
import { encoderWav } from "../server/voix/wav.ts";
import { estHallucination, reconnaitreAppel } from "../server/voix/mot-cle.ts";
import { choisirMicro, listerMicros } from "../server/voix/micro.ts";
import { lireSortieWhisper } from "../server/voix/whisper.ts";

const TAUX = 16000;
const ms = (n: number) => Math.round((TAUX * n) / 1000);

/** Bruit de fond (≈ −50 dBFS) ou « voix » (sinus fort ≈ −12 dBFS), en PCM 16 bits. */
function signal(dureeMs: number, type: "silence" | "voix" | "ventilo"): Int16Array {
  const n = ms(dureeMs);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const bruit = (Math.random() * 2 - 1) * (type === "ventilo" ? 600 : 100);
    out[i] = type === "voix" ? Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / TAUX) + bruit) : Math.round(bruit);
  }
  return out;
}
const concat = (...parts: Int16Array[]) => {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
function enMorceaux(pcm: Int16Array, tailles: number[]): Int16Array[] {
  const out: Int16Array[] = [];
  let i = 0;
  let k = 0;
  while (i < pcm.length) {
    const t = tailles[k++ % tailles.length];
    out.push(pcm.subarray(i, i + t));
    i += t;
  }
  return out;
}

describe("DetecteurParole", () => {
  it("ne détecte rien dans le silence", () => {
    const d = new DetecteurParole();
    expect(d.pousser(signal(3000, "silence"))).toEqual([]);
  });

  it("découpe une phrase entourée de silence, avec un peu d'avant et la fin", () => {
    const d = new DetecteurParole();
    const enonces = d.pousser(concat(signal(500, "silence"), signal(1000, "voix"), signal(1200, "silence")));
    expect(enonces).toHaveLength(1);
    const duree = (enonces[0].length / TAUX) * 1000;
    expect(duree).toBeGreaterThan(1000);
    expect(duree).toBeLessThan(1000 + 300 + 800 + 100);
  });

  it("ignore un bruit bref (moins de 400 ms)", () => {
    const d = new DetecteurParole();
    expect(d.pousser(concat(signal(500, "silence"), signal(150, "voix"), signal(1200, "silence")))).toEqual([]);
  });

  it("coupe une parole qui dure plus de 30 secondes", () => {
    const d = new DetecteurParole();
    const enonces = d.pousser(concat(signal(300, "silence"), signal(31000, "voix")));
    expect(enonces).toHaveLength(1);
    expect(enonces[0].length / TAUX).toBeLessThanOrEqual(30.5);
  });

  it("donne le même résultat quel que soit le découpage du flux", () => {
    const pcm = concat(signal(500, "silence"), signal(1000, "voix"), signal(1200, "silence"), signal(800, "voix"), signal(1200, "silence"));
    const d = new DetecteurParole();
    const enonces = enMorceaux(pcm, [1, 7, 333, 4096, 480, 12345]).flatMap((m) => d.pousser(m));
    expect(enonces).toHaveLength(2);
  });

  it("s'habitue à un bruit de fond constant (ventilateur) mais entend la voix par-dessus", () => {
    const d = new DetecteurParole();
    expect(d.pousser(signal(3000, "ventilo"))).toEqual([]);
    expect(d.pousser(concat(signal(1000, "voix"), signal(1200, "ventilo")))).toHaveLength(1);
  });

  it("oublie ce qu'il avait commencé à entendre quand on le réinitialise", () => {
    const d = new DetecteurParole();
    d.pousser(concat(signal(300, "silence"), signal(800, "voix")));
    expect(d.enParole).toBe(true);
    d.reinitialiser();
    expect(d.enParole).toBe(false);
    expect(d.pousser(signal(1200, "silence"))).toEqual([]);
  });
});

describe("encoderWav", () => {
  it("écrit un en-tête WAV PCM 16 bits mono 16 kHz", () => {
    const wav = encoderWav(new Int16Array([0, 1, -1, 32767]));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 8);
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(32000);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(8);
    expect(wav.readInt16LE(44 + 6)).toBe(32767);
  });
});

describe("reconnaitreAppel", () => {
  it("reconnaît « Max » au début et garde le reste tel quel", () => {
    expect(reconnaitreAppel("Max, quelle est la capitale de l'Italie ?")).toBe("quelle est la capitale de l'Italie ?");
  });
  it("accepte une petite formule avant son nom", () => {
    expect(reconnaitreAppel("Dis Max, lance une mission")).toBe("lance une mission");
    expect(reconnaitreAppel("Hé Maxe : tu m'entends ?")).toBe("tu m'entends ?");
    expect(reconnaitreAppel("Bonjour Max.")).toBe("");
  });
  it("renvoie une chaîne vide quand on l'appelle sans rien dire d'autre", () => {
    expect(reconnaitreAppel("Ok Max")).toBe("");
  });
  it("reconnaît son nom à la fin de la phrase", () => {
    expect(reconnaitreAppel("C'est quoi la météo, Max ?")).toBe("C'est quoi la météo ?");
  });
  it("ignore les phrases qui ne lui sont pas adressées", () => {
    expect(reconnaitreAppel("Je parlais à Maxime hier")).toBeNull();
    expect(reconnaitreAppel("La télé est trop forte")).toBeNull();
    expect(reconnaitreAppel("Il a dit que Max était là")).toBeNull();
  });
  it("prend toute la phrase pendant la fenêtre de suite", () => {
    expect(reconnaitreAppel("et pour Lisbonne ?", "max", true)).toBe("et pour Lisbonne ?");
    expect(reconnaitreAppel("Max, et pour Lisbonne ?", "max", true)).toBe("et pour Lisbonne ?");
  });
  it("accepte un autre mot-clé", () => {
    expect(reconnaitreAppel("Jarvis, bonjour", "jarvis")).toBe("bonjour");
    expect(reconnaitreAppel("Max, bonjour", "jarvis")).toBeNull();
  });
  it("supporte un tiret ou des guillemets ajoutés par Whisper", () => {
    expect(reconnaitreAppel("- Max, ça va ?")).toBe("ça va ?");
    expect(reconnaitreAppel("« Max, ça va ? »")).toBe("ça va ?");
  });
});

describe("estHallucination", () => {
  it("repère le vide et les points de suspension", () => {
    for (const t of ["", "   ", "...", "…", " . . . ", "[BLANK_AUDIO]", "(musique)", "[Musique]", "*bruit*"]) expect(estHallucination(t), t).toBe(true);
  });
  it("repère les phrases que Whisper invente sur le silence", () => {
    expect(estHallucination("Sous-titres réalisés par la communauté d'Amara.org")).toBe(true);
    expect(estHallucination("Merci d'avoir regardé cette vidéo !")).toBe(true);
    expect(estHallucination("Abonnez-vous à la chaîne")).toBe(true);
  });
  it("laisse passer une vraie phrase", () => {
    expect(estHallucination("Max, merci beaucoup")).toBe(false);
    expect(estHallucination("merci")).toBe(false);
  });
});

const LISTE_FFMPEG = `[AVFoundation indev @ 0x7f8] AVFoundation video devices:
[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7f8] [1] Capture screen 0
[AVFoundation indev @ 0x7f8] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8] [0] ZoomAudioDevice
[AVFoundation indev @ 0x7f8] [1] Microphone (iPhone de Johan)
[AVFoundation indev @ 0x7f8] [2] Microphone MacBook Pro
[AVFoundation indev @ 0x7f8] [3] BlackHole 2ch
: Input/output error`;

describe("micros", () => {
  it("liste seulement les micros (pas les caméras)", () => {
    expect(listerMicros(LISTE_FFMPEG)).toEqual([
      { index: 0, nom: "ZoomAudioDevice" },
      { index: 1, nom: "Microphone (iPhone de Johan)" },
      { index: 2, nom: "Microphone MacBook Pro" },
      { index: 3, nom: "BlackHole 2ch" },
    ]);
  });
  it("préfère le micro intégré du Mac aux micros virtuels et à l'iPhone", () => {
    expect(choisirMicro(LISTE_FFMPEG)).toBe(":2");
  });
  it("prend le premier micro réel s'il n'y a pas de micro intégré reconnaissable", () => {
    expect(choisirMicro("AVFoundation audio devices:\n[x] [0] Loopback Audio\n[x] [1] Shure MV7")).toBe(":1");
  });
  it("renvoie null sans micro", () => {
    expect(choisirMicro("AVFoundation video devices:\n[x] [0] FaceTime HD Camera")).toBeNull();
  });
});

describe("lireSortieWhisper", () => {
  it("rassemble les lignes sans espaces en trop", () => {
    expect(lireSortieWhisper("\n Max, quelle est la capitale\n de l'Italie ?\n")).toBe("Max, quelle est la capitale de l'Italie ?");
  });
  it("retire les horodatages si Whisper en met", () => {
    expect(lireSortieWhisper("[00:00:00.000 --> 00:00:02.000]   Max, bonjour.\n")).toBe("Max, bonjour.");
  });
});
