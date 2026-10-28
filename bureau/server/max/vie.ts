// Ta vie, rangée : des domaines (études, santé, business…), chacun avec ses catégories (« Vidéos monétisables »…),
// des projets avec leur prochaine action et leur échéance (vie/projets.json), et le journal du jour (vie/journal.jsonl,
// une ligne par note ou bilan). Max s'en sert pour savoir quoi faire maintenant, et l'écran pour te le montrer.
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { DomaineVie, JourJournal, ProjetVie, VieVue } from "../../shared/protocol.ts";
import { jourDe } from "./coach.ts";

const DOSSIER = "vie";
const FICHIER_PROJETS = "projets.json";
const FICHIER_JOURNAL = "journal.jsonl";

export const DOMAINES: VieVue["domaines"] = [
  { id: "etudes", nom: "Études", emoji: "🩺", categories: ["PASS", "Méthode"] },
  { id: "sante", nom: "Corps", emoji: "💪", categories: ["Sport", "Sommeil", "Alimentation"] },
  { id: "business", nom: "Business", emoji: "💼", categories: ["Vidéos monétisables", "Livre & boutique", "Clipping"] },
  { id: "apps", nom: "Apps", emoji: "📱", categories: ["Applications"] },
  { id: "vie", nom: "Vie", emoji: "🏠", categories: ["Argent", "Administratif", "Proches", "Maison", "Projets de vie"] },
  { id: "esprit", nom: "Esprit", emoji: "🕊", categories: ["Spiritualité", "Lectures", "Discipline"] },
];

/** Les projets du premier lancement (tu les changes en parlant à Max). */
export const PROJETS_DEPART: Omit<ProjetVie, "id" | "maj">[] = [
  { domaine: "etudes", categorie: "PASS", nom: "Réussir l'examen de PASS", prochaineAction: "Caler les révisions de la semaine jusqu'à l'examen", statut: "actif" },
  {
    domaine: "business",
    categorie: "Vidéos monétisables",
    nom: "Asclepium — vidéos « Loi N »",
    objectif: "Une vidéo par jour : TikTok 19:30, Shorts 16:30, Reels 21:00",
    prochaineAction: "Enregistrer la voix de la prochaine loi",
    statut: "actif",
  },
  { domaine: "business", categorie: "Vidéos monétisables", nom: "Fruit TV — clips", prochaineAction: "Déposer les prochains clips dans le dossier du studio", statut: "pause" },
  { domaine: "business", categorie: "Livre & boutique", nom: "Livre Asclepium (Shopify)", prochaineAction: "Relier chaque vidéo au lien de la boutique", statut: "actif" },
  { domaine: "apps", categorie: "Applications", nom: "Cynox Fitness", statut: "pause" },
  { domaine: "apps", categorie: "Applications", nom: "Lifforge", statut: "pause" },
  { domaine: "vie", categorie: "Projets de vie", nom: "Dentaire au Portugal", prochaineAction: "Lister les écoles et leurs dates d'inscription", statut: "pause" },
];

interface Ligne {
  jour: string;
  heure: string;
  texte: string;
  type: "note" | "bilan";
  humeur?: number;
}

interface Reponse {
  ok: boolean;
  texte: string;
}

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const pad = (n: number) => String(n).padStart(2, "0");
const ESTDOMAINE = new Set(DOMAINES.map((d) => d.id));

/** Un identifiant lisible tiré du nom (« asclepium-videos-loi-n »), unique parmi `pris`. */
export function idProjet(nom: string, pris: Set<string>): string {
  const base = sansAccents(nom).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "projet";
  let id = base;
  for (let i = 2; pris.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Les projets à faire avancer en premier : actifs, avec une prochaine action, l'échéance la plus proche d'abord. */
export function focusDuJour(projets: ProjetVie[], combien = 3): ProjetVie[] {
  return projets
    .filter((p) => p.statut === "actif" && p.prochaineAction)
    .sort((a, b) => (a.echeance ?? "9999").localeCompare(b.echeance ?? "9999") || b.maj.localeCompare(a.maj))
    .slice(0, combien);
}

export class Vie extends EventEmitter {
  private projets: ProjetVie[];
  private readonly dossier: string;

  constructor(private o: { dossier: string; maintenant?: () => Date }) {
    super();
    this.dossier = path.join(o.dossier, DOSSIER);
    this.projets = this.lireProjets();
  }

  private get maintenant(): Date {
    return this.o.maintenant?.() ?? new Date();
  }

  private lireProjets(): ProjetVie[] {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(this.dossier, FICHIER_PROJETS), "utf8")) as ProjetVie[];
      if (Array.isArray(p)) return p.filter((x) => x && x.id && x.nom && ESTDOMAINE.has(x.domaine));
    } catch {
      // pas encore de fichier : les projets de départ
    }
    const pris = new Set<string>();
    const maj = jourDe(this.maintenant);
    const depart = PROJETS_DEPART.map((p) => {
      const id = idProjet(p.nom, pris);
      pris.add(id);
      return { ...p, id, maj };
    });
    this.ecrireProjets(depart);
    return depart;
  }

  private ecrireProjets(p = this.projets): void {
    fs.mkdirSync(this.dossier, { recursive: true });
    fs.writeFileSync(path.join(this.dossier, FICHIER_PROJETS), JSON.stringify(p, null, 2) + "\n");
  }

  private trouver(cle: string): ProjetVie | undefined {
    const c = sansAccents(cle);
    return this.projets.find((p) => p.id === cle) ?? this.projets.find((p) => sansAccents(p.nom) === c) ?? this.projets.find((p) => sansAccents(p.nom).includes(c));
  }

  /** Crée ou met à jour un projet (par id ou par nom). Les champs vides ("") sont effacés. */
  projet(ch: { id?: string; nom?: string; domaine?: string; categorie?: string; objectif?: string; prochaineAction?: string; echeance?: string; statut?: string }): Reponse {
    if (ch.domaine && !ESTDOMAINE.has(ch.domaine as DomaineVie)) return { ok: false, texte: `Domaine inconnu : ${ch.domaine} (${[...ESTDOMAINE].join(", ")}).` };
    if (ch.statut && !["actif", "pause", "fini"].includes(ch.statut)) return { ok: false, texte: "Statut : actif, pause ou fini." };
    if (ch.echeance && !/^\d{4}-\d{2}-\d{2}$/.test(ch.echeance)) return { ok: false, texte: "Échéance au format AAAA-MM-JJ." };
    const existant = (ch.id && this.trouver(ch.id)) || (ch.nom && !ch.id ? this.trouver(ch.nom) : undefined);
    const maj = jourDe(this.maintenant);
    const champs = Object.fromEntries(
      (["nom", "domaine", "categorie", "objectif", "prochaineAction", "echeance", "statut"] as const).filter((k) => ch[k] !== undefined).map((k) => [k, ch[k]!.trim()]),
    ) as Partial<ProjetVie>;
    let p: ProjetVie;
    if (existant) {
      // trouvé par son nom : ce nom servait à le chercher, pas à le renommer
      if (!ch.id) delete champs.nom;
      p = Object.assign(existant, champs, { maj });
      for (const k of ["objectif", "prochaineAction", "echeance"] as const) if (p[k] === "") delete p[k];
    } else {
      if (!ch.nom || !ch.domaine) return { ok: false, texte: `Projet introuvable${ch.id ? ` : ${ch.id}` : ""}. Pour en créer un : nom et domaine.` };
      p = { id: idProjet(ch.nom, new Set(this.projets.map((x) => x.id))), nom: ch.nom.trim(), domaine: ch.domaine as DomaineVie, categorie: ch.categorie?.trim() || "Autre", statut: "actif", maj, ...champs };
      for (const k of ["objectif", "prochaineAction", "echeance"] as const) if (!p[k]) delete p[k];
      this.projets.push(p);
    }
    this.ecrireProjets();
    this.emit("etat");
    return { ok: true, texte: `${existant ? "Projet mis à jour" : "Projet créé"} : ${p.nom}${p.prochaineAction ? ` → ${p.prochaineAction}` : ""}.` };
  }

  /** Ajoute une note (ou le bilan du soir) au journal du jour. */
  ecrire(texte: string, o: { bilan?: boolean; humeur?: number } = {}): Reponse {
    const t = texte.replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!t) return { ok: false, texte: "La note est vide." };
    const d = this.maintenant;
    const l: Ligne = { jour: jourDe(d), heure: `${pad(d.getHours())}:${pad(d.getMinutes())}`, texte: t, type: o.bilan ? "bilan" : "note" };
    if (o.humeur !== undefined && o.humeur >= 1 && o.humeur <= 5) l.humeur = Math.round(o.humeur);
    fs.mkdirSync(this.dossier, { recursive: true });
    fs.appendFileSync(path.join(this.dossier, FICHIER_JOURNAL), JSON.stringify(l) + "\n");
    this.emit("etat");
    return { ok: true, texte: o.bilan ? "Bilan du jour écrit dans ton journal." : "Noté dans ton journal." };
  }

  /** Le journal par jour, du plus récent au plus ancien. */
  journal(jours = 7): JourJournal[] {
    let brut = "";
    try {
      brut = fs.readFileSync(path.join(this.dossier, FICHIER_JOURNAL), "utf8");
    } catch {
      return [];
    }
    const parJour = new Map<string, JourJournal>();
    for (const s of brut.split("\n")) {
      let l: Ligne;
      try {
        l = JSON.parse(s);
      } catch {
        continue;
      }
      if (!l || typeof l.texte !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(l.jour)) continue;
      const j = parJour.get(l.jour) ?? { jour: l.jour, notes: [] };
      if (l.type === "bilan") j.bilan = l.texte;
      else j.notes.push({ heure: l.heure, texte: l.texte });
      if (l.humeur) j.humeur = l.humeur;
      parJour.set(l.jour, j);
    }
    return [...parJour.values()].sort((a, b) => b.jour.localeCompare(a.jour)).slice(0, jours);
  }

  vue(): VieVue {
    const aujourdhui = jourDe(this.maintenant);
    const j = this.journal(7);
    return { domaines: DOMAINES, projets: this.projets, focus: focusDuJour(this.projets), journal: j.find((x) => x.jour === aujourdhui) ?? null, recents: j.filter((x) => x.jour !== aujourdhui) };
  }

  /** Pour la consigne de Max : les projets en cours, très court. */
  decrire(): string {
    const actifs = this.projets.filter((p) => p.statut !== "fini");
    const lignes = actifs.map(
      (p) => `- [${p.id}] ${p.nom} (${p.domaine} › ${p.categorie}${p.statut === "pause" ? ", en pause" : ""})${p.prochaineAction ? ` → ${p.prochaineAction}` : ""}${p.echeance ? ` · avant le ${p.echeance}` : ""}`,
    );
    const j = this.vue().journal;
    return `Ses projets :\n${lignes.join("\n") || "(aucun)"}\nJournal d'aujourd'hui : ${j ? `${j.notes.length} note(s)${j.bilan ? ", bilan écrit" : ", pas encore de bilan"}` : "vide"}.`;
  }
}
