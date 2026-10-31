// Le réveil : à l'heure prévue (7 h par défaut ; Max la règle avec toi le soir), Max te réveille.
// - Sur le Mac (mode « mac », gratuit) : sa voix sur ta musique, de plus en plus fort, toutes les 2 minutes.
//   Tu l'arrêtes en lui parlant, avec le bouton de la page, ou en te laissant reconnaître par la caméra.
// - Par un appel sur ton téléphone (mode « appel », Twilio payant) : tu décroches et tu écoutes son message ; sinon il
//   rappelle toutes les 5 minutes (4 appels au plus). Mode « les-deux » : le Mac d'abord, l'appel s'il insiste.
// Le Mac doit rester allumé la nuit (le Bureau l'empêche de s'endormir quand il est branché).
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { ReveilVue } from "../../shared/protocol.ts";
import { STATUTS_FINAUX, type EtatAppel } from "./twilio.ts";

const MINUTE = 60_000;
/** Le message est préparé 10 minutes avant l'appel. */
const PREPARATION_MS = 10 * MINUTE;
/** Le Mac est gardé éveillé dans les 10 heures avant l'appel. */
const VEILLE_MS = 10 * 3_600_000;
/** Décroché, en ligne au moins 20 secondes, et pas un répondeur : réveillé. */
const DUREE_REVEILLE_S = 20;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface AppelleurLike {
  appeler(vers: string, twiml: string): Promise<string>;
  etat(sid: string): Promise<EtatAppel>;
}

interface Fichier {
  heure: string;
  /** Pour une date (AAAA-MM-JJ) : une autre heure, ou « aucun » (pas de réveil ce jour-là). */
  exceptions: Record<string, string>;
}

interface Reponse {
  ok: boolean;
  texte: string;
}

/** « 7h », « 07:30 », « 6 h 45 » → « 07:30 », ou null. */
export function lireHeure(t: string): string | null {
  const m = /^\s*(\d{1,2})\s*(?:[:h]\s*(\d{2})?)?\s*$/i.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  return h <= 23 && mi <= 59 ? `${pad(h)}:${pad(mi)}` : null;
}

/** Un appel est-il la preuve qu'il est réveillé ? */
export function estReveille(e: EtatAppel): boolean {
  return e.statut === "completed" && e.duree >= DUREE_REVEILLE_S && !(e.reponduPar ?? "").startsWith("machine") && e.reponduPar !== "fax";
}

export type ModeReveil = "mac" | "appel" | "les-deux";

/** En mode « les-deux », l'appel ne part qu'à la 3e tentative : le Mac a eu 4 minutes pour te réveiller. */
const ESSAI_DU_PREMIER_APPEL = 3;

interface EnCours {
  cible: number;
  essai: number;
  appels: number;
  prochain: number;
  test: boolean;
  message: Promise<string> | null;
}

/**
 * Événements : `etat` ; `preparer` (avant l'appel) ; `sonne` ({ essai, heure, test }) : le Mac doit sonner ;
 * `reveille` ({ parole }) ; `echec` (personne n'a répondu).
 */
export class Reveil extends EventEmitter {
  private tic?: NodeJS.Timeout;
  private enCours: EnCours | null = null;
  private appelEnCours = false;
  private caffeinate: ChildProcess | null = null;
  private preparePour = 0;
  private message: Promise<string> | null = null;

  constructor(
    private o: {
      dossierDonnees: string;
      /** Ton numéro (format international : +33612345678) ; null = réveil pas configuré. */
      telephone: string | null;
      appelleur: AppelleurLike | null;
      heureDefaut: string;
      /** « mac » (gratuit), « appel » (Twilio) ou « les-deux » ; « appel » par défaut. */
      mode?: ModeReveil;
      rappelMinutes: number;
      essais: number;
      /** Sur le Mac : minutes entre deux tentatives (2 par défaut) et nombre de tentatives (10). */
      rappelMacMinutes?: number;
      essaisMac?: number;
      /** Le TwiML de l'appel (préparé : message audio sur la musique, sinon texte lu). */
      preparer: (heure: Date) => Promise<string>;
      /** Garder le Mac éveillé la nuit (`caffeinate`), seulement sur Mac. */
      garderEveille?: boolean;
      attentePoll?: number;
    },
  ) {
    super();
  }

  get mode(): ModeReveil {
    return this.o.mode ?? "appel";
  }

  /** Max te réveille sur le Mac. */
  get macActif(): boolean {
    return this.mode !== "appel";
  }

  /** Max t'appelle sur ton téléphone (il faut ton numéro et Twilio). */
  get appelActif(): boolean {
    return this.mode !== "mac" && !!this.o.telephone && !!this.o.appelleur;
  }

  get configure(): boolean {
    return this.macActif || this.appelActif;
  }

  demarrer(): void {
    this.tic = setInterval(() => void this.verifier(), 15_000);
    this.tic.unref?.();
    void this.verifier();
  }

  fermer(): void {
    clearInterval(this.tic);
    this.caffeinate?.kill();
    this.caffeinate = null;
  }

  // --- l'heure ------------------------------------------------------------------------------------------

  private chemin() {
    return path.join(this.o.dossierDonnees, "reveil.json");
  }

  private lire(): Fichier {
    try {
      const f = JSON.parse(fs.readFileSync(this.chemin(), "utf8")) as Fichier;
      if (lireHeure(f.heure)) return { heure: lireHeure(f.heure)!, exceptions: f.exceptions ?? {} };
    } catch {
      // pas encore réglé
    }
    return { heure: lireHeure(this.o.heureDefaut) ?? "07:00", exceptions: {} };
  }

  private ecrire(f: Fichier): void {
    const hier = iso(new Date(Date.now() - 2 * 86_400_000));
    for (const d of Object.keys(f.exceptions)) if (d < hier) delete f.exceptions[d];
    fs.mkdirSync(this.o.dossierDonnees, { recursive: true });
    fs.writeFileSync(this.chemin(), JSON.stringify(f, null, 2) + "\n");
    this.emit("etat");
  }

  /** L'heure prévue pour un jour, ou null si pas de réveil ce jour-là. */
  private heureDu(f: Fichier, jour: string): string | null {
    const e = f.exceptions[jour];
    return e === "aucun" ? null : (e ?? f.heure);
  }

  /** Le prochain appel prévu (aujourd'hui plus tard, ou les jours suivants). */
  prochain(maintenant = new Date()): Date | null {
    const f = this.lire();
    for (let n = 0; n < 8; n++) {
      const d = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + n);
      const h = this.heureDu(f, iso(d));
      if (!h) continue;
      const [hh, mm] = h.split(":").map(Number);
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
      if (t.getTime() > maintenant.getTime()) return t;
    }
    return null;
  }

  /** Règle le prochain réveil (« demain à 8 h »), ou l'heure de tous les jours. */
  regler(texteHeure: string, o: { quotidien?: boolean } = {}): Reponse {
    const h = lireHeure(texteHeure);
    if (!h) return { ok: false, texte: "Je n'ai pas compris l'heure : donne-la comme 7:30 ou 7h." };
    const f = this.lire();
    if (o.quotidien) {
      f.heure = h;
    } else {
      // la prochaine fois que cette heure arrive (ce matin si elle est encore devant nous, sinon demain)
      const m = new Date();
      const [hh, mm] = h.split(":").map(Number);
      let d = new Date(m.getFullYear(), m.getMonth(), m.getDate(), hh, mm);
      if (d.getTime() <= m.getTime()) d = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 1, hh, mm);
      f.exceptions[iso(d)] = h;
    }
    this.ecrire(f);
    return { ok: true, texte: `${o.quotidien ? "Réveil de tous les jours" : "Prochain réveil"} : ${this.decrireProchain()}.${this.configure ? "" : " (Attention : le réveil par appel n'est pas encore configuré, voir le README.)"}` };
  }

  /** Pas de réveil la prochaine fois. */
  annulerProchain(): Reponse {
    const p = this.prochain();
    if (!p) return { ok: false, texte: "Aucun réveil prévu." };
    const f = this.lire();
    f.exceptions[iso(p)] = "aucun";
    this.ecrire(f);
    return { ok: true, texte: `Réveil du ${p.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" })} annulé. Prochain : ${this.decrireProchain()}.` };
  }

  decrireProchain(maintenant = new Date()): string {
    const p = this.prochain(maintenant);
    if (!p) return "aucun";
    const demain = iso(p) !== iso(maintenant);
    return `${demain ? p.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" }) + " " : "aujourd'hui "}à ${pad(p.getHours())}:${pad(p.getMinutes())}`;
  }

  vue(): ReveilVue {
    const p = this.prochain();
    return { configure: this.configure, mode: this.mode, heure: this.lire().heure, prochain: p ? p.toISOString() : null, enCours: !!this.enCours };
  }

  /** Pour Max. */
  decrire(): string {
    const comment = this.macActif ? (this.appelActif ? "sur le Mac puis par appel" : "sur le Mac") : "par appel";
    if (!this.configure) return `Réveil par appel : pas configuré (il faut un compte Twilio et son numéro dans bureau.config.json). Heure prévue : ${this.decrireProchain()}.`;
    return `Réveil ${comment} : prochain ${this.decrireProchain()} (heure habituelle ${this.lire().heure}).${this.enCours ? " Un réveil est en cours (il n'a pas encore confirmé)." : ""}`;
  }

  // --- l'appel ------------------------------------------------------------------------------------------

  /** Il a parlé à Max : il est réveillé, plus de rappels. */
  confirmer(): void {
    if (!this.enCours) return;
    this.enCours = null;
    this.emit("reveille", { parole: true });
    this.emit("etat");
  }

  /** Un essai tout de suite, pour vérifier que tout marche : le Mac sonne, ou (mode appel) ton téléphone. */
  async essayer(): Promise<Reponse> {
    if (this.enCours) return { ok: false, texte: "Un réveil est déjà en cours." };
    if (this.macActif) {
      const e: EnCours = { cible: Date.now(), essai: 0, appels: 0, prochain: Date.now(), test: true, message: null };
      this.enCours = e;
      this.emit("etat");
      void this.tenter(e);
      return { ok: true, texte: "Essai du réveil : le Mac sonne. Arrête-le en disant « Max, je suis réveillé », avec le bouton de la page, ou en te laissant reconnaître par la caméra." };
    }
    if (!this.configure) return { ok: false, texte: "Le réveil par appel n'est pas configuré : il faut ton numéro et un compte Twilio dans bureau.config.json (voir le README)." };
    try {
      const twiml = await this.o.preparer(new Date());
      await this.o.appelleur!.appeler(this.o.telephone!, twiml);
      return { ok: true, texte: "Appel d'essai lancé : ton téléphone va sonner." };
    } catch (e) {
      return { ok: false, texte: `L'appel n'a pas pu partir : ${(e as Error).message}` };
    }
  }

  private async verifier(): Promise<void> {
    const maintenant = Date.now();
    // le réveil dû reste « le prochain » pendant 30 minutes (si le Mac s'est assoupi, l'appel part quand même)
    const p = this.prochain(new Date(maintenant - 30 * MINUTE));
    this.garderLeMacEveille(!!p && p.getTime() - maintenant < VEILLE_MS && this.configure);
    if (!this.configure) return;
    // le message de l'appel est préparé 10 minutes avant
    if (this.appelActif && p && p.getTime() - maintenant <= PREPARATION_MS && this.preparePour !== p.getTime()) {
      this.preparePour = p.getTime();
      this.message = this.o.preparer(p);
      this.message.catch(() => {});
      this.emit("preparer", p);
    }
    // l'heure est arrivée
    if (p && maintenant >= p.getTime() && maintenant - p.getTime() < 30 * MINUTE && this.enCours?.cible !== p.getTime() && !this.dejaFait(p)) {
      this.enCours = { cible: p.getTime(), essai: 0, appels: 0, prochain: maintenant, test: false, message: this.preparePour === p.getTime() ? this.message : null };
      this.marquerFait(p);
      this.emit("etat");
    }
    const e = this.enCours;
    if (e && !this.appelEnCours && maintenant >= e.prochain) await this.tenter(e);
  }

  private dejaFait(p: Date): boolean {
    try {
      return fs.readFileSync(path.join(this.o.dossierDonnees, "reveil-fait"), "utf8").trim() === String(p.getTime());
    } catch {
      return false;
    }
  }

  private marquerFait(p: Date): void {
    fs.mkdirSync(this.o.dossierDonnees, { recursive: true });
    fs.writeFileSync(path.join(this.o.dossierDonnees, "reveil-fait"), String(p.getTime()));
  }

  /** Une tentative : le Mac sonne (mode mac) et/ou le téléphone (mode appel), puis la suivante est programmée. */
  private async tenter(e: EnCours): Promise<void> {
    this.appelEnCours = true;
    e.essai++;
    if (this.macActif) this.emit("sonne", { essai: e.essai, heure: new Date(e.cible), test: e.test });
    let reveille = false;
    const appeler = this.appelActif && !e.test && e.appels < this.o.essais && (this.mode === "appel" || e.essai >= ESSAI_DU_PREMIER_APPEL);
    if (appeler) {
      e.appels++;
      try {
        const twiml = await (e.message ?? this.o.preparer(new Date(e.cible)));
        const sid = await this.o.appelleur!.appeler(this.o.telephone!, twiml);
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, this.o.attentePoll ?? 5000));
          if (this.enCours !== e) break;
          const etat = await this.o.appelleur!.etat(sid);
          if (STATUTS_FINAUX.has(etat.statut)) {
            reveille = estReveille(etat);
            break;
          }
        }
      } catch {
        // un appel raté compte comme un essai
      }
    }
    this.appelEnCours = false;
    if (this.enCours !== e) return;
    const maxEssais = this.mode === "appel" ? this.o.essais : (this.o.essaisMac ?? 10);
    if (reveille) {
      this.enCours = null;
      this.emit("reveille", { parole: false });
    } else if (e.essai >= maxEssais) {
      this.enCours = null;
      this.emit("echec");
    } else {
      const minutes = this.mode === "appel" ? this.o.rappelMinutes : (this.o.rappelMacMinutes ?? 2);
      e.prochain = Date.now() + minutes * MINUTE;
    }
    this.emit("etat");
  }

  /** La nuit avant un réveil, le Mac ne doit pas s'endormir (seulement quand il est branché : `caffeinate -s`). */
  private garderLeMacEveille(oui: boolean): void {
    if (!this.o.garderEveille) return;
    if (oui && !this.caffeinate) {
      this.caffeinate = spawn("caffeinate", ["-s", "-w", String(process.pid)], { stdio: "ignore" });
      this.caffeinate.on("error", () => (this.caffeinate = null));
      this.caffeinate.on("exit", () => (this.caffeinate = null));
    } else if (!oui && this.caffeinate) {
      this.caffeinate.kill();
      this.caffeinate = null;
    }
  }
}
