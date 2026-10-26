// L'intro quand Max se lance (en même temps que la musique, jouée par le Mac) : un éclair rouge et or traverse
// l'écran, les anneaux de Max s'assemblent, « MAX » s'écrit, ses systèmes s'allument un par un, puis l'écran
// s'ouvre sur le QG et les tuiles des pôles arrivent l'une après l'autre. Environ 5 secondes.
import type { EtatBureau } from "../shared/protocol.ts";

const RECENTE_MS = 8000;
const DUREE_MS = 5200;

/** Faut-il jouer l'intro pour ce lancement (nouveau, et pas trop ancien) ? */
export function introAJouer(intro: number | undefined, dejaJouee: number, maintenant = Date.now()): boolean {
  return !!intro && intro !== dejaJouee && maintenant - intro < RECENTE_MS;
}

/** Les systèmes annoncés, avec leur état réel. */
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

export class Intro {
  private jouee = 0;
  private el: HTMLElement;

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "intro";
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

  private jouer(e: EtatBureau): void {
    const lignes = lignesIntro(e)
      .map((l, i) => `<li style="--i:${i}"><span>${l.texte}</span><b class="${l.ok ? "ok" : "ko"}">${l.ok ? "EN LIGNE" : "HORS LIGNE"}</b></li>`)
      .join("");
    this.el.innerHTML = `
<div class="intro-eclair"></div><div class="intro-eclair deux"></div>
<div class="intro-coeur">
  <div class="intro-anneaux"><i></i><i></i><i></i></div>
  <div class="intro-nom"><span>M</span><span>A</span><span>X</span></div>
  <ul class="intro-lignes">${lignes}</ul>
</div>`;
    this.el.hidden = false;
    this.el.classList.remove("sort");
    void this.el.offsetWidth;
    this.el.classList.add("joue");
    clearTimeout(Number(this.el.dataset.t1));
    this.el.dataset.t1 = String(window.setTimeout(() => this.finir(), DUREE_MS));
  }

  /** L'écran s'ouvre sur le QG ; les tuiles arrivent une par une. */
  private finir(): void {
    if (this.el.hidden) return;
    clearTimeout(Number(this.el.dataset.t1));
    this.el.classList.add("sort");
    const jarvis = document.getElementById("jarvis")!;
    jarvis.classList.remove("qg-arrive");
    void jarvis.offsetWidth;
    jarvis.classList.add("qg-arrive");
    // Max se forme en comète de particules
    window.dispatchEvent(new Event("max-apparait"));
    window.setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove("joue", "sort");
    }, 700);
    window.setTimeout(() => jarvis.classList.remove("qg-arrive"), 2000);
  }
}
