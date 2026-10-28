// Ce que font les automatismes de Max, chaque jour, tout seuls (voir automatismes.ts pour l'horloge).
import fs from "node:fs";
import path from "node:path";
import type { IdeeDuJour } from "../../shared/protocol.ts";
import { runAgent } from "../agent-runner.ts";
import type { Studio } from "../studio/studio.ts";
import type { AutomatismeDef } from "./automatismes.ts";
import { jourDe } from "./coach.ts";
import type { Vie } from "./vie.ts";

export interface Dependances {
  vie: Vie;
  studio: Studio | null;
  /** Minutes de travail notées aujourd'hui, et l'objectif d'études (minutes). */
  travail: () => { aujourdhui: number; objectif: number };
  /** La séance de sport du jour, en clair (ou null). */
  seance: () => string | null;
  profil: () => string;
  /** Un texte écrit par Claude (sans outils), ou null. `schema` : réponse JSON. */
  rediger: (prompt: string, schema?: object) => Promise<string | null>;
  /** Max le dit, et écoute la réponse sans qu'il redise « Max ». `info` : ce que Max doit savoir de la réponse. */
  demander: (texte: string, info?: string) => void;
  dossier: string;
  maintenant?: () => Date;
}

const h = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}` : `${min} min`);

/** La loi suivante à faire : 1 + le plus grand numéro de « Loi N » déjà vu (vidéos et scripts). */
export function loiSuivante(titres: string[]): number {
  const n = titres.map((t) => Number(t.match(/\bloi\s*(\d+)/i)?.[1] ?? 0));
  return Math.max(0, ...n) + 1;
}

/** Dans lois.md, la ligne de la loi N (« 9. Titre — idée » ou « Loi 9 : … »), ou null. */
export function ligneLoi(texte: string, n: number): string | null {
  for (const l of texte.split("\n")) {
    const m = l.trim().match(/^(?:[-*]\s*)?(?:loi\s*)?(\d+)\s*[.:)\-–—]\s*(.+)$/i);
    if (m && Number(m[1]) === n) return m[2].trim();
  }
  return null;
}

const MODELE_LOIS = `# Les 48 lois — une par ligne
# Max s'en sert pour écrire tout seul, chaque matin, le script de la vidéo suivante.
# Format : numéro, point, titre, puis (facultatif) l'idée en quelques mots. Exemple :
# 1. Ne surpassez jamais le maître — en stage, on apprend avant de briller
`;

export const IDEES_SCHEMA = {
  type: "object",
  properties: { idees: { type: "array", items: { type: "object", properties: { titre: { type: "string" }, accroche: { type: "string" }, premierPas: { type: "string" } }, required: ["titre", "accroche", "premierPas"] } } },
  required: ["idees"],
};

export function lireIdeesDuJour(dossier: string, jour: string): IdeeDuJour[] | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dossier, "vie", "idees", `${jour}.json`), "utf8"));
  } catch {
    return null;
  }
}

export function automatismesDeMax(d: Dependances): AutomatismeDef[] {
  const maintenant = () => d.maintenant?.() ?? new Date();
  return [
    {
      id: "cap-matin",
      nom: "Cap du matin",
      description: "le cap du jour à l'écran : tes 3 prochaines actions, ta séance, la vidéo à poster",
      heure: "07:30",
      faire: async () => {
        const v = d.vie.vue();
        const pub = d.studio?.vue().prochaines[0];
        const morceaux = [
          v.focus.length ? `Cap : ${v.focus.map((p, i) => `${i + 1}) ${p.prochaineAction}`).join(" ")}` : "",
          d.seance() ? `Sport : ${d.seance()}` : "",
          pub ? `Vidéo : ${pub.titre} à ${pub.quand.slice(11)}` : "",
        ].filter(Boolean);
        return morceaux.length ? `☀️ ${morceaux.join(" · ")}` : null;
      },
    },
    {
      id: "script-video",
      nom: "Script vidéo",
      description: "écrit le script de la loi suivante d'Asclepium, prêt à lire dans Max Studio (iPhone compris)",
      heure: "09:00",
      faire: async () => {
        const st = d.studio;
        const dos = st?.dossierDe("asclepium", "scripts");
        if (!st || !dos) return null;
        const fichierLois = path.join(path.dirname(dos), "lois.md");
        if (!fs.existsSync(fichierLois)) {
          fs.mkdirSync(path.dirname(fichierLois), { recursive: true });
          fs.writeFileSync(fichierLois, MODELE_LOIS);
          return "📝 Pour que j'écrive tes scripts tout seul chaque matin, colle la liste de tes 48 lois dans Max Studio › Asclepium › lois.md (une par ligne).";
        }
        const n = loiSuivante(st.titres("asclepium"));
        const loi = ligneLoi(fs.readFileSync(fichierLois, "utf8"), n);
        if (!loi) return null; // pas encore dans la liste : rien à inventer
        const texte = await d.rediger(
          `Écris le script parlé d'une vidéo TikTok de 50 secondes (130 à 160 mots) pour le compte Asclepium, qui présente « Les 48 Lois pour réussir en médecine ».
Loi ${n} : ${loi}.
Structure : une première phrase qui accroche (question ou constat qui pique), la loi en une phrase, un exemple concret de la vie d'un étudiant en médecine (PASS, LAS, stages), une chute qui marque, puis « Loi ${n}. Le livre complet est en bio. »
Phrases courtes, à l'oral, ton lucide et sombre, sans emoji, sans titre ni indication de mise en scène : seulement le texte à dire.`,
        );
        if (!texte) return "⚠️ Script vidéo : Claude n'a pas répondu, je réessaierai demain.";
        const r = st.script("asclepium", `Loi ${n}`, texte.trim());
        return r.ok ? `✍️ Script « Loi ${n} » prêt dans Max Studio › Asclepium › scripts : lis-le et enregistre-toi.` : `⚠️ ${r.texte}`;
      },
    },
    {
      id: "idees-jour",
      nom: "Idées du jour",
      description: "3 idées de business IA pour toi (façon Muse), dans la fiche Business",
      heure: "12:30",
      faire: async () => {
        const jour = jourDe(maintenant());
        if (lireIdeesDuJour(d.dossier, jour)) return null;
        const brut = await d.rediger(
          `Propose 3 idées de business ou d'action concrètes, jamais vues, réalisables par cet étudiant avec l'IA, en peu de temps (il prépare un examen : chaque idée doit pouvoir avancer en 30 minutes par jour). Privilégie ce qui fait grandir ses projets en cours.
Son profil et ses projets :
${d.profil()}
${d.vie.decrire()}
Pour chaque idée : un titre court, une accroche d'une phrase, et le tout premier pas à faire aujourd'hui.`,
          IDEES_SCHEMA,
        );
        let idees: IdeeDuJour[] = [];
        try {
          idees = (JSON.parse(brut ?? "") as { idees: IdeeDuJour[] }).idees.slice(0, 3);
        } catch {
          return "⚠️ Idées du jour : réponse illisible, je réessaierai demain.";
        }
        const dos = path.join(d.dossier, "vie", "idees");
        fs.mkdirSync(dos, { recursive: true });
        fs.writeFileSync(path.join(dos, `${jour}.json`), JSON.stringify(idees, null, 2));
        return `💡 ${idees.length} idées du jour dans la fiche Business : ${idees.map((i) => i.titre).join(" · ")}`;
      },
    },
    {
      id: "relance-etudes",
      nom: "Relance études",
      description: "à 15 h, si tu es loin de ton objectif de PASS, Max te propose une session",
      heure: "15:00",
      faire: async () => {
        const t = d.travail();
        if (!t.objectif || t.aujourdhui >= t.objectif * 0.4) return null;
        const texte = `Il est 15 heures : ${t.aujourdhui ? `${h(t.aujourdhui)} de travail` : "pas encore de travail"} aujourd'hui. On lance 50 minutes ?`;
        d.demander(texte, "Il répond à ta relance de 15 h : s'il dit oui, lance demarrer_session (50 minutes, pôle etudes) sur le sujet qu'il dit ou sa priorité.");
        return `⏱ ${texte}`;
      },
    },
    {
      id: "bilan-soir",
      nom: "Bilan du soir",
      description: "à 21 h 30, Max te demande ta journée et l'écrit dans ton journal",
      heure: "21:30",
      faire: async () => {
        if (d.vie.vue().journal?.bilan) return null;
        d.demander(
          "C'est l'heure du bilan. Qu'est-ce qui a marché aujourd'hui ?",
          "Il répond au bilan du soir : écoute, demande en une question ce qui coince pour demain et son humeur sur 5, puis ecrire_journal avec bilan true. Puis mets à jour les prochaines actions de ses projets si besoin.",
        );
        return "🌙 Bilan du soir lancé.";
      },
    },
    {
      id: "revue-semaine",
      nom: "Revue de la semaine",
      description: "le dimanche à 18 h, le résumé de ta semaine (journal, projets) et le cap de la suivante",
      heure: "18:00",
      jours: [0],
      faire: async () => {
        const journal = d.vie
          .journal(7)
          .map((j) => `${j.jour}${j.humeur ? ` (humeur ${j.humeur}/5)` : ""} : ${j.notes.map((n) => n.texte).join(" ; ")}${j.bilan ? ` — bilan : ${j.bilan}` : ""}`)
          .join("\n");
        const texte = await d.rediger(
          `Fais la revue de la semaine de cet étudiant, en français, en 8 lignes maximum : ce qui a avancé, ce qui coince (tendances du journal, fatigue, retards), et les 3 priorités de la semaine prochaine, concrètes.
${d.vie.decrire()}
Journal de la semaine :
${journal || "(vide)"}`,
        );
        if (!texte) return null;
        const dos = path.join(d.dossier, "vie", "revues");
        fs.mkdirSync(dos, { recursive: true });
        fs.writeFileSync(path.join(dos, `${jourDe(maintenant())}.md`), texte.trim() + "\n");
        d.vie.ecrire(`Revue de la semaine : ${texte.trim().slice(0, 1500)}`);
        return `📊 Revue de la semaine écrite dans ton journal.`;
      },
    },
  ];
}

/** Claude sans outils, pour écrire un texte (ou du JSON avec `schema`). */
export function redacteur(o: { bin: string; modele: string; dossier: string }) {
  return async (prompt: string, schema?: object): Promise<string | null> => {
    const args = ["-p", prompt, "--model", o.modele, "--output-format", "json", ...(schema ? ["--json-schema", JSON.stringify(schema)] : []), "--strict-mcp-config", "--permission-mode", "default", "--tools", ""];
    const r = await runAgent({ bin: o.bin, args, cwd: o.dossier, timeoutMs: 4 * 60_000, mode: "json" }).done;
    if (!r.ok) return null;
    return schema && r.structured ? JSON.stringify(r.structured) : r.texte;
  };
}
