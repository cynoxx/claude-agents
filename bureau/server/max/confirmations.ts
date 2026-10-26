// Les gestes qui engagent l'utilisateur (envoyer un message, créer un rendez-vous) passent par deux temps :
// Max les prépare et lui demande, puis le serveur ne les exécute que si le DERNIER message de l'utilisateur, dit
// APRÈS la préparation, est un oui. Ni Max ni une page web lue par Max ne peuvent donc envoyer quelque chose seuls.

export type TypeConfirmation = "message" | "rdv" | "planning" | "rangement";

const QUOI: Record<TypeConfirmation, string> = {
  message: "message",
  rdv: "rendez-vous",
  planning: "ajout de l'emploi du temps au Calendrier",
  rangement: "rangement de mails",
};

interface Reponse {
  ok: boolean;
  texte: string;
}

interface EnAttente {
  resume: string;
  heure: number;
  executer: () => Promise<Reponse>;
  ouiAvant: boolean;
}

/** Pour un geste sans risque, un oui dit juste avant la préparation (« oui, range les pubs ») suffit. */
const OUI_AVANT_MS = 2 * 60_000;

const DUREE_MS = 5 * 60_000;
const OUI = /\b(oui|ouais|ouai|yes|vas y|envoie|envoie le|envoie la|ok|okay|d accord|dac|confirme|confirmer|c est bon|go|valide|parfait)\b/;
const NON = /\b(non|nan|pas|annule|annuler|attends|attend|stop|change|modifie|corrige|plutot|autre)\b/;

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

  /**
   * `ouiAvant` : accepte aussi le oui que l'utilisateur vient de dire avant la préparation (moins de 2 minutes).
   * À réserver aux gestes sans risque pour autrui (ranger ses mails, mettre son emploi du temps dans son
   * Calendrier) ; un message ou un rendez-vous demande toujours un oui après avoir été lu.
   */
  preparer(type: TypeConfirmation, resume: string, executer: () => Promise<Reponse>, o: { ouiAvant?: boolean } = {}): void {
    this.attente.set(type, { resume, heure: this.horloge(), executer, ouiAvant: !!o.ouiAvant });
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
    const quoi = QUOI[type];
    if (!this.enAttente(type)) return { ok: false, texte: `Rien n'attend de confirmation (${quoi}) : prépare-le d'abord.` };
    const a = this.attente.get(type)!;
    const assezRecent = dernier && (dernier.heure > a.heure || (a.ouiAvant && dernier.heure > a.heure - OUI_AVANT_MS));
    if (!dernier || !assezRecent || !estUnOui(dernier.texte)) {
      return { ok: false, texte: `L'utilisateur n'a pas encore dit oui (${quoi} : ${a.resume}). Demande-lui et attends qu'il réponde oui avant de confirmer.` };
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
