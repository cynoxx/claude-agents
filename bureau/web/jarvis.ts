// L'écran Jarvis : la sphère de Max au centre, ce qu'il dit, et autour l'heure, la météo, l'agenda du jour,
// le travail du jour, la mission en cours. « Max, emmène-moi au bureau » zoome dans la sphère jusqu'au bureau.
import type { AssistantVue, ClientMessage, EtatBureau, EtatMax, VueEcran } from "../shared/protocol.ts";
import { dureeCourte, restant } from "./conversation.ts";
import { Sphere } from "./sphere.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATUTS: Record<EtatMax, string> = {
  veille: "En veille",
  ecoute: "À l'écoute — dis « Max, … »",
  reflechit: "Réfléchit…",
  parle: "Parle",
};

const PHASES_EN_COURS = new Set(["planification", "travail", "relecture", "pause"]);

/** Ce que l'écran affiche en grand : la phrase qu'il prononce, sinon sa dernière réponse (raccourcie). */
export function textePrincipal(a: AssistantVue | undefined): string {
  if (!a) return "";
  if (a.phrase) return a.phrase;
  const dernier = [...a.messages].reverse().find((m) => m.de === "max");
  if (!dernier) return "";
  return dernier.texte.length > 240 ? dernier.texte.slice(0, 239).trimEnd() + "…" : dernier.texte;
}

/** Ta dernière phrase, si elle est plus récente que la dernière réponse de Max. */
export function texteToi(a: AssistantVue | undefined): string {
  if (!a) return "";
  const i = a.messages.map((m) => m.de).lastIndexOf("toi");
  const j = a.messages.map((m) => m.de).lastIndexOf("max");
  return i > j ? a.messages[i].texte : "";
}

/** Les rendez-vous encore à venir (ou en cours depuis moins d'une heure), les journées entières en premier. */
export function prochainsRdv(agenda: { heure: string; titre: string }[], maintenant: Date): { heure: string; titre: string }[] {
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  return agenda.filter((e) => {
    if (!e.heure) return true;
    const [h, m] = e.heure.split(":").map(Number);
    return h * 60 + m >= minutes - 60;
  });
}

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class Jarvis {
  private sphere: Sphere;
  private vue: VueEcran = "jarvis";
  private etat?: EtatBureau;

  constructor(private envoyer: (m: ClientMessage) => void) {
    this.sphere = new Sphere($<HTMLCanvasElement>("sphere"));
    this.sphere.demarrer();
    $<HTMLFormElement>("j-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const champ = $<HTMLInputElement>("j-texte");
      const t = champ.value.trim();
      if (!t) return;
      this.envoyer({ type: "parler-max", texte: t });
      champ.value = "";
    });
    $("j-bureau").addEventListener("click", () => this.envoyer({ type: "vue", vue: "bureau" }));
    $("j-mission").addEventListener("click", () => this.envoyer({ type: "vue", vue: "bureau" }));
    $("btn-jarvis").addEventListener("click", () => this.envoyer({ type: "vue", vue: "jarvis" }));
    $("j-reveil").addEventListener("click", () => this.envoyer({ type: this.etat?.assistant?.etat === "veille" ? "reveil" : "veille" }));
    this.horloge();
    setInterval(() => this.horloge(), 1000);
  }

  rendre(etat: EtatBureau): void {
    this.etat = etat;
    const a = etat.assistant;
    this.changerVue(a?.vue ?? "jarvis");
    const e = a?.etat ?? "veille";
    this.sphere.etat(e);
    $("j-statut").textContent = STATUTS[e];
    $("j-statut").dataset.etat = e;
    $("j-reveil").textContent = e === "veille" ? "👂 Réveiller" : "😴 Veille";
    $("j-dit").textContent = textePrincipal(a) || (e === "veille" ? "Dis « Dis Siri, Max au rapport » ou clique sur Réveiller." : "Je t'écoute.");
    const toi = texteToi(a);
    $("j-toi").textContent = toi ? `« ${toi} »` : "";
    const soucis = a ? [a.oreille, a.bouche, a.cerveau].filter((d) => !d.ok && d.detail).map((d) => `⚠️ ${d.detail}`) : [];
    $("j-soucis").textContent = soucis.join(" · ");

    // panneaux
    const j = etat.jarvis;
    $("j-meteo").textContent = j?.meteo ?? "—";
    const agenda = $("j-agenda");
    if (!j?.agenda) agenda.innerHTML = `<li class="vide">Agenda indisponible</li>`;
    else {
      const rdv = prochainsRdv(j.agenda, new Date()).slice(0, 5);
      agenda.innerHTML = rdv.length
        ? rdv.map((r) => `<li><span>${echapper(r.heure || "Journée")}</span> ${echapper(r.titre)}</li>`).join("")
        : `<li class="vide">Rien d'autre aujourd'hui</li>`;
    }
    const c = a?.coach;
    $("j-echeance").textContent = c?.echeance ? `${c.echeance.jours === 0 ? "Aujourd'hui" : `J-${c.echeance.jours}`} · ${c.echeance.nom}` : "Aucune échéance";
    $("j-travail").textContent = c ? `Travail aujourd'hui : ${dureeCourte(c.aujourdhui)}` : "";
    this.minuteur();

    const m = etat.mission;
    const mission = $("j-mission");
    mission.hidden = !(m && PHASES_EN_COURS.has(m.phase));
    if (m) mission.innerHTML = `🛠 <strong>${echapper(m.titre)}</strong><br><span>${m.robots.length} robot${m.robots.length > 1 ? "s" : ""} au travail · voir l'équipe →</span>`;
    const pensent = (etat.conseillers ?? []).filter((x) => x.statut === "reflechit");
    $("j-conseillers").textContent = pensent.map((x) => `${x.emoji} ${x.nom} réfléchit…`).join("  ");
  }

  private minuteur(): void {
    const m = this.etat?.assistant?.coach?.minuteur;
    const el = $("j-minuteur");
    el.hidden = !m;
    if (m) el.textContent = m.type === "travail" ? `⏱ ${m.sujet} · ${restant(m.fin)}` : `☕ Pause · ${restant(m.fin)}`;
  }

  private horloge(): void {
    const d = new Date();
    $("j-heure").textContent = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    $("j-date").textContent = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    this.minuteur();
  }

  /** Jarvis → bureau : on plonge dans la sphère ; bureau → Jarvis : la sphère revient. */
  private changerVue(v: VueEcran): void {
    if (v === this.vue) return;
    this.vue = v;
    const ecran = $("jarvis");
    if (v === "bureau") {
      ecran.classList.add("plonge");
      let z = 1;
      const grossir = () => {
        z *= 1.12;
        this.sphere.agrandir(z);
        if (z < 12 && this.vue === "bureau") requestAnimationFrame(grossir);
      };
      requestAnimationFrame(grossir);
      setTimeout(() => {
        if (this.vue !== "bureau") return;
        ecran.hidden = true;
        document.body.dataset.vue = "bureau";
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("zone-bureau"));
      }, 650);
    } else {
      this.sphere.agrandir(1);
      ecran.hidden = false;
      document.body.dataset.vue = "jarvis";
      ecran.classList.add("revient");
      requestAnimationFrame(() => {
        ecran.classList.remove("plonge");
        setTimeout(() => ecran.classList.remove("revient"), 500);
      });
    }
  }
}
