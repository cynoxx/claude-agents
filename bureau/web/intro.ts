// L'entrée de Max, façon « Système » : l'écran est noir, une ligne de lumière bleue s'ouvre en fenêtre, la
// notification sonne, le Système se connecte (ses modules s'allument un par un, avec leur état réel), puis annonce
// le Joueur éveillé, son niveau, et la quête du jour reçue. Environ 5 secondes, en même temps que la musique.
import type { EtatBureau } from "../shared/protocol.ts";
import { niveau } from "../shared/niveau.ts";
import { son } from "./sons.ts";

const RECENTE_MS = 8000;
const DUREE_MS = 5600;
const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Faut-il jouer l'intro pour ce lancement (nouveau, et pas trop ancien) ? */
export function introAJouer(intro: number | undefined, dejaJouee: number, maintenant = Date.now()): boolean {
  return !!intro && intro !== dejaJouee && maintenant - intro < RECENTE_MS;
}

/** Les modules annoncés, avec leur état réel. */
export function lignesIntro(e: EtatBureau): { texte: string; ok: boolean }[] {
  const a = e.assistant;
  const n = e.conseillers?.length ?? 0;
  return [
    ...(e.musique === undefined ? [] : [{ texte: "Musique", ok: e.musique }]),
    { texte: "Voix", ok: a?.bouche.ok ?? false },
    { texte: "Oreille", ok: a?.oreille.ok ?? false },
    { texte: "Cerveau", ok: e.claude.ok },
    { texte: "Agenda", ok: !!e.jarvis?.agenda },
    { texte: n ? `${n} pôles` : "Pôles", ok: n > 0 },
  ];
}

/** Ce que le Système annonce : le Joueur, son niveau, et la quête du jour. */
export function annonceIntro(e: EtatBureau): { joueur: string; niveau: number; quete: string } {
  const p = e.plan;
  return {
    joueur: (e.verrou?.prenom || "Joueur").toUpperCase(),
    niveau: niveau(e.assistant?.coach?.total ?? 0).niveau,
    quete: p ? `${p.blocs} blocs de médecine · 3 règles` : "Quête du jour",
  };
}

export class Intro {
  private jouee = 0;
  private el: HTMLElement;
  private minuteries: number[] = [];

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "sys-intro";
    this.el.hidden = true;
    this.el.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.el);
    this.el.addEventListener("click", () => this.finir());
  }

  rendre(e: EtatBureau): void {
    if (!introAJouer(e.intro, this.jouee)) return;
    this.jouee = e.intro!;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // juste après la reconnaissance du visage, on laisse finir « Accès autorisé » avant l'intro
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
    const a = annonceIntro(e);
    const lignes = lignesIntro(e)
      .map((l, i) => `<li style="--i:${i}"><span>${echapper(l.texte)}</span><i></i><b class="${l.ok ? "ok" : "ko"}">${l.ok ? "EN LIGNE" : "HORS LIGNE"}</b></li>`)
      .join("");
    this.el.innerHTML = `
<div class="sys-poussiere"></div>
<div class="sys-fenetre">
  <div class="sys-tete"><span class="sys-alerte">!</span><span>NOTIFICATION</span></div>
  <div class="sys-corps">
    <p class="sys-connexion">Connexion au Système<span class="sys-points"></span></p>
    <div class="sys-barre"><i></i><b>0 %</b></div>
    <ul class="sys-modules">${lignes}</ul>
    <div class="sys-joueur">
      <p>${a.joueur === "JOUEUR" ? "Le <strong>Joueur</strong> est éveillé." : `Le Joueur <strong>${echapper(a.joueur)}</strong> est éveillé.`}</p>
      <p class="sys-niveau">NIVEAU <strong>${a.niveau}</strong></p>
    </div>
  </div>
</div>
<div class="sys-quete"><span class="sys-alerte">!</span><div><b>QUÊTE QUOTIDIENNE REÇUE</b><small>${echapper(a.quete)}</small></div></div>`;
    for (const t of this.minuteries) clearTimeout(t);
    this.minuteries = [];
    this.el.hidden = false;
    this.el.classList.remove("sort", "joue");
    void this.el.offsetWidth;
    this.el.classList.add("joue");
    // la notification sonne quand la fenêtre s'ouvre, puis quand la quête arrive
    this.plus(650, () => son("systeme", 0.08));
    this.plus(4000, () => son("quete", 0.07));
    // la barre de chargement : le pourcentage suit la barre (1,3 s → 2,9 s)
    const debut = performance.now() + 1300;
    const pct = this.el.querySelector<HTMLElement>(".sys-barre b")!;
    const tic = (t: number) => {
      const p = Math.max(0, Math.min(1, (t - debut) / 1600));
      pct.textContent = `${Math.round(p * 100)} %`;
      if (p < 1 && !this.el.hidden) requestAnimationFrame(tic);
    };
    requestAnimationFrame(tic);
    this.plus(DUREE_MS, () => this.finir());
  }

  /** La fenêtre se referme, l'écran s'ouvre sur le QG ; les fenêtres arrivent une par une. */
  private finir(): void {
    if (this.el.hidden) return;
    for (const t of this.minuteries) clearTimeout(t);
    this.minuteries = [];
    this.el.classList.add("sort");
    const jarvis = document.getElementById("jarvis")!;
    jarvis.classList.remove("qg-arrive");
    void jarvis.offsetWidth;
    jarvis.classList.add("qg-arrive");
    window.dispatchEvent(new Event("max-apparait"));
    window.setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove("joue", "sort");
    }, 700);
    window.setTimeout(() => jarvis.classList.remove("qg-arrive"), 2000);
  }
}
