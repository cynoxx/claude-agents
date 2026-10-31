// Le verrou de Max : quand un visage est enregistré, Max est verrouillé au démarrage et à chaque mise en veille.
// Il ne s'ouvre qu'avec le bon visage ET une tête qui tourne, vue par la page (une photo ne le peut pas).
import { EventEmitter } from "node:events";
import type { VerrouVue } from "../../shared/protocol.ts";
import type { Visage } from "./visage.ts";

const ESSAIS_MAX = 10;
const PAUSE_MS = 30_000;

interface Reponse {
  ok: boolean;
  texte: string;
}

/** Événements : `deverrouille` (prénom), `etat` (quand la vue change). */
export class Verrou extends EventEmitter {
  private ferme: boolean;
  private rates: number[] = [];
  private bloqueJusqua = 0;
  private derniereDemande = 0;

  constructor(private o: { visage: Visage; actif: boolean; horloge?: () => number }) {
    super();
    this.ferme = this.protege;
  }

  private get maintenant() {
    return this.o.horloge?.() ?? Date.now();
  }

  /** Le verrou ne sert que si la reconnaissance est activée et qu'un visage est enregistré. */
  get protege(): boolean {
    return this.o.actif && this.o.visage.enregistre;
  }

  get verrouille(): boolean {
    return this.protege && this.ferme;
  }

  vue(): VerrouVue {
    return { actif: this.o.actif, enregistre: this.o.visage.enregistre, verrouille: this.verrouille, prenom: this.o.visage.prenom, demande: this.derniereDemande };
  }

  verrouiller(): void {
    if (!this.protege || this.ferme) return;
    this.ferme = true;
    this.emit("etat");
  }

  /** Quelqu'un veut réveiller Max (Siri) : la page allume la caméra. */
  demander(): void {
    this.derniereDemande = this.maintenant;
    this.emit("etat");
  }

  tenter(descripteur: unknown, vivant: boolean): Reponse {
    if (!this.verrouille) return { ok: true, texte: "Déjà déverrouillé." };
    const t = this.maintenant;
    if (t < this.bloqueJusqua) return { ok: false, texte: `Trop d'essais : attends ${Math.ceil((this.bloqueJusqua - t) / 1000)} secondes.` };
    if (!vivant) return { ok: false, texte: "Tourne doucement la tête à gauche puis à droite, pour me montrer que ce n'est pas une photo." };
    const r = this.o.visage.comparer(descripteur);
    if (!r.ok) {
      this.rates = [...this.rates.filter((x) => t - x < 60_000), t];
      if (this.rates.length >= ESSAIS_MAX) {
        this.bloqueJusqua = t + PAUSE_MS;
        this.rates = [];
      }
      return { ok: false, texte: "Je ne te reconnais pas." };
    }
    this.rates = [];
    this.ferme = false;
    this.emit("deverrouille", this.o.visage.prenom);
    this.emit("etat");
    return { ok: true, texte: "Reconnu." };
  }

  enregistrer(descripteurs: unknown[], prenom: string): Reponse {
    if (this.verrouille) return { ok: false, texte: "Déverrouille d'abord avec ton visage." };
    try {
      this.o.visage.enregistrer(descripteurs, prenom);
    } catch (e) {
      return { ok: false, texte: (e as Error).message };
    }
    this.ferme = false;
    this.emit("etat");
    return { ok: true, texte: "Visage enregistré." };
  }

  effacer(): Reponse {
    if (this.verrouille) return { ok: false, texte: "Déverrouille d'abord avec ton visage." };
    this.o.visage.effacer();
    this.emit("etat");
    return { ok: true, texte: "Visage effacé : Max n'est plus verrouillé." };
  }
}
