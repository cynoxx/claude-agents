// Les conseillers : un robot par domaine de la vie, assis à son bureau. Max leur pose une question ; chacun répond
// avec un `claude -p` (recherche web seulement), son profil, ses notes et le contexte du jour, puis retourne à son poste.
// Chaque conseiller a son carnet (conseillers/<id>.md), qu'il complète avec ses lignes « À retenir : … ».
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { ConseillerVue } from "../../shared/protocol.ts";
import { runAgent, type AgentHandle } from "../agent-runner.ts";
import { tronquer } from "../event-translator.ts";
import { lireCarnet, memoriser } from "./carnet.ts";

export interface ConseillerDef {
  id: string;
  nom: string;
  emoji: string;
  couleur: string;
  /** Le domaine, en un ou deux mots (« Études »). */
  domaine: string;
  /** Ce qu'il couvre, en une phrase (pour Max et pour l'écran). */
  description: string;
  /** Sa façon de conseiller, ajoutée à sa consigne. */
  consigne: string;
}

export const CONSEILLERS_DEFAUT: ConseillerDef[] = [
  {
    id: "etudes",
    nom: "Prof",
    emoji: "🩺",
    couleur: "#e05d5d",
    domaine: "Études",
    description: "études de santé et révisions : méthode, planning jusqu'aux examens, explications de cours, interrogations",
    consigne: `Tu connais bien les études de santé en France (PASS, LAS, concours, QCM) et les méthodes d'apprentissage qui marchent : rappel actif, répétition espacée, annales et QCM chronométrés, plutôt que relire ou surligner.
Tu découpes toujours en petites étapes concrètes et réalistes vu le temps restant avant l'examen. Pas de planning parfait : un plan simple qui tient.
Pour une interrogation, donne des questions courtes numérotées, puis les réponses à part, sous un titre « Réponses ».`,
  },
  {
    id: "sante",
    nom: "Coach",
    emoji: "💪",
    couleur: "#3fbfa8",
    domaine: "Santé",
    description: "sommeil, rythme, énergie, alimentation, sport, stress et moral",
    consigne: `Tes conseils s'appuient sur des sources sérieuses (sommeil, chronobiologie, activité physique). Tu proposes des changements progressifs : avancer le coucher d'un quart d'heure à la fois, lever à heure fixe, lumière du jour le matin, écrans coupés avant de dormir.
Tu n'es pas médecin : pour un symptôme ou un mal-être qui dure, tu orientes vers un professionnel (médecin traitant, service de santé de l'université, Santé Psy Étudiant pour des séances gratuites avec un psychologue). En cas d'idées noires : le 3114, jour et nuit.`,
  },
  {
    id: "business",
    nom: "Associé",
    emoji: "💼",
    couleur: "#d9a441",
    domaine: "Business",
    description: "projets d'entreprise, boutique, réseaux sociaux, vidéos, contenu et marketing",
    consigne: `Tu es lucide sur le temps : regarde la priorité du moment dans le profil. Si les projets passent après les études en ce moment, propose des actions qui prennent peu de temps, à caser après le travail, ou à mettre au parking, plutôt que de nouveaux chantiers.
Tu raisonnes en résultats (ventes, abonnés, temps passé) et tu donnes des actions précises.`,
  },
  {
    id: "apps",
    nom: "Dev",
    emoji: "📱",
    couleur: "#6c8cff",
    domaine: "Apps",
    description: "applications et code : fonctionnalités, technique, choix d'outils",
    consigne: `Tu réponds en développeur pragmatique : la solution la plus simple qui marche d'abord. Pour un vrai travail de code dans un projet, recommande à Max de lancer une mission avec le Codeur.`,
  },
  {
    id: "vie",
    nom: "Majordome",
    emoji: "🏠",
    couleur: "#b07cc6",
    domaine: "Vie perso",
    description: "administratif, argent, logement, relations, organisation du quotidien",
    consigne: `Tu es pratique et bienveillant : démarches pas à pas, budget simple, organisation du quotidien. Sur les relations, tu écoutes et tu aides à y voir clair sans juger ni décider à la place de l'utilisateur.`,
  },
];

const DOSSIER_NOTES = "conseillers";
const MAX_REPONSE = 4000;
const BULLE_FIN_MS = 8000;
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Le conseiller désigné par son identifiant, son nom ou son domaine (« etudes », « le Prof », « Études »). */
export function trouverConseiller(defs: ConseillerDef[], nom: string): ConseillerDef | undefined {
  const n = sansAccents(nom).replace(/^(le|la|les|l'|au|a la|a l'|du|de la)\s*/, "");
  return defs.find((d) => [d.id, d.nom, d.domaine].some((x) => sansAccents(x) === n));
}

export function argsConseiller(o: { modele: string; consigne: string; question: string }): string[] {
  return [
    "-p", o.question,
    "--output-format", "stream-json",
    "--verbose",
    "--model", o.modele,
    "--strict-mcp-config",
    "--tools", "WebSearch,WebFetch",
    "--allowedTools", "WebSearch,WebFetch",
    "--append-system-prompt", o.consigne,
  ];
}

export function consigneConseiller(d: ConseillerDef, o: { profil: string; notes: string[]; contexte: string }): string {
  return `Tu es ${d.nom}, le conseiller « ${d.domaine} » du Bureau (${d.description}).
Max, le chef d'équipe et l'assistant vocal de l'utilisateur, te transmet une question de sa part. Ta réponse revient à Max, qui la lui résumera à voix haute.
- Réponds en français, de façon concrète et actionnable, en quinze lignes au plus, sans tableau. Commence par la réponse directe.
- Appuie-toi sur le profil et tes notes. Cherche sur le web quand il faut une information récente ou précise, et cite brièvement tes sources (nom du site).
- Quand tu apprends un fait durable et utile pour ton domaine, termine par une ligne par fait : « À retenir : … ».
${d.consigne}

Profil de l'utilisateur (son fichier moi.md) :
${o.profil || "(pas encore rempli)"}

Tes notes sur ton domaine :
${o.notes.length ? o.notes.join("\n") : "(aucune pour l'instant)"}

Contexte du jour :
${o.contexte}`;
}

/** Sépare la réponse des lignes « À retenir : … » (notes pour le carnet du conseiller). */
export function extraireARetenir(texte: string): { reponse: string; notes: string[] } {
  const notes: string[] = [];
  const reste: string[] = [];
  for (const l of texte.split("\n")) {
    const m = /^\s*[-*]?\s*(?:\*\*)?[ÀA] retenir(?:\*\*)?\s*:\s*(.+)$/i.exec(l);
    if (m) notes.push(m[1].trim());
    else reste.push(l);
  }
  return { reponse: reste.join("\n").trim(), notes };
}

interface Reponse {
  ok: boolean;
  texte: string;
}

/** Événement : `etat` quand la vue d'un conseiller change. */
export class Conseillers extends EventEmitter {
  private vues = new Map<string, ConseillerVue>();
  private enCours = new Map<string, AgentHandle>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private o: {
      defs: ConseillerDef[];
      bin: string;
      modele: string;
      /** Le dossier des missions : les carnets vont dans son sous-dossier « conseillers ». */
      dossier: string;
      timeoutMs: number;
      profil: () => string;
      contexte: () => string;
    },
  ) {
    super();
    for (const d of o.defs) {
      this.vues.set(d.id, { id: d.id, nom: d.nom, emoji: d.emoji, couleur: d.couleur, domaine: d.domaine, description: d.description, statut: "libre", bulle: "" });
    }
  }

  get defs(): ConseillerDef[] {
    return this.o.defs;
  }

  vue(): ConseillerVue[] {
    return [...this.vues.values()].map((v) => ({ ...v }));
  }

  /** Une ligne par conseiller, pour la consigne de Max. */
  liste(): string {
    return this.o.defs.map((d) => `- ${d.id} : ${d.emoji} ${d.nom} (${d.domaine}) — ${d.description}`).join("\n");
  }

  async consulter(nom: string, question: string): Promise<Reponse> {
    const d = trouverConseiller(this.o.defs, nom);
    if (!d) return { ok: false, texte: `Conseiller inconnu. Ceux du Bureau : ${this.o.defs.map((x) => `${x.nom} (${x.id})`).join(", ")}.` };
    const q = question.trim();
    if (!q) return { ok: false, texte: "La question est vide." };
    if (this.enCours.has(d.id)) return { ok: false, texte: `${d.nom} réfléchit déjà à une autre question. Attends sa réponse.` };

    const notesDir = path.join(this.o.dossier, DOSSIER_NOTES);
    fs.mkdirSync(notesDir, { recursive: true });
    const consigne = consigneConseiller(d, { profil: this.o.profil(), notes: lireCarnet(notesDir, `${d.id}.md`), contexte: this.o.contexte() });
    this.maj(d.id, { statut: "reflechit", bulle: tronquer(`Je réfléchis : ${q}`), question: q, reponse: undefined, heure: new Date().toISOString() });

    const h = runAgent({
      bin: this.o.bin,
      args: argsConseiller({ modele: this.o.modele, consigne, question: q }),
      cwd: notesDir,
      timeoutMs: this.o.timeoutMs,
      mode: "stream",
      onTraduction: (t) => t.bulle && this.maj(d.id, { bulle: t.bulle }),
    });
    this.enCours.set(d.id, h);
    const r = await h.done;
    this.enCours.delete(d.id);

    if (!r.ok) {
      const texte = r.quota ? "Le quota de l'abonnement Claude est atteint : réessaie plus tard." : `${d.nom} n'a pas pu répondre : ${r.erreur ?? "erreur inconnue"}.`;
      this.finir(d.id, r.quota ? "💤 Quota atteint" : "❗ Je n'ai pas pu répondre");
      return { ok: false, texte };
    }
    const { reponse, notes } = extraireARetenir(r.texte);
    for (const n of notes) this.noterPour(d.id, n);
    const texte = reponse.length > MAX_REPONSE ? reponse.slice(0, MAX_REPONSE) + " (…)" : reponse;
    this.finir(d.id, "✅ Réponse transmise à Max", texte);
    return { ok: true, texte: `${d.nom} répond :\n${texte}` };
  }

  noterPour(nom: string, note: string): Reponse {
    const d = trouverConseiller(this.o.defs, nom);
    if (!d) return { ok: false, texte: "Conseiller inconnu." };
    try {
      const ligne = memoriser(path.join(this.o.dossier, DOSSIER_NOTES), note, new Date(), `${d.id}.md`, `# Notes de ${d.nom} (${d.domaine})\n\nCe que ${d.nom} a retenu. Tu peux modifier ou supprimer des lignes.\n\n`);
      return { ok: true, texte: `Noté pour ${d.nom} : ${ligne}` };
    } catch (e) {
      return { ok: false, texte: (e as Error).message };
    }
  }

  arreterTout(): void {
    for (const h of this.enCours.values()) h.stop();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private finir(id: string, bulle: string, reponse?: string): void {
    this.maj(id, { statut: "libre", bulle, ...(reponse ? { reponse } : {}) });
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => this.maj(id, { bulle: "" }), BULLE_FIN_MS),
    );
  }

  private maj(id: string, champs: Partial<ConseillerVue>): void {
    const v = this.vues.get(id);
    if (!v) return;
    Object.assign(v, champs);
    this.emit("etat");
  }
}
