// L'écran « Présence » : ce qui entoure Max, calculé à partir de l'état du Bureau (testé, sans DOM).
// Trois informations au plus autour de lui : la mission du jour, l'échéance, et une carte du moment.
import type { EtatBureau, EtatMax, PlanVue, TempsPole } from "../../shared/protocol.ts";
import { SEANCES } from "../../shared/sport.ts";

/** Un bloc d'études compte 50 minutes. */
export const MINUTES_BLOC = 50;
const PHASES_EN_COURS = new Set(["planification", "travail", "relecture", "pause"]);
const MOT_EXAMEN = /partiel|examen|concours|contr[ôo]le|\bds\b|rattrapage|[ée]preuve|oral\b/i;

export function duree(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}` : `${m} min`;
}

/** Le petit mot au-dessus de Max : ce qu'il fait, sans phrase. */
export const MOT_ETAT: Record<EtatMax, string> = {
  veille: "en veille · dis « Max »",
  ecoute: "il t'écoute",
  reflechit: "il réfléchit",
  parle: "il te parle",
};

export interface Ligne {
  gauche: string;
  droite: string;
}

export interface CarteMission {
  titre: string;
  sous: string;
  /** Les blocs du jour : combien sont faits sur combien (null s'il n'y a pas d'objectif). */
  blocs: { faits: number; total: number } | null;
  lignes: Ligne[];
}

const minutesDe = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** La mission du jour : ce qu'il fait maintenant (session, créneau), les blocs d'études, et la suite. */
export function carteMission(e: EtatBureau, maintenant = new Date()): CarteMission {
  const coach = e.assistant?.coach;
  const p = e.planning;
  const etudes = e.poles?.find((x) => x.id === "etudes");
  const total = e.plan?.blocs ?? (etudes?.objectif ? Math.round(etudes.objectif / MINUTES_BLOC) : 0);
  const faits = Math.floor((etudes?.aujourdhui ?? coach?.aujourdhui ?? 0) / MINUTES_BLOC);
  const enCours = p && p.enCours >= 0 ? p.creneaux[p.enCours] : null;

  let titre = total ? `${total} blocs d'études` : "Ta journée";
  let sous = "";
  if (coach?.minuteur?.type === "travail") {
    titre = coach.minuteur.sujet;
    sous = "Session en cours";
  } else if (enCours) {
    titre = enCours.titre;
    sous = `En cours, jusqu'à ${enCours.fin}`;
  } else if (total) {
    sous = faits >= total ? "Objectif du jour atteint" : `Bloc ${Math.min(total, faits + 1)} à lancer`;
  } else {
    sous = "Dis « Max, on fait ma journée »";
  }

  const lignes: Ligne[] = [];
  const maint = maintenant.getHours() * 60 + maintenant.getMinutes();
  if (p) {
    const suivant = p.creneaux.find((c, i) => i > p.enCours && minutesDe(c.debut) >= maint);
    if (suivant) lignes.push({ gauche: suivant.titre, droite: suivant.debut });
  } else {
    const rdv = (e.jarvis?.agenda ?? []).find((r) => r.heure && minutesDe(r.heure) >= maint);
    if (rdv) lignes.push({ gauche: rdv.titre, droite: rdv.heure });
  }
  if (etudes?.objectif) lignes.push({ gauche: "Études aujourd'hui", droite: `${duree(etudes.aujourdhui)} / ${duree(etudes.objectif)}` });
  else if (coach?.aujourdhui) lignes.push({ gauche: "Travail aujourd'hui", droite: duree(coach.aujourdhui) });
  const reveil = e.plan?.reveilDemain || (e.reveil?.configure ? e.reveil.heure : "");
  if (reveil) lignes.push({ gauche: "Réveil demain", droite: reveil });

  return { titre, sous, blocs: total ? { faits: Math.min(faits, total), total } : null, lignes: lignes.slice(0, 3) };
}

export interface CarteEcheance {
  grand: string;
  nom: string;
  sous: string;
  /** Un examen dans les 7 jours : la carte passe en braise. */
  urgent: boolean;
}

/** L'échéance la plus proche, en grand (J-2), en braise si c'est un examen dans la semaine. */
export function carteEcheance(e: EtatBureau): CarteEcheance | null {
  const ech = e.assistant?.coach?.echeance;
  if (!ech) return null;
  const j = ech.jours;
  return {
    grand: j === 0 ? "JOUR J" : `J-${j}`,
    nom: ech.nom,
    sous: j === 0 ? "aujourd'hui" : j === 1 ? "demain" : `dans ${j} jours`,
    urgent: j <= 7 && MOT_EXAMEN.test(ech.nom),
  };
}

export interface CarteMoment {
  etiquette: string;
  titre: string;
  sous: string;
  ton: "froid" | "braise" | "or";
  /** Les boutons de la sanction. */
  sanction?: boolean;
  /** Un clic emmène au Bureau (l'équipe au travail). */
  bureau?: boolean;
}

/** La troisième carte, seulement quand il se passe quelque chose : une sanction, l'équipe au travail, des mails, la séance. */
export function carteMoment(e: EtatBureau): CarteMoment | null {
  const s = e.plan?.sanction;
  if (s?.statut === "en-cours") {
    return { etiquette: "Sanction en cours", titre: s.texte.replace(/^Zone de pénalité\s*:\s*/i, ""), sous: s.motif.length ? `Hier : ${s.motif.length} règle${s.motif.length > 1 ? "s" : ""} non tenue${s.motif.length > 1 ? "s" : ""}.` : "", ton: "braise", sanction: true };
  }
  const m = e.mission;
  if (m && PHASES_EN_COURS.has(m.phase)) {
    return { etiquette: "L'équipe travaille", titre: m.titre, sous: `${m.robots.length} robot${m.robots.length > 1 ? "s" : ""} · étape ${m.etape}/${m.totalEtapes}`, ton: "froid", bureau: true };
  }
  const mails = e.mails?.categories.find((c) => c.id === "a_traiter")?.mails.length ?? 0;
  if (mails) return { etiquette: "Mails à traiter", titre: `${mails} mail${mails > 1 ? "s" : ""}`, sous: e.mails!.resume, ton: "froid" };
  if (e.plan && regles(e.plan).every((r) => r.tenue)) return { etiquette: "Quête du jour", titre: "Les 3 règles sont tenues", sous: "Bravo. Max le note.", ton: "or" };
  const sp = e.sport;
  if (sp && sp.prevue !== "repos") {
    const seance = SEANCES.find((x) => x.id === (sp.faite ?? sp.prevue));
    if (seance) return { etiquette: "Séance du jour", titre: seance.nom, sous: sp.faite ? "Faite. Bien joué." : "Pas encore faite.", ton: sp.faite ? "or" : "froid" };
  }
  return null;
}

/** Les règles du jour, cochées ou non. */
export function regles(p: PlanVue): { id: string; texte: string; tenue: boolean }[] {
  return p.regles.map((r) => ({ id: r.id, texte: r.texte, tenue: !!p.aujourdhui[r.id] }));
}

/** Le nom d'un pôle à l'écran : les études s'appellent MT2E. */
export function nomPole(id: string, domaine: string): string {
  return id === "etudes" ? "MT2E" : domaine;
}

export interface Pole {
  id: string;
  nom: string;
  emoji: string;
  /** Avancement de la semaine, de 0 à 1. */
  avance: number;
  ligne: string;
  ton: "froid" | "braise" | "or";
}

/** Objectif de la semaine d'un pôle, en minutes (7 fois l'objectif du jour, ou une semaine de travail raisonnable). */
function objectifSemaine(t: TempsPole | undefined): number {
  if (!t) return 0;
  if (t.objectif) return t.objectif * 7;
  if (t.limite) return t.limite * 7;
  return 0;
}

/** Les pôles de sa vie, pour la salle du Bureau : l'arc dit l'avancement de la semaine. */
export function poles(e: EtatBureau): Pole[] {
  const ech = carteEcheance(e);
  return (e.conseillers ?? []).map((c) => {
    const t = e.poles?.find((x) => x.id === c.id);
    const obj = objectifSemaine(t);
    let avance = obj ? Math.min(1, (t?.semaine ?? 0) / obj) : 0;
    let ligne = t?.aujourdhui ? `${duree(t.aujourdhui)} aujourd'hui` : t?.semaine ? `${duree(t.semaine)} cette semaine` : "Rien cette semaine";
    let ton: Pole["ton"] = "froid";
    if (c.id === "etudes" && ech?.urgent) {
      ligne = `${ech.nom} · ${ech.grand}`;
      ton = "braise";
    }
    if (c.id === "sante" && e.sport) {
      const faites = e.sport.cetteSemaine.filter((j) => j.faite && j.faite !== "repos").length;
      const prevues = e.sport.cetteSemaine.filter((j) => j.prevue !== "repos").length;
      if (prevues) avance = Math.min(1, faites / prevues);
      ligne = `${faites}/${prevues} séances`;
      if (prevues && faites >= prevues) ton = "or";
    }
    if (t?.limite && t.aujourdhui > t.limite) {
      ligne = `Limite dépassée : ${duree(t.aujourdhui)}`;
      ton = "braise";
    }
    return { id: c.id, nom: nomPole(c.id, c.domaine), emoji: c.emoji, avance, ligne, ton };
  });
}

/** Le chemin SVG d'un arc de cercle (centre 50,50), de midi dans le sens des aiguilles, sur une part de 0 à 1. */
export function arc(part: number, rayon = 42): string {
  const p = Math.max(0, Math.min(0.9999, part));
  if (p <= 0) return "";
  const a = p * Math.PI * 2;
  const x = 50 + rayon * Math.sin(a);
  const y = 50 - rayon * Math.cos(a);
  return `M 50 ${50 - rayon} A ${rayon} ${rayon} 0 ${p > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

/** L'ouverture : la version longue au premier lancement du jour, une courte ensuite. */
export function dureeOuverture(dernierJour: string | null, aujourdhui: string): "longue" | "courte" {
  return dernierJour === aujourdhui ? "courte" : "longue";
}

/** Le bonjour écrit pendant l'ouverture. */
export function salutOuverture(maintenant: Date, prenom = ""): string {
  const h = maintenant.getHours();
  const qui = prenom || "chef";
  return h >= 18 || h < 5 ? `Bonsoir ${qui}` : `Bonjour ${qui}`;
}
