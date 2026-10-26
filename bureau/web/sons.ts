// Les sons de l'interface, fabriqués à la volée (WebAudio, aucun fichier) : discrets, courts, dans les aigus,
// pour que tout réagisse sous les doigts sans couvrir la voix de Max. Le bouton 🔈 les coupe.
export type Son = "ouvre" | "ferme" | "mail" | "salut" | "deverrouille" | "clic";

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
