// Les gestes qui engagent l'utilisateur (envoyer un message, créer un rendez-vous) passent par deux temps :
// Max les prépare et lui demande, puis le serveur ne les exécute que si le DERNIER message de l'utilisateur, dit
// APRÈS la préparation, est un oui. Ni Max ni une page web lue par Max ne peuvent donc envoyer quelque chose seuls.

export type TypeConfirmation = "message" | "rdv";

interface Reponse {
  ok: boolean;
  texte: string;
}

interface EnAttente {
  resume: string;
  heure: number;
  executer: () => Promise<Reponse>;
}

const DUREE_MS = 5 * 60_000;
const OUI = /\b(oui|ouais|ouai|yes|vas y|envoie|envoie le|envoie la|ok|okay|d accord|dac|confirme|confirmer|c est bon|go|valide|parfait)\b/;
const NON = /\b(non|nan|pas|annule|annuler|attends|attend|stop|change|modifie|corrige)\b/;

const normaliser = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'\-]/g, " ");

/** Un « oui » sans « non » (« oui mais non », « ok non attends » ne comptent pas). */
export function estUnOui(texte: string): boolean {
  const t = normaliser(texte);
  return OUI.test(t) && !NON.test(t);
}

export class Confirmations {
  private attente = new Map<TypeConfirmation, EnAttente>();

  constructor(private horloge: () => number = Date.now) {}

  preparer(type: TypeConfirmation, resume: string, executer: () => Promise<Reponse>): void {
    this.attente.set(type, { resume, heure: this.horloge(), executer });
  }

  /** Le résumé de ce qui attend une confirmation, ou null. */
  enAttente(type: TypeConfirmation): string | null {
    const a = this.attente.get(type);
    if (!a) return null;
    if (this.horloge() - a.heure > DUREE_MS) {
      this.attente.delete(type);
      return null;
    }
    return a.resume;
  }

  async confirmer(type: TypeConfirmation, dernier: { texte: string; heure: number } | null): Promise<Reponse> {
    const quoi = type === "message" ? "message" : "rendez-vous";
    if (!this.enAttente(type)) return { ok: false, texte: `Aucun ${quoi} n'attend de confirmation : prépare-le d'abord.` };
    const a = this.attente.get(type)!;
    if (!dernier || dernier.heure <= a.heure || !estUnOui(dernier.texte)) {
      return { ok: false, texte: `L'utilisateur n'a pas encore dit oui. Lis-lui le ${quoi} (${a.resume}) et attends qu'il réponde oui avant de confirmer.` };
    }
    this.attente.delete(type);
    return a.executer();
  }

  /** Oublie tout ce qui attend ; renvoie combien. */
  annuler(): number {
    const n = this.attente.size;
    this.attente.clear();
    return n;
  }
}
