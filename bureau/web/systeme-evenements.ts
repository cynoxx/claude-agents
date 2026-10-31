// Les événements du Système, en plein écran comme dans le jeu : la quête quotidienne qui t'est attribuée (une fois
// par jour), « NIVEAU SUPÉRIEUR » quand ton niveau monte, « QUÊTE ACCOMPLIE » quand tes 3 règles et tes blocs sont
// faits ; et les nouvelles de Max (rappels, idées, scripts…) en notifications du Système, en haut à droite.
import type { EtatBureau } from "../shared/protocol.ts";
import { niveau } from "../shared/niveau.ts";
import { son } from "./sons.ts";

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lire = (cle: string) => {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
};
const ecrire = (cle: string, v: string) => {
  try {
    localStorage.setItem(cle, v);
  } catch {
    // navigation privée : ça vaut pour cette fois
  }
};
const jour = () => new Date().toLocaleDateString("sv-SE");

/** Ce qu'il faut annoncer, à partir de l'état (pur, testable). */
export function evenementsSysteme(
  e: Pick<EtatBureau, "assistant" | "plan">,
  memoire: { niveau: number | null; queteAttribuee: string | null; queteAccomplie: string | null; aujourdhui: string },
): ("attribution" | "niveau" | "accomplie")[] {
  const out: ("attribution" | "niveau" | "accomplie")[] = [];
  const a = e.assistant;
  if (!a || a.etat === "veille") return out;
  const n = niveau(a.coach?.total ?? 0).niveau;
  if (memoire.niveau !== null && n > memoire.niveau) out.push("niveau");
  const p = e.plan;
  if (p && memoire.queteAttribuee !== memoire.aujourdhui) out.push("attribution");
  const blocs = Math.floor((a.coach?.aujourdhui ?? 0) / 50);
  if (p && memoire.queteAccomplie !== memoire.aujourdhui && p.regles.every((r) => p.aujourdhui[r.id]) && blocs >= p.blocs) out.push("accomplie");
  return out;
}

export class EvenementsSysteme {
  private fond = document.createElement("div");
  private toasts = document.createElement("div");
  private file: (() => void)[] = [];
  private ouvert = false;
  private vuJusqua = "";
  private premier = true;

  constructor() {
    this.fond.className = "sys-pop-fond";
    this.fond.hidden = true;
    this.toasts.className = "sys-toasts";
    this.toasts.setAttribute("aria-live", "polite");
    document.body.append(this.fond, this.toasts);
  }

  rendre(e: EtatBureau): void {
    // pas pendant l'intro ni l'écran verrouillé
    if (document.querySelector(".sys-intro:not([hidden])") || e.verrou?.verrouille) return;
    const a = e.assistant;
    const n = niveau(a?.coach?.total ?? 0).niveau;
    const mem = { niveau: Number(lire("max-niveau") ?? NaN), queteAttribuee: lire("max-quete-attribuee"), queteAccomplie: lire("max-quete-accomplie"), aujourdhui: jour() };
    for (const ev of evenementsSysteme(e, { ...mem, niveau: Number.isNaN(mem.niveau) ? null : mem.niveau })) {
      if (ev === "niveau") this.annoncer(() => this.fenetre("NIVEAU SUPÉRIEUR", [`Niveau <strong>${n - 1}</strong> → <strong class="sys-gros">${n}</strong>`, "Chaque minute de travail compte."], "niveau"));
      if (ev === "attribution") {
        ecrire("max-quete-attribuee", mem.aujourdhui);
        const p = e.plan!;
        this.annoncer(() =>
          this.fenetre(
            "QUÊTE QUOTIDIENNE",
            [
              "Le Système t'attribue la quête du jour.",
              ...p.regles.map((r) => `<span class="sys-case"></span>${echapper(r.texte)}`),
              `<span class="sys-case"></span>Blocs de médecine (50 min) <b>[0/${p.blocs}]</b>`,
              `<small>Réveil de demain : ${p.reveilDemain.replace(":", " h ")} · aucune pénalité en cas d'échec.</small>`,
            ],
            "quete",
            "ACCEPTER",
          ),
        );
      }
      if (ev === "accomplie") {
        ecrire("max-quete-accomplie", mem.aujourdhui);
        this.annoncer(() => this.fenetre("QUÊTE ACCOMPLIE", ["Toutes les conditions de la quête quotidienne sont remplies.", "<strong>Une bonne journée, quoi qu'il arrive d'autre.</strong>"], "niveau"));
      }
    }
    ecrire("max-niveau", String(n));
    this.notifications(e);
  }

  /** Les nouvelles de Max (messages du Bureau) en notifications du Système. */
  private notifications(e: EtatBureau): void {
    const msgs = (e.assistant?.messages ?? []).filter((m) => m.de === "bureau");
    const dernier = msgs.at(-1)?.heure ?? "";
    if (this.premier) {
      // au chargement : on ne rejoue pas les anciennes
      this.premier = false;
      this.vuJusqua = dernier;
      return;
    }
    for (const m of msgs.filter((x) => x.heure > this.vuJusqua)) this.toast(m.texte);
    if (dernier > this.vuJusqua) this.vuJusqua = dernier;
  }

  private toast(texte: string): void {
    const t = document.createElement("div");
    t.className = "sys-toast";
    t.innerHTML = `<span class="sys-alerte">!</span><div><b>NOTIFICATION</b><p>${echapper(texte.replace(/^[^\p{L}\p{N}]+/u, ""))}</p></div>`;
    this.toasts.prepend(t);
    son("systeme", 0.05);
    while (this.toasts.children.length > 3) this.toasts.lastElementChild?.remove();
    window.setTimeout(() => {
      t.classList.add("part");
      window.setTimeout(() => t.remove(), 500);
    }, 7000);
  }

  private annoncer(f: () => void): void {
    this.file.push(f);
    if (!this.ouvert) this.suivante();
  }

  private suivante(): void {
    const f = this.file.shift();
    this.ouvert = !!f;
    if (f) f();
  }

  /** Une grande fenêtre du Système, au centre ; un clic (ou le bouton) la referme. */
  private fenetre(titre: string, lignes: string[], sonNom: "niveau" | "quete", bouton = "OK"): void {
    this.fond.innerHTML = `<div class="sys-pop">
  <div class="sys-tete"><span class="sys-alerte">!</span><span>${titre}</span></div>
  <div class="sys-pop-corps">${lignes.map((l) => `<p>${l}</p>`).join("")}</div>
  <button type="button" class="sys-pop-ok">${bouton}</button>
</div>`;
    this.fond.hidden = false;
    this.fond.classList.remove("sort");
    void this.fond.offsetWidth;
    this.fond.classList.add("ouvre");
    son(sonNom === "niveau" ? "quete" : "systeme", 0.08);
    const fermer = () => {
      this.fond.classList.add("sort");
      window.setTimeout(() => {
        this.fond.hidden = true;
        this.fond.classList.remove("ouvre", "sort");
        this.suivante();
      }, 450);
    };
    this.fond.querySelector("button")!.addEventListener("click", fermer, { once: true });
    this.fond.addEventListener("click", (ev) => ev.target === this.fond && fermer(), { once: true });
  }
}
