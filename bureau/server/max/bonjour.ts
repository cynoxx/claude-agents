// Ce que Max dit en premier, à l'ouverture : il salue Johan, prend de ses nouvelles, et pose sa journée en deux ou trois phrases.
// Construit ici, sans le cerveau : la phrase part tout de suite, même si Claude met du temps à démarrer.
import { examensProches, type Echeance } from "./coach.ts";

export interface Journee {
  maintenant: Date;
  /** Les échéances de moi.md à venir, de la plus proche à la plus lointaine. */
  echeances: Echeance[];
  /** La phrase du sport (« Côté sport, aujourd'hui c'est … »), vide un jour de repos. */
  sport?: string;
  /** La session de travail en cours, s'il y en a une. */
  session?: string;
  /** Comment il l'appelle (son prénom quand la caméra l'a reconnu) ; « chef » sinon. */
  nom?: string;
  /** Minutes déjà travaillées aujourd'hui. */
  travail?: number;
}

/** Au-delà, une échéance n'est pas rappelée au bonjour : elle est à l'écran. */
const JOURS_RAPPEL = 14;

const quand = (j: number) => (j === 0 ? "aujourd'hui" : j === 1 ? "demain" : `dans ${j} jours`);

function salutation(h: number, nom: string): string {
  if (h >= 22 || h < 5) return `Salut ${nom}. Il est tard : comment tu vas ?`;
  if (h >= 18) return `Bonsoir ${nom}, comment tu vas ?`;
  return `Salut ${nom}, comment tu vas ?`;
}

function duree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} minutes`;
}

export function bonjour(j: Journee): string {
  const jour = j.maintenant.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const phrases = [salutation(j.maintenant.getHours(), j.nom || "chef"), `Aujourd'hui, on est ${jour}.`];

  const examen = examensProches(j.echeances)[0];
  if (examen) {
    phrases.push(
      examen.jours === 0
        ? `C'est le jour J : ${examen.nom}. Tu es prêt, on garde la tête froide.`
        : `${examen.nom}, ${quand(examen.jours)} : c'est la priorité, tout le reste attend.`,
    );
  } else {
    const e = j.echeances.find((x) => x.jours <= JOURS_RAPPEL);
    if (e) phrases.push(`Prochaine échéance : ${e.nom}, ${quand(e.jours)}.`);
  }

  if (j.session) phrases.push(`Ta session « ${j.session} » tourne toujours.`);
  else if (j.travail) phrases.push(`Tu as déjà ${duree(j.travail)} de travail aujourd'hui.`);
  if (j.sport) phrases.push(j.sport);

  phrases.push(j.session ? "Je t'écoute." : "On commence par quoi ?");
  return phrases.join(" ");
}
