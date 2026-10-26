// Le panneau de conversation avec Max : voyant, messages, champ pour lui écrire, boutons réveil / veille / tais-toi.
import type { AssistantVue, ClientMessage, EtatMax } from "../shared/protocol.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const VOYANTS: Record<EtatMax, string> = {
  veille: "😴 Max dort",
  ecoute: "👂 Max écoute — commence ta phrase par « Max »",
  reflechit: "💭 Max réfléchit…",
  parle: "🗣 Max parle",
};

const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export class Conversation {
  private derniere = "";
  private etat: EtatMax = "veille";

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
