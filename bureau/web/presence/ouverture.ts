// L'ouverture de Max (environ 6 secondes, 2 secondes s'il a déjà été ouvert aujourd'hui) :
// le noir, un point de lumière qui respire, une ligne qui s'ouvre de part et d'autre, « MAX » qui s'écrit,
// ses organes qui s'allument (voix, oreille, cerveau, avec leur état réel), ton bonjour et la date.
// Puis la lumière se ramasse en un point, éclate, et l'écran s'ouvre en cercle : Max se forme, les cartes arrivent.
// Pas de son ici : la musique d'ouverture est jouée par le Mac.
import type { EtatBureau } from "../../shared/protocol.ts";
import { introAJouer } from "../intro.ts";
import { convergence } from "../eclat.ts";
import { dureeOuverture, salutOuverture } from "./presence-pur.ts";

const CLE_JOUR = "max-ouverture-jour";
const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function lireJour(): string | null {
  try {
    return localStorage.getItem(CLE_JOUR);
  } catch {
    return null;
  }
}
function noterJour(j: string): void {
  try {
    localStorage.setItem(CLE_JOUR, j);
  } catch {
    // navigation privée : l'ouverture sera longue à chaque fois, ce n'est pas grave
  }
}
const jourDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export class Ouverture {
  private jouee = 0;
  private el: HTMLElement;
  private minuteries: number[] = [];

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "ouv";
    this.el.hidden = true;
    this.el.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.el);
    // un clic passe l'ouverture
    this.el.addEventListener("click", () => this.finir());
  }

  rendre(e: EtatBureau): void {
    if (!introAJouer(e.intro, this.jouee)) return;
    this.jouee = e.intro!;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.dispatchEvent(new Event("max-apparait"));
      return;
    }
    // juste après la reconnaissance du visage, on laisse finir « Accès autorisé »
    const quandLibre = (essais = 0) => {
      const verrou = document.getElementById("verrou");
      if (verrou && !verrou.hidden && essais < 40) window.setTimeout(() => quandLibre(essais + 1), 150);
      else this.jouer(e);
    };
    quandLibre();
  }

  private plus(ms: number, f: () => void): void {
    this.minuteries.push(window.setTimeout(f, ms));
  }

  private jouer(e: EtatBureau): void {
    const maintenant = new Date();
    const aujourdhui = jourDe(maintenant);
    const longue = dureeOuverture(lireJour(), aujourdhui) === "longue";
    noterJour(aujourdhui);
    const a = e.assistant;
    const organes = [
      { nom: "Voix", ok: a?.bouche.ok ?? false },
      { nom: "Oreille", ok: a?.oreille.ok ?? false },
      { nom: "Cerveau", ok: e.claude.ok },
    ];
    const date = maintenant.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    this.el.innerHTML = `
<div class="ouv-point"></div>
<div class="ouv-ligne"></div>
<div class="ouv-titre">${[..."MAX"].map((c, i) => `<span style="--i:${i}">${c}</span>`).join("")}</div>
<ul class="ouv-organes">${organes.map((o, i) => `<li style="--i:${i}" class="${o.ok ? "ok" : "ko"}"><i></i>${o.nom}</li>`).join("")}</ul>
<p class="ouv-salut">${echapper(salutOuverture(maintenant, e.verrou?.prenom ?? ""))}<small>${echapper(date)}</small></p>
<div class="ouv-flash"></div>`;
    for (const t of this.minuteries) clearTimeout(t);
    this.minuteries = [];
    this.el.hidden = false;
    this.el.className = `ouv ${longue ? "longue" : "courte"}`;
    document.body.dataset.intro = "oui";
    void this.el.offsetWidth;
    this.el.classList.add("joue");

    if (longue) {
      // la lumière converge pour écrire le nom
      this.plus(1500, () => {
        const t = this.el.querySelector<HTMLElement>(".ouv-titre")!.getBoundingClientRect();
        convergence({ x: t.x, y: t.y, l: t.width, h: t.height }, 700, 260);
      });
      this.plus(4700, () => this.el.classList.add("ramasse"));
      this.plus(5300, () => this.finir());
    } else {
      this.plus(900, () => this.el.classList.add("ramasse"));
      this.plus(1400, () => this.finir());
    }
  }

  /** La lumière éclate, l'écran s'ouvre en cercle depuis le centre, Max se forme et les cartes arrivent. */
  private finir(): void {
    if (this.el.hidden || this.el.classList.contains("sort")) return;
    for (const t of this.minuteries) clearTimeout(t);
    this.minuteries = [];
    this.el.classList.add("sort");
    delete document.body.dataset.intro;
    const jarvis = document.getElementById("jarvis")!;
    jarvis.classList.remove("pr-arrive");
    void jarvis.offsetWidth;
    jarvis.classList.add("pr-arrive");
    window.dispatchEvent(new Event("max-apparait"));
    window.setTimeout(() => {
      this.el.hidden = true;
      this.el.className = "ouv";
    }, 1100);
    window.setTimeout(() => jarvis.classList.remove("pr-arrive"), 2600);
  }
}
