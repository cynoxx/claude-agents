// Contrôler Max avec la main (bouton 🖐 dans la barre). La caméra regarde ta main quelques fois par seconde, dans la
// page seulement (rien n'est enregistré ni envoyé) ; un geste tenu ou un balayage envoie la commande à Max.
// En pause (et la caméra rendue) quand Max est verrouillé, quand la page est cachée, ou sur la fiche du corps 3D,
// où la main sert à tourner le corps.
import type { ClientMessage, EtatBureau } from "../shared/protocol.ts";
import { son } from "./sons.ts";
import { actionPour, EMOJI_POSE, NOM_GESTE, SuiviGestes, type Action } from "./gestes-pur.ts";

const PREF = "max-gestes";
const PAS_MS = 90;

const lirePref = () => {
  try {
    return localStorage.getItem(PREF) === "oui";
  } catch {
    return false;
  }
};

type Detecteur = { detectForVideo(v: HTMLVideoElement, t: number): { landmarks: { x: number; y: number }[][] }; close(): void };

export class Gestes {
  private voulu = lirePref();
  private actif = false;
  private flux: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private detecteur: Detecteur | null = null;
  private suivi = new SuiviGestes();
  private timer = 0;
  private refuse = false;
  private etat?: EtatBureau;
  private bouton = document.getElementById("j-gestes") as HTMLButtonElement | null;
  private message = 0;

  constructor(private envoyer: (m: ClientMessage) => void) {
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
        // le choix vaut pour cette fois
      }
      this.maj();
      if (this.voulu) this.dire("Gestes actifs : ✋ balayage = pôle suivant · ☝️ accueil · ✌️ mode obscur · 🤟 bureau · ✊ silence");
    });
    document.addEventListener("visibilitychange", () => this.maj());
    const surveiller = (e: Element | null, attributs: string[]) => e && new MutationObserver(() => this.maj()).observe(e, { attributes: true, attributeFilter: attributs });
    surveiller(document.body, ["data-verrou", "data-pole", "data-vue"]);
    this.maj();
  }

  rendre(e: EtatBureau): void {
    this.etat = e;
  }

  private get doitSuivre(): boolean {
    const b = document.body.dataset;
    // sur la fiche du sport, la main tourne le corps 3D : pas de gestes
    return this.voulu && !this.refuse && !document.hidden && b.verrou !== "oui" && b.pole !== "sante";
  }

  private maj(): void {
    if (this.bouton) {
      this.bouton.dataset.actif = this.voulu && !this.refuse ? "oui" : "non";
      this.bouton.dataset.pause = this.voulu && !this.refuse && !this.doitSuivre ? "oui" : "non";
      this.bouton.title = this.refuse
        ? "Max ne peut pas utiliser la caméra (autorisation refusée)"
        : this.voulu
          ? "Gestes : ✋ balayage pôle suivant/précédent · ☝️ accueil · ✌️ mode obscur · 🤟 bureau · ✊ silence (tenir 1 s). Clique pour arrêter."
          : "Contrôler Max avec la main : clique pour l'activer";
      if (!this.message) this.bouton.textContent = "🖐";
    }
    if (this.doitSuivre && !this.actif) void this.demarrer();
    else if (!this.doitSuivre && this.actif) this.arreter();
  }

  private dire(texte: string): void {
    const t = document.getElementById("j-gestes-msg");
    if (!t) return;
    t.textContent = texte;
    t.hidden = false;
    clearTimeout(this.message);
    this.message = window.setTimeout(() => {
      t.hidden = true;
      this.message = 0;
      if (this.bouton) this.bouton.textContent = "🖐";
    }, 3200);
  }

  private async demarrer(): Promise<void> {
    this.actif = true;
    try {
      this.flux = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false });
      this.video = document.createElement("video");
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.setAttribute("aria-hidden", "true");
      this.video.style.cssText = "position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0";
      document.body.appendChild(this.video);
      this.video.srcObject = this.flux;
      await this.video.play();
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fichiers = await FilesetResolver.forVisionTasks("/mediapipe");
      const creer = (delegate: "GPU" | "CPU") =>
        HandLandmarker.createFromOptions(fichiers, { baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate }, runningMode: "VIDEO", numHands: 1 });
      this.detecteur = (await creer("GPU").catch(() => creer("CPU"))) as unknown as Detecteur;
      if (!this.actif || !this.doitSuivre) return this.arreter();
      this.suivi.reinitialiser();
      this.timer = window.setInterval(() => this.cadre(), PAS_MS);
    } catch (e) {
      this.refuse = (e as Error).name === "NotAllowedError";
      this.arreter();
      this.maj();
      if (!this.refuse) this.dire(`Gestes indisponibles (${(e as Error).message}).`);
    }
  }

  private arreter(): void {
    this.actif = false;
    clearInterval(this.timer);
    this.timer = 0;
    this.detecteur?.close();
    this.detecteur = null;
    this.flux?.getTracks().forEach((t) => t.stop());
    this.flux = null;
    this.video?.remove();
    this.video = null;
  }

  private cadre(): void {
    const v = this.video;
    if (!this.detecteur || !v || v.readyState < 2) return;
    const t = performance.now();
    const r = this.detecteur.detectForVideo(v, t);
    const s = this.suivi.suivre(r.landmarks[0] ?? null, t);
    // le bouton montre la pose reconnue, et une jauge qui se remplit pendant qu'on la tient
    if (this.bouton) {
      this.bouton.style.setProperty("--progres", String(Math.round(s.progres * 100)));
      if (s.pose !== "autre") this.bouton.textContent = EMOJI_POSE[s.pose];
      else if (!this.message) this.bouton.textContent = "🖐";
    }
    if (!s.geste) return;
    const a = this.action(s.geste);
    const emoji = s.geste === "balayage-gauche" ? "👈" : s.geste === "balayage-droite" ? "👉" : EMOJI_POSE[s.geste];
    this.dire(`${emoji} ${a ? NOM_GESTE[s.geste] : "(rien à faire ici)"}`);
    if (!a) return;
    son("clic");
    this.envoyer(a as ClientMessage);
  }

  private action(g: Parameters<typeof actionPour>[0]): Action | null {
    const e = this.etat;
    return actionPour(g, {
      veille: (e?.assistant?.etat ?? "veille") === "veille",
      obscur: !!e?.assistant?.obscur,
      poles: (e?.conseillers ?? []).map((c) => c.id),
      pole: e?.assistant?.pole ?? null,
      auBureau: e?.assistant?.vue === "bureau",
    });
  }
}
