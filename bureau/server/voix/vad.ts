// Détecteur de parole par énergie : découpe le flux du micro en « énoncés » (ce que tu dis entre deux silences).

export const TAUX = 16000;
const TRAME = 480; // 30 ms à 16 kHz
const TRAME_MS = 30;
const SEUIL_DB = 12; // au-dessus du bruit de fond
const PLANCHER_ABSOLU_DB = -50; // en dessous, c'est du silence même dans une pièce très calme
const TRAMES_DEBUT = 3; // 90 ms de son fort pour décider que tu parles
const CALIBRATION = 10; // 300 ms pour apprendre le bruit de fond au démarrage
const AVANT = 10; // 300 ms gardées avant le début de la parole
const NIVEAUX_MEMOIRE = 100; // 3 s de trames calmes pour estimer le bruit de fond

export interface OptionsDetecteur {
  minParoleMs?: number;
  silenceFinMs?: number;
  maxParoleMs?: number;
}

function niveauDb(t: Int16Array): number {
  let somme = 0;
  for (let i = 0; i < t.length; i++) somme += t[i] * t[i];
  return 20 * Math.log10(Math.sqrt(somme / t.length) / 32768 + 1e-12);
}

function coller(parts: Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class DetecteurParole {
  private reste = new Int16Array(0);
  private niveaux: number[] = [];
  private calibration = CALIBRATION;
  private avant: Int16Array[] = [];
  private candidates: Int16Array[] = [];
  private courant: Int16Array[] | null = null;
  private paroleMs = 0;
  private silenceMs = 0;
  private totalMs = 0;
  private minParoleMs: number;
  private silenceFinMs: number;
  private maxParoleMs: number;

  constructor(o: OptionsDetecteur = {}) {
    this.minParoleMs = o.minParoleMs ?? 400;
    this.silenceFinMs = o.silenceFinMs ?? 800;
    this.maxParoleMs = o.maxParoleMs ?? 30_000;
  }

  get enParole(): boolean {
    return this.courant !== null;
  }

  /** Ajoute des échantillons PCM 16 bits mono 16 kHz ; renvoie les énoncés terminés. */
  pousser(pcm: Int16Array): Int16Array[] {
    const tout = this.reste.length ? coller([this.reste, pcm]) : pcm;
    const out: Int16Array[] = [];
    let i = 0;
    for (; i + TRAME <= tout.length; i += TRAME) this.trame(tout.slice(i, i + TRAME), out);
    this.reste = tout.slice(i);
    return out;
  }

  /** Oublie l'énoncé en cours (par exemple quand Max se met à parler). Le bruit de fond appris est gardé. */
  reinitialiser(): void {
    this.reste = new Int16Array(0);
    this.avant = [];
    this.candidates = [];
    this.courant = null;
    this.paroleMs = this.silenceMs = this.totalMs = 0;
  }

  private plancher(): number {
    if (!this.niveaux.length) return -90;
    const tries = [...this.niveaux].sort((a, b) => a - b);
    return tries[Math.floor(tries.length * 0.2)];
  }

  private garderAvant(t: Int16Array): void {
    this.avant.push(t);
    if (this.avant.length > AVANT) this.avant.shift();
  }

  private memoriserNiveau(db: number): void {
    this.niveaux.push(db);
    if (this.niveaux.length > NIVEAUX_MEMOIRE) this.niveaux.shift();
  }

  private trame(t: Int16Array, out: Int16Array[]): void {
    const db = niveauDb(t);
    if (this.calibration > 0) {
      this.calibration--;
      this.memoriserNiveau(db);
      this.garderAvant(t);
      return;
    }
    const fort = db > Math.max(this.plancher() + SEUIL_DB, PLANCHER_ABSOLU_DB);

    if (!this.courant) {
      if (fort) {
        this.candidates.push(t);
        if (this.candidates.length >= TRAMES_DEBUT) {
          this.courant = [...this.avant, ...this.candidates];
          this.totalMs = this.courant.length * TRAME_MS;
          this.paroleMs = this.candidates.length * TRAME_MS;
          this.silenceMs = 0;
          this.avant = [];
          this.candidates = [];
        }
      } else {
        for (const c of this.candidates) this.garderAvant(c);
        this.candidates = [];
        this.garderAvant(t);
        this.memoriserNiveau(db);
      }
      return;
    }

    this.courant.push(t);
    this.totalMs += TRAME_MS;
    if (fort) {
      this.paroleMs += TRAME_MS;
      this.silenceMs = 0;
    } else {
      this.silenceMs += TRAME_MS;
    }
    if (this.silenceMs >= this.silenceFinMs || this.totalMs >= this.maxParoleMs) {
      const fini = this.courant;
      const assezLong = this.paroleMs >= this.minParoleMs;
      this.courant = null;
      this.paroleMs = this.silenceMs = this.totalMs = 0;
      if (assezLong) out.push(coller(fini));
    }
  }
}
