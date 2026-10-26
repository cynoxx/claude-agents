// Max te regarde : quand tu es devant l'écran (Max déverrouillé, accueil de l'écran de Max), la caméra repère ton
// visage quatre fois par seconde, en toute petite image, et sa tête se tourne vers toi. Quand tu reviens après
// une absence, il s'illumine. L'image n'est ni gardée ni envoyée. Le bouton 👁 l'arrête (retenu par le navigateur).
import { CameraVisage } from "./camera-visage.ts";
import { son } from "./sons.ts";

const PREF = "max-regard";
/** Pas vu depuis ce temps-là : quand il te revoit, il te salue. */
export const ABSENCE_MS = 20_000;
const PAS_MS = 250;

const borne = (v: number) => Math.max(-1, Math.min(1, v));

/** Le centre du visage dans l'image brute de la caméra (0 à 1) → la direction du regard (-1 à 1), en miroir. */
export function versRegard(x: number, y: number): { x: number; y: number } {
  return { x: borne(1 - 2 * x), y: borne((y - 0.45) * 2.4) };
}

/** Faut-il le saluer ? La première fois qu'il te voit, ou si tu étais parti un moment. */
export function revient(dernierVu: number, maintenant: number): boolean {
  return dernierVu === 0 || maintenant - dernierVu > ABSENCE_MS;
}

const lirePref = () => {
  try {
    return localStorage.getItem(PREF) !== "non";
  } catch {
    return true;
  }
};

export class Regard {
  private camera: CameraVisage;
  private voulu = lirePref();
  private actif = false;
  private dernierVu = 0;
  private refuse = false;
  private bouton = document.getElementById("j-regard") as HTMLButtonElement | null;

  constructor(private max: { regarder(x: number, y: number): void; saluer(): void }) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
    document.body.appendChild(video);
    this.camera = new CameraVisage(video);
    if (!navigator.mediaDevices?.getUserMedia) {
      if (this.bouton) this.bouton.hidden = true;
      return;
    }
    this.bouton?.addEventListener("click", () => {
      this.voulu = !this.voulu;
      this.refuse = false;
      try {
        localStorage.setItem(PREF, this.voulu ? "oui" : "non");
      } catch {
        // navigation privée : le choix vaut pour cette fois
      }
      this.maj();
    });
    document.addEventListener("visibilitychange", () => this.maj());
    // l'écran (Max ou le bureau) et le verrou changent : on regarde s'il faut voir
    new MutationObserver(() => this.maj()).observe(document.body, { attributes: true, attributeFilter: ["data-vue", "data-verrou"] });
    // sur une fiche, Max est tout petit (et la caméra peut servir à tourner ton corps 3D) : il ne regarde pas
    const ecran = document.getElementById("jarvis");
    if (ecran) new MutationObserver(() => this.maj()).observe(ecran, { attributes: true, attributeFilter: ["data-mode"] });
    this.maj();
  }

  private get doitVoir(): boolean {
    const b = document.body.dataset;
    const fiche = document.getElementById("jarvis")?.dataset.mode === "fiche";
    return this.voulu && !this.refuse && !document.hidden && b.verrou !== "oui" && b.vue !== "bureau" && !fiche;
  }

  maj(): void {
    if (this.bouton) {
      this.bouton.dataset.actif = this.voulu && !this.refuse ? "oui" : "non";
      this.bouton.title = this.refuse
        ? "Max ne peut pas utiliser la caméra (autorisation refusée)"
        : this.voulu
          ? "Max te suit du regard (caméra, rien n'est enregistré) : clique pour arrêter"
          : "Max ne te regarde pas : clique pour qu'il te suive du regard";
    }
    if (this.doitVoir && !this.actif) void this.boucle();
  }

  private async boucle(): Promise<void> {
    this.actif = true;
    try {
      // le verrou peut encore tenir la caméra un instant : on attend qu'il la rende
      await new Promise((r) => setTimeout(r, 400));
      if (!this.doitVoir) return;
      await this.camera.demarrer();
      while (this.doitVoir) {
        const d = await this.camera.detecter().catch(() => null);
        if (d && d.score > 0.5) {
          const r = versRegard(d.x, d.y);
          this.max.regarder(r.x, r.y);
          const maintenant = Date.now();
          if (revient(this.dernierVu, maintenant)) {
            this.max.saluer();
            son("salut");
          }
          this.dernierVu = maintenant;
        }
        await new Promise((r) => setTimeout(r, PAS_MS));
      }
    } catch {
      // caméra refusée ou occupée : on n'insiste pas
      this.refuse = true;
    } finally {
      this.camera.arreter();
      this.actif = false;
      if (this.bouton) this.maj();
    }
  }
}
