// Le HUD du bureau, façon jeu vidéo : niveau et XP (1 minute de travail = 1 XP), série de jours, prochaine
// échéance ; et la carte « ZONE : LE BUREAU » quand on arrive dans le bureau.
import type { CoachVue } from "../shared/protocol.ts";
import { niveau } from "../shared/niveau.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private niveauAffiche = 0;

  constructor() {
    window.addEventListener("zone-bureau", () => this.annoncerZone());
  }

  rendre(c: CoachVue | undefined): void {
    $("hud-joueur").hidden = !c;
    if (!c) return;
    const n = niveau(c.total);
    $("hud-niveau").textContent = String(n.niveau);
    const pourcent = Math.round((n.xp / n.prochain) * 100);
    $("hud-xp").style.width = `${pourcent}%`;
    $("hud-xp").parentElement!.setAttribute("aria-valuenow", String(pourcent));
    $("hud-xp-texte").textContent = `${n.xp} / ${n.prochain} XP`;
    $("hud-serie").textContent = `🔥 ${c.serie} j`;
    $("hud-serie").dataset.chaud = c.serie > 0 ? "oui" : "non";
    const e = $("hud-echeance");
    e.hidden = !c.echeance;
    if (c.echeance) e.textContent = `📅 ${c.echeance.jours === 0 ? "Jour J" : `J-${c.echeance.jours}`}`;
    if (c.echeance) e.title = c.echeance.nom;
    // passage de niveau : un petit éclat doré
    if (this.niveauAffiche && n.niveau > this.niveauAffiche) {
      const bloc = $("hud-joueur");
      bloc.classList.remove("monte");
      void bloc.offsetWidth;
      bloc.classList.add("monte");
    }
    this.niveauAffiche = n.niveau;
  }

  /** « — ZONE — LE BUREAU » au milieu de l'écran, comme à l'entrée d'un niveau. */
  annoncerZone(): void {
    const carte = $("carte-zone");
    carte.hidden = false;
    carte.classList.remove("visible");
    void carte.offsetWidth;
    carte.classList.add("visible");
    clearTimeout(Number(carte.dataset.timer));
    carte.dataset.timer = String(window.setTimeout(() => (carte.hidden = true), 2600));
  }
}
