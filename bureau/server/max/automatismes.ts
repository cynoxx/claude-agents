// Les automatismes : ce que Max fait tout seul, chaque jour, sans qu'on le lui demande. Chacun a son heure (et ses
// jours) ; il tourne une fois par jour, même si le Bureau a été ouvert un peu après l'heure (jusqu'à 3 h de retard).
// L'état (actif, dernière fois, dernier résultat) est gardé dans automatismes.json ; on les coupe depuis l'écran.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { AutomatismeVue } from "../../shared/protocol.ts";
import { jourDe } from "./coach.ts";

export interface AutomatismeDef {
  id: string;
  nom: string;
  /** Ce qu'il fait, en une phrase (pour l'écran et pour Max). */
  description: string;
  heure: string; // HH:MM
  /** 0 = dimanche … 6 = samedi ; absent : tous les jours. */
  jours?: number[];
  /** Le travail : renvoie ce qui s'est passé (affiché), ou null s'il n'y avait rien à faire. */
  faire: () => Promise<string | null>;
}

interface Etat {
  actif: boolean;
  dernier?: string; // AAAA-MM-JJ
  resultat?: string;
}

const RETARD_MAX_MIN = 180;
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Doit-il tourner maintenant ? (une fois par jour, à partir de son heure, jusqu'à 3 h après) */
export function estDu(def: Pick<AutomatismeDef, "heure" | "jours">, etat: Etat, maintenant: Date): boolean {
  if (!etat.actif || etat.dernier === jourDe(maintenant)) return false;
  if (def.jours && !def.jours.includes(maintenant.getDay())) return false;
  const ecart = maintenant.getHours() * 60 + maintenant.getMinutes() - minutes(def.heure);
  return ecart >= 0 && ecart <= RETARD_MAX_MIN;
}

/** Événements : `resultat` (texte) quand un automatisme a fait quelque chose, `etat` à chaque changement. */
export class Automatismes extends EventEmitter {
  private etats: Record<string, Etat> = {};
  private minuterie?: NodeJS.Timeout;
  private enCours = new Set<string>();
  private readonly fichier: string;

  constructor(
    private defs: AutomatismeDef[],
    private o: { dossier: string; maintenant?: () => Date },
  ) {
    super();
    this.fichier = path.join(o.dossier, "automatismes.json");
    try {
      this.etats = JSON.parse(fs.readFileSync(this.fichier, "utf8"));
    } catch {
      this.etats = {};
    }
    for (const d of defs) this.etats[d.id] ??= { actif: true };
  }

  private get maintenant(): Date {
    return this.o.maintenant?.() ?? new Date();
  }

  demarrer(intervalleMs = 30_000): void {
    // pas au démarrage : on laisse Max se lancer et répondre d'abord
    this.minuterie = setInterval(() => void this.verifier(), intervalleMs);
  }

  arreter(): void {
    clearInterval(this.minuterie);
  }

  async verifier(): Promise<void> {
    const m = this.maintenant;
    for (const d of this.defs) if (estDu(d, this.etats[d.id], m)) await this.lancer(d.id);
  }

  /** Le lance tout de suite (même s'il a déjà tourné aujourd'hui). */
  async lancer(id: string): Promise<string> {
    const d = this.defs.find((x) => x.id === id);
    if (!d) return `Automatisme inconnu : ${id}.`;
    if (this.enCours.has(id)) return `${d.nom} est déjà en cours.`;
    this.enCours.add(id);
    const e = this.etats[id];
    e.dernier = jourDe(this.maintenant);
    this.sauver();
    let res: string | null;
    try {
      res = await d.faire();
    } catch (err) {
      res = `⚠️ ${d.nom} : ${(err as Error).message}`;
    } finally {
      this.enCours.delete(id);
    }
    e.resultat = res ?? "Rien à faire aujourd'hui.";
    this.sauver();
    if (res) this.emit("resultat", res, id);
    return e.resultat;
  }

  activer(id: string, actif: boolean): boolean {
    const e = this.etats[id];
    if (!e) return false;
    e.actif = actif;
    this.sauver();
    return true;
  }

  private sauver(): void {
    fs.mkdirSync(path.dirname(this.fichier), { recursive: true });
    fs.writeFileSync(this.fichier, JSON.stringify(this.etats, null, 2) + "\n");
    this.emit("etat");
  }

  vue(): AutomatismeVue[] {
    const auj = jourDe(this.maintenant);
    return this.defs.map((d) => ({
      id: d.id,
      nom: d.nom,
      description: d.description,
      heure: d.heure,
      jours: d.jours,
      actif: this.etats[d.id].actif,
      faitAujourdhui: this.etats[d.id].dernier === auj,
      resultat: this.etats[d.id].resultat,
      enCours: this.enCours.has(d.id),
    }));
  }

  /** Pour la consigne de Max. */
  decrire(): string {
    return `Tes automatismes (tu les fais tout seul) : ${this.vue()
      .filter((a) => a.actif)
      .map((a) => `${a.nom} à ${a.heure}${a.faitAujourdhui ? " (fait aujourd'hui)" : ""}`)
      .join(", ")}.`;
  }
}
