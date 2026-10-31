// Les fenêtres du Système (façon jeu : un Joueur, des stats, des quêtes), faites avec tes vraies données :
// le niveau vient de tes minutes de travail, les stats de ton sport, de tes heures d'études et de tes journées tenues.
import type { EtatBureau } from "../shared/protocol.ts";
import { niveau } from "../shared/niveau.ts";

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Stats {
  /** Force : séances de sport sur 30 jours. */
  FOR: number;
  /** Intelligence : heures d'études sur 7 jours. */
  INT: number;
  /** Vitalité : journées d'affilée avec les 3 règles tenues. */
  VIT: number;
  /** Persévérance : jours d'affilée avec au moins une session de travail. */
  PER: number;
}

export function statsJoueur(e: Pick<EtatBureau, "sport" | "poles" | "plan" | "assistant">): Stats {
  const etudes = e.poles?.find((p) => p.id === "etudes");
  return {
    FOR: e.sport?.seances30 ?? 0,
    INT: Math.round((etudes?.semaine ?? 0) / 60),
    VIT: e.plan?.serie ?? 0,
    PER: e.assistant?.coach?.serie ?? 0,
  };
}

/** Le titre du Joueur, gagné en tenant ses journées. */
export function titreJoueur(s: Stats): string {
  if (s.VIT >= 21) return "Le Monarque de la discipline";
  if (s.VIT >= 7) return "Celui qui tient parole";
  if (s.VIT >= 3) return "L'Éveillé";
  if (s.PER >= 1 || s.VIT >= 1) return "Le Joueur qui se relève";
  return "Nouveau Joueur";
}

/** La fenêtre STATUT. */
export function htmlStatut(e: EtatBureau): string {
  const n = niveau(e.assistant?.coach?.total ?? 0);
  const s = statsJoueur(e);
  const pct = Math.round((n.xp / n.prochain) * 100);
  const nom = (e.verrou?.prenom || "Joueur").toUpperCase();
  return `<h3>Statut</h3>
<div class="ss-tete"><div><small>NOM</small><b>${echapper(nom)}</b></div><div class="ss-niv"><small>NIVEAU</small><b>${n.niveau}</b></div></div>
<p class="ss-ligne"><small>CLASSE</small> Étudiant en médecine</p>
<p class="ss-ligne"><small>TITRE</small> ${echapper(titreJoueur(s))}</p>
<div class="ss-xp" title="${n.xp} / ${n.prochain} XP (1 minute de travail = 1 XP)"><i style="width:${pct}%"></i><span>XP ${n.xp} / ${n.prochain}</span></div>
<ul class="ss-stats">${(Object.keys(s) as (keyof Stats)[]).map((k) => `<li title="${TITRES[k]}"><small>${k}</small><b>${s[k]}</b></li>`).join("")}</ul>`;
}

const TITRES: Record<keyof Stats, string> = {
  FOR: "Force : tes séances de sport sur 30 jours",
  INT: "Intelligence : tes heures d'études sur 7 jours",
  VIT: "Vitalité : tes journées d'affilée avec les 3 règles tenues",
  PER: "Persévérance : tes jours d'affilée avec au moins une session",
};
