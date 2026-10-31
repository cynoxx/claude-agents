// Le tri des mails : Max lit les derniers mails (avec leur identifiant), les classe lui-même par catégorie,
// et le classement s'affiche sur son écran. Ranger des mails dans un dossier passe par une confirmation.
import { EventEmitter } from "node:events";
import type { CategorieMails, MailsVue } from "../../shared/protocol.ts";
import type { MailBref } from "./mac.ts";

export const CATEGORIES: Record<CategorieMails, { nom: string; emoji: string }> = {
  a_traiter: { nom: "À traiter", emoji: "🔴" },
  etudes: { nom: "Études", emoji: "🎓" },
  business: { nom: "Business", emoji: "💼" },
  perso: { nom: "Perso", emoji: "👤" },
  pubs: { nom: "Pubs et newsletters", emoji: "📰" },
};

interface Reponse {
  ok: boolean;
  texte: string;
}

/** Événement : `etat` quand le classement affiché change. */
export class TriMails extends EventEmitter {
  private lus = new Map<number, MailBref>();
  private classement: MailsVue | null = null;

  /** Retient les mails que Max vient de lire (le classement ne pourra porter que sur eux). */
  retenir(mails: MailBref[]): void {
    this.lus = new Map(mails.map((m) => [m.id, m]));
  }

  /** Affiche le classement fait par Max : { catégorie: [ids] } et un résumé d'une ou deux phrases. */
  afficher(categories: Partial<Record<string, unknown>>, resume: string, o: { auto?: boolean } = {}): Reponse {
    if (!this.lus.size) return { ok: false, texte: "Lis d'abord les mails avec trier_mails." };
    const vue: MailsVue = { heure: new Date().toISOString(), resume: resume.replace(/\s+/g, " ").trim().slice(0, 300), categories: [], ...(o.auto ? { auto: true } : {}) };
    const places = new Set<number>();
    for (const [cle, def] of Object.entries(CATEGORIES) as [CategorieMails, { nom: string; emoji: string }][]) {
      const ids = Array.isArray(categories[cle]) ? (categories[cle] as unknown[]).map(Number) : [];
      const mails = ids
        .filter((id) => this.lus.has(id) && !places.has(id))
        .map((id) => {
          places.add(id);
          const m = this.lus.get(id)!;
          return { id, de: m.de.replace(/\s*<[^>]*>\s*/, "").trim() || m.de, sujet: m.sujet, lu: m.lu };
        });
      if (mails.length) vue.categories.push({ id: cle, nom: def.nom, emoji: def.emoji, mails });
    }
    const oublies = [...this.lus.keys()].filter((id) => !places.has(id)).length;
    this.classement = vue;
    this.emit("etat");
    const total = vue.categories.reduce((t, c) => t + c.mails.length, 0);
    return { ok: true, texte: `${total} mail${total > 1 ? "s" : ""} classé${total > 1 ? "s" : ""} et affiché${total > 1 ? "s" : ""} à l'écran.${oublies ? ` ${oublies} n'ont pas été classés.` : ""}` };
  }

  /** Plus rien à montrer (aucun mail non lu). */
  vider(resume: string): void {
    this.classement = { heure: new Date().toISOString(), resume, categories: [] };
    this.emit("etat");
  }

  /** Remontre le dernier classement (la fenêtre des mails se rouvre sur l'écran). */
  remontrer(): void {
    if (!this.classement) return;
    this.classement = { ...this.classement, heure: new Date().toISOString(), auto: true };
    this.emit("etat");
  }

  /** Les identifiants d'une catégorie du dernier classement (pour ranger les pubs, par exemple). */
  ids(categorie: string): number[] {
    return this.classement?.categories.find((c) => c.id === categorie)?.mails.map((m) => m.id) ?? [];
  }

  /** Vérifie que ces identifiants viennent bien des mails lus. */
  connus(ids: unknown[]): number[] {
    return ids.map(Number).filter((id) => this.lus.has(id));
  }

  vue(): MailsVue | null {
    return this.classement;
  }
}
