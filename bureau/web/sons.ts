// Les sons de l'interface, fabriqués à la volée (WebAudio, aucun fichier) : discrets, courts, dans les aigus,
// pour que tout réagisse sous les doigts sans couvrir la voix de Max. Le bouton 🔈 les coupe.
export type Son = "ouvre" | "ferme" | "mail" | "salut" | "deverrouille" | "clic" | "systeme" | "quete";

const PREF = "max-sons";
let ctx: AudioContext | null = null;
let actifs = (() => {
  try {
    return localStorage.getItem(PREF) !== "non";
  } catch {
    return true;
  }
})();

export const sonsActifs = () => actifs;

export function basculerSons(): boolean {
  actifs = !actifs;
  try {
    localStorage.setItem(PREF, actifs ? "oui" : "non");
  } catch {
    // navigation privée
  }
  return actifs;
}

/** Les notes de chaque son : [fréquence de départ, fréquence d'arrivée, début (s), durée (s), forme, volume]. */
export const PARTITIONS: Record<Son, [number, number, number, number, OscillatorType, number][]> = {
  clic: [[2400, 1800, 0, 0.04, "sine", 0.5]],
  ouvre: [
    [520, 1040, 0, 0.18, "sine", 0.7],
    [1560, 2080, 0.05, 0.14, "triangle", 0.25],
  ],
  ferme: [[900, 420, 0, 0.16, "sine", 0.6]],
  mail: [
    [1320, 1320, 0, 0.09, "sine", 0.6],
    [1760, 1760, 0.1, 0.16, "sine", 0.5],
  ],
  salut: [
    [440, 440, 0, 0.5, "sine", 0.35],
    [660, 660, 0.08, 0.5, "sine", 0.3],
    [880, 990, 0.16, 0.6, "triangle", 0.25],
  ],
  // la notification du Système : deux notes cristallines, claires, qui résonnent
  systeme: [
    [1568, 1568, 0, 0.55, "sine", 0.5],
    [2093, 2093, 0.11, 0.66, "sine", 0.45],
    [3136, 3136, 0.11, 0.35, "triangle", 0.08],
  ],
  // une quête reçue (ou accomplie) : une petite montée
  quete: [
    [880, 880, 0, 0.12, "sine", 0.45],
    [1175, 1175, 0.09, 0.12, "sine", 0.45],
    [1760, 1760, 0.18, 0.45, "sine", 0.45],
  ],
  deverrouille: [
    [392, 784, 0, 0.22, "sine", 0.6],
    [988, 1318, 0.12, 0.3, "triangle", 0.35],
  ],
};

export function son(nom: Son, volume = 0.06): void {
  if (!actifs) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t0 = ctx.currentTime + 0.01;
    const sortie = ctx.createGain();
    sortie.gain.value = volume;
    sortie.connect(ctx.destination);
    for (const [f0, f1, debut, duree, forme, v] of PARTITIONS[nom]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = forme;
      o.frequency.setValueAtTime(f0, t0 + debut);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + debut + duree);
      g.gain.setValueAtTime(0, t0 + debut);
      g.gain.linearRampToValueAtTime(v, t0 + debut + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + debut + duree);
      o.connect(g).connect(sortie);
      o.start(t0 + debut);
      o.stop(t0 + debut + duree + 0.02);
    }
  } catch {
    // pas de son possible (navigateur, autorisation) : tant pis, rien ne casse
  }
}

let bruitBlanc: AudioBuffer | null = null;

/**
 * Le tonnerre et le grondement de Max Ultime : un bruit filtré très grave (le roulement) et une basse qui descend.
 * Plus fort que les petits sons d'interface, mais court ; coupé avec eux (🔈).
 */
export function tonnerre(force = 1, volume = 0.22): void {
  if (!actifs) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const c = ctx;
    if (!bruitBlanc) {
      bruitBlanc = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
      const d = bruitBlanc.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + 0.01;
    const sortie = c.createGain();
    sortie.gain.value = volume * force;
    sortie.connect(c.destination);
    // le roulement
    const src = c.createBufferSource();
    src.buffer = bruitBlanc;
    const filtre = c.createBiquadFilter();
    filtre.type = "lowpass";
    filtre.frequency.setValueAtTime(900, t0);
    filtre.frequency.exponentialRampToValueAtTime(120, t0 + 2.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(1, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    src.connect(filtre).connect(g).connect(sortie);
    src.start(t0);
    src.stop(t0 + 2.7);
    // la basse qui gronde
    const o = c.createOscillator();
    const go = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t0);
    o.frequency.exponentialRampToValueAtTime(32, t0 + 1.8);
    go.gain.setValueAtTime(0, t0);
    go.gain.linearRampToValueAtTime(0.5, t0 + 0.05);
    go.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.9);
    const fo = c.createBiquadFilter();
    fo.type = "lowpass";
    fo.frequency.value = 260;
    o.connect(fo).connect(go).connect(sortie);
    o.start(t0);
    o.stop(t0 + 2);
  } catch {
    // pas de son : tant pis
  }
}

/**
 * La bande-son de l'œil de code (environ 4,4 s, calée sur l'animation) : un bourdonnement grave qui monte, des
 * crépitements de données, trois battements de cœur, les bips du scan qui accélèrent, et le souffle de la plongée.
 * Discrète (la musique joue en même temps), coupée avec les autres sons (🔈).
 */
export function bandeSonOeil(battements: number[], volume = 0.16): void {
  if (!actifs) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const c = ctx;
    if (!bruitBlanc) {
      bruitBlanc = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
      const d = bruitBlanc.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = c.currentTime + 0.02;
    const sortie = c.createGain();
    sortie.gain.value = volume;
    sortie.connect(c.destination);
    const note = (f0: number, f1: number, debut: number, duree: number, forme: OscillatorType, v: number, filtre?: number) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = forme;
      o.frequency.setValueAtTime(f0, t0 + debut);
      o.frequency.exponentialRampToValueAtTime(f1, t0 + debut + duree);
      g.gain.setValueAtTime(0, t0 + debut);
      g.gain.linearRampToValueAtTime(v, t0 + debut + Math.min(0.02, duree / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + debut + duree);
      let n: AudioNode = o;
      if (filtre) {
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = filtre;
        n = o.connect(f);
      }
      n.connect(g).connect(sortie);
      o.start(t0 + debut);
      o.stop(t0 + debut + duree + 0.02);
    };
    // le bourdonnement : deux scies graves, légèrement désaccordées, dont le filtre s'ouvre peu à peu
    const filtreDrone = c.createBiquadFilter();
    filtreDrone.type = "lowpass";
    filtreDrone.frequency.setValueAtTime(180, t0);
    filtreDrone.frequency.exponentialRampToValueAtTime(900, t0 + 3.3);
    const gd = c.createGain();
    gd.gain.setValueAtTime(0, t0);
    gd.gain.linearRampToValueAtTime(0.5, t0 + 0.8);
    gd.gain.setValueAtTime(0.5, t0 + 3.3);
    gd.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.3);
    filtreDrone.connect(gd).connect(sortie);
    for (const f of [55, 55.6, 110.3]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f, t0);
      o.frequency.linearRampToValueAtTime(f * 1.06, t0 + 3.3);
      o.connect(filtreDrone);
      o.start(t0);
      o.stop(t0 + 4.4);
    }
    // les crépitements de données au démarrage
    for (let k = 0; k < 16; k++) {
      const f = 1800 + Math.random() * 2600;
      note(f, f, 0.05 + k * 0.05 + Math.random() * 0.03, 0.03, "square", 0.08);
    }
    // les battements de cœur (double coup, très grave)
    for (const t of battements) {
      note(75, 38, t, 0.22, "sine", 1);
      note(68, 36, t + 0.2, 0.2, "sine", 0.6);
    }
    // les bips du scan, de plus en plus serrés et aigus
    let t = 1.9;
    let i = 0;
    while (t < 3.2) {
      note(1400 + i * 45, 1400 + i * 45, t, 0.05, "triangle", 0.22);
      t += Math.max(0.06, 0.2 - i * 0.012);
      i++;
    }
    // la plongée : un souffle qui monte, et une basse qui tombe
    const src = c.createBufferSource();
    src.buffer = bruitBlanc;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t0 + 3.4);
    bp.frequency.exponentialRampToValueAtTime(5000, t0 + 4.3);
    const gw = c.createGain();
    gw.gain.setValueAtTime(0, t0 + 3.4);
    gw.gain.linearRampToValueAtTime(0.7, t0 + 4.15);
    gw.gain.exponentialRampToValueAtTime(0.0001, t0 + 4.45);
    src.connect(bp).connect(gw).connect(sortie);
    src.start(t0 + 3.4);
    src.stop(t0 + 4.5);
    note(110, 30, 3.45, 0.9, "sine", 0.8);
  } catch {
    // pas de son : tant pis
  }
}
