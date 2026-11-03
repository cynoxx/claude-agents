// Le panneau de conversation avec Max : voyant, messages, champ pour lui écrire, boutons réveil / veille / tais-toi.
import type { AssistantVue, ClientMessage, CoachVue, EtatMax } from "../shared/protocol.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const VOYANTS: Record<EtatMax, string> = {
  veille: "😴 Max dort",
  ecoute: "👂 Max écoute — commence ta phrase par « Max »",
  reflechit: "💭 Max réfléchit…",
  parle: "🗣 Max parle",
};

/** « 1 h 15 », « 45 min », « rien encore ». */
export function dureeCourte(minutes: number): string {
  if (minutes <= 0) return "rien encore";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}

/** Le temps restant d'un minuteur, « 18:32 ». */
export function restant(finIso: string, maintenant = Date.now()): string {
  const s = Math.max(0, Math.round((Date.parse(finIso) - maintenant) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export class Conversation {
  private derniere = "";
  private etat: EtatMax = "veille";
  private coach?: CoachVue;

  constructor(private envoyer: (m: ClientMessage) => void) {
    const form = $<HTMLFormElement>("form-max");
    const champ = $<HTMLInputElement>("texte-max");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const texte = champ.value.trim();
      if (!texte) return;
      this.envoyer({ type: "parler-max", texte });
      champ.value = "";
    });
    $("btn-reveil").addEventListener("click", () => this.envoyer({ type: this.etat === "veille" ? "reveil" : "veille" }));
    $("btn-taire").addEventListener("click", () => this.envoyer({ type: "taire" }));
    $("btn-session").addEventListener("click", () => this.envoyer({ type: "session", minutes: 25 }));
    $("btn-fin-session").addEventListener("click", () => this.envoyer({ type: "fin-session" }));
    setInterval(() => this.rendreMinuteur(), 1000);
  }

  private rendreCoach(c: CoachVue | undefined): void {
    this.coach = c;
    document.querySelector<HTMLElement>(".coach")!.hidden = !c;
    if (!c) return;
    $("coach-jour").textContent = `📚 Aujourd'hui : ${dureeCourte(c.aujourdhui)}`;
    const e = $("coach-echeance");
    e.hidden = !c.echeance;
    e.textContent = c.echeance ? `📅 ${c.echeance.jours === 0 ? "Aujourd'hui" : `J-${c.echeance.jours}`} · ${c.echeance.nom}` : "";
    $("btn-session").hidden = c.minuteur?.type === "travail";
    $("btn-fin-session").hidden = !c.minuteur;
    this.rendreMinuteur();
  }

  private rendreMinuteur(): void {
    const m = this.coach?.minuteur;
    const el = $("coach-minuteur");
    el.hidden = !m;
    if (!m) return;
    el.dataset.type = m.type;
    el.textContent = m.type === "travail" ? `⏱ ${m.sujet} · ${restant(m.fin)}` : `☕ Pause · ${restant(m.fin)}`;
  }

  rendre(vue: AssistantVue | undefined): void {
    $("conversation").hidden = !vue;
    if (!vue) return;
    this.etat = vue.etat;
    const voyant = $("voyant");
    voyant.textContent = VOYANTS[vue.etat];
    voyant.dataset.etat = vue.etat;
    $("btn-reveil").textContent = vue.etat === "veille" ? "👂 Réveiller Max" : "😴 Mettre en veille";
    $("btn-taire").hidden = vue.etat !== "parle" && vue.etat !== "reflechit";

    const soucis = [vue.oreille, vue.bouche, vue.cerveau].filter((d) => !d.ok && d.detail).map((d) => `⚠️ ${d.detail}`);
    $("organes").textContent = soucis.join(" · ");
    this.rendreCoach(vue.coach);

    const signature = `${vue.messages.length}|${vue.messages.at(-1)?.heure ?? ""}|${vue.messages.at(-1)?.texte ?? ""}`;
    if (signature === this.derniere) return;
    this.derniere = signature;
    const liste = $<HTMLOListElement>("messages");
    const enBas = liste.scrollTop + liste.clientHeight >= liste.scrollHeight - 30;
    liste.replaceChildren(
      ...vue.messages.map((m) => {
        const li = document.createElement("li");
        li.className = `de-${m.de}`;
        const qui = document.createElement("span");
        qui.className = "qui";
        qui.textContent = m.de === "toi" ? "Toi" : m.de === "max" ? "👑 Max" : "Bureau";
        const quand = document.createElement("time");
        quand.textContent = heure(m.heure);
        const texte = document.createElement("p");
        texte.textContent = m.texte;
        li.append(qui, quand, texte);
        return li;
      }),
    );
    if (enBas) liste.scrollTop = liste.scrollHeight;
  }
}
