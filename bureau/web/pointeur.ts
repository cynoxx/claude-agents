// Contrôler Max avec la main, façon Jarvis (bouton 🖐 dans la barre : marche / arrêt, retenu d'une fois sur l'autre).
// La caméra suit ta main, dans la page seulement (rien n'est enregistré ni envoyé) :
// - bouge la main : le pointeur (un viseur holographique) se déplace, et se laisse attirer par les boutons ;
// - reste 2 secondes sur un bouton (un anneau se remplit) : il est actionné ; pincer le pouce et l'index aussi ;
// - pince et bouge la main vers le haut ou le bas : le contenu défile.
// En haut à droite, le squelette de ta main (sans l'image de la caméra) montre ce que Max voit.
// En pause (caméra rendue) quand Max est verrouillé, quand la page est cachée, ou sur la fiche du corps 3D, où la
// main sert déjà à tourner le corps.
import { son } from "./sons.ts";
import { onde } from "./systeme-ambiance.ts";
import { Attente, CLIQUABLE, PointeurMain, type EtatPointeur } from "./pointeur-pur.ts";

const PREF = "max-main";
type Detecteur = { detectForVideo(v: HTMLVideoElement, t: number): { landmarks: { x: number; y: number }[][] }; close(): void };
/** Les os de la main (paires de repères MediaPipe), pour le squelette. */
const OS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

/** Une signature stable du bouton visé : la page redessine certaines fenêtres, le bouton reste « le même ». */
const cle = (el: HTMLElement | null) =>
  el ? `${el.tagName}|${el.id}|${el.className.replace(/\bmain-survol\b/, "")}|${JSON.stringify({ ...el.dataset })}|${(el.textContent ?? "").trim().slice(0, 40)}` : null;

const lirePref = () => {
  try {
    const v = localStorage.getItem(PREF);
    // l'ancien réglage des gestes vaut pour le pointeur
    return v ? v === "oui" : localStorage.getItem("max-gestes") === "oui";
  } catch {
    return false;
  }
};

export class PointeurMainPage {
  private voulu = lirePref();
  private actif = false;
  private refuse = false;
  private flux: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private detecteur: Detecteur | null = null;
  private suivi = new PointeurMain();
  private bouton = document.getElementById("j-gestes") as HTMLButtonElement | null;
  private curseur = document.createElement("div");
  private squelette = document.createElement("canvas");
  private sctx = this.squelette.getContext("2d")!;
  private image = 0;
  private dernierTemps = -1;
  private cible = { x: innerWidth / 2, y: innerHeight / 2 };
  private affiche = { x: innerWidth / 2, y: innerHeight / 2 };
  private present = false;
  private serrage = 0;
  private survol: HTMLElement | null = null;
  private attente = new Attente();
  private progresAttente = 0;
  private message = 0;

  constructor() {
    this.curseur.className = "main-curseur";
    this.curseur.hidden = true;
    this.curseur.setAttribute("aria-hidden", "true");
    this.curseur.innerHTML = `<i class="mc-arcs"></i><i class="mc-attente"></i><i class="mc-anneau"></i><i class="mc-point"></i><b class="mc-coord"></b>`;
    this.squelette.className = "main-squelette";
    this.squelette.width = 200;
    this.squelette.height = 150;
    this.squelette.hidden = true;
    this.squelette.setAttribute("aria-hidden", "true");
    document.body.append(this.curseur, this.squelette);
    if (!navigator.mediaDevices?.getUserMedia) {
      if (this.bouton) this.bouton.hidden = true;
      return;
    }
    this.bouton?.addEventListener("click", () => this.basculer());
    document.addEventListener("visibilitychange", () => this.maj());
    new MutationObserver(() => this.maj()).observe(document.body, { attributes: true, attributeFilter: ["data-verrou", "data-pole", "data-vue"] });
    this.maj();
  }

  basculer(): void {
    this.voulu = !this.voulu;
    this.refuse = false;
    try {
      localStorage.setItem(PREF, this.voulu ? "oui" : "non");
    } catch {
      // le choix vaut pour cette fois
    }
    this.maj();
    this.dire(this.voulu ? "Pointeur main actif : bouge la main pour viser · reste 2 s sur un bouton (ou pince pouce + index) pour appuyer · pince et bouge pour défiler" : "Pointeur main coupé.");
  }

  private get doitSuivre(): boolean {
    const b = document.body.dataset;
    return this.voulu && !this.refuse && !document.hidden && b.verrou !== "oui" && b.pole !== "sante";
  }

  private maj(): void {
    if (this.bouton) {
      this.bouton.dataset.actif = this.voulu && !this.refuse ? "oui" : "non";
      this.bouton.dataset.pause = this.voulu && !this.refuse && !this.doitSuivre ? "oui" : "non";
      this.bouton.setAttribute("aria-pressed", String(this.voulu));
      this.bouton.title = this.refuse
        ? "Max ne peut pas utiliser la caméra (autorisation refusée)"
        : this.voulu
          ? "Pointeur main actif : viser avec la main, rester 2 s sur un bouton (ou pincer) pour appuyer, pincer et bouger pour défiler. Clique pour l'arrêter."
          : "Contrôler Max avec la main (un pointeur suit ta main) : clique pour l'activer";
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
    this.message = window.setTimeout(() => (t.hidden = true), 4200);
  }

  private async demarrer(): Promise<void> {
    this.actif = true;
    try {
      this.flux = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: { ideal: 30 }, facingMode: "user" }, audio: false });
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
        HandLandmarker.createFromOptions(fichiers, {
          baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
      this.detecteur = (await creer("GPU").catch(() => creer("CPU"))) as unknown as Detecteur;
      if (!this.actif || !this.doitSuivre) return this.arreter();
      this.curseur.hidden = false;
      this.squelette.hidden = false;
      document.body.dataset.main = "oui";
      this.boucle();
    } catch (e) {
      this.refuse = (e as Error).name === "NotAllowedError";
      this.arreter();
      this.maj();
      this.dire(this.refuse ? "Max n'a pas le droit d'utiliser la caméra : autorise-la (cadenas à gauche de l'adresse)." : `Pointeur main indisponible (${(e as Error).message}).`);
    }
  }

  private arreter(): void {
    this.actif = false;
    cancelAnimationFrame(this.image);
    this.detecteur?.close();
    this.detecteur = null;
    this.flux?.getTracks().forEach((t) => t.stop());
    this.flux = null;
    this.video?.remove();
    this.video = null;
    this.curseur.hidden = true;
    this.squelette.hidden = true;
    this.viser(null);
    delete document.body.dataset.main;
  }

  /** Une boucle par image d'écran : on lit la main quand la caméra a une nouvelle image, et le pointeur glisse vers sa cible. */
  private boucle = (): void => {
    this.image = requestAnimationFrame(this.boucle);
    const v = this.video;
    if (this.detecteur && v && v.readyState >= 2 && v.currentTime !== this.dernierTemps) {
      this.dernierTemps = v.currentTime;
      const t = performance.now();
      const main = this.detecteur.detectForVideo(v, t).landmarks[0] ?? null;
      this.dessinerSquelette(main);
      this.agir(this.suivi.suivre(main, t));
    }
    // le pointeur glisse vers sa cible (fluide à la cadence de l'écran, même si la caméra va moins vite)
    this.affiche.x += (this.cible.x - this.affiche.x) * 0.38;
    this.affiche.y += (this.cible.y - this.affiche.y) * 0.38;
    this.curseur.style.transform = `translate3d(${this.affiche.x.toFixed(1)}px, ${this.affiche.y.toFixed(1)}px, 0)`;
  };

  private agir(e: EtatPointeur): void {
    if (e.present !== this.present) {
      this.present = e.present;
      this.curseur.dataset.present = e.present ? "oui" : "non";
      if (!e.present) this.viser(null);
    }
    if (!e.present) return;
    let x = e.x * innerWidth;
    let y = e.y * innerHeight;
    // ce qui est visé (le pointeur lui-même ne compte pas : pointer-events: none)
    const sous = document.elementFromPoint(x, y) as HTMLElement | null;
    const cliquable = sous?.closest<HTMLElement>(CLIQUABLE) ?? null;
    this.viser(cliquable);
    // l'aimant : le pointeur est attiré vers le centre du bouton visé (pas des grands blocs)
    if (cliquable) {
      const r = cliquable.getBoundingClientRect();
      if (r.width < 360 && r.height < 160) {
        x += (r.left + r.width / 2 - x) * 0.35;
        y += (r.top + r.height / 2 - y) * 0.35;
      }
    }
    this.cible = { x, y };
    if (Math.abs(e.serrage - this.serrage) > 0.05) {
      this.serrage = e.serrage;
      this.curseur.style.setProperty("--serrage", e.serrage.toFixed(2));
    }
    this.curseur.dataset.pince = e.pince ? "oui" : "non";
    const coord = this.curseur.querySelector("b")!;
    coord.textContent = `${String(Math.round(x)).padStart(4, "0")}·${String(Math.round(y)).padStart(4, "0")}`;
    // le reste de la page (Max qui suit le pointeur, la profondeur du fond) suit la main comme une souris
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y }));
    // rester 2 secondes sur un bouton, c'est appuyer dessus (l'anneau se remplit) ; pincer marche aussi, tout de suite
    const a = this.attente.suivre(e.pince ? null : cle(cliquable), performance.now(), e.x, e.y);
    if (Math.abs(a.progres - this.progresAttente) > 0.01 || (a.progres === 0) !== (this.progresAttente === 0)) {
      this.progresAttente = a.progres;
      this.curseur.style.setProperty("--attente", a.progres.toFixed(3));
    }
    if (a.declenche) this.cliquer(cliquable, x, y);
    if (e.clic) {
      this.cliquer(cliquable, x, y);
      this.attente.marquer(e.x, e.y);
    }
    if (e.defile) this.defiler(sous, e.defile);
  }

  private viser(el: HTMLElement | null): void {
    if (el === this.survol) return;
    const meme = cle(el) === cle(this.survol);
    this.survol?.classList.remove("main-survol");
    this.survol = el;
    el?.classList.add("main-survol");
    this.curseur.dataset.survol = el ? "oui" : "non";
    // un petit son quand on arrive sur un nouveau bouton (pas quand la page redessine le même)
    if (el && !meme) son("clic", 0.015);
  }

  private cliquer(el: HTMLElement | null, x: number, y: number): void {
    onde(x, y);
    this.curseur.classList.remove("clique");
    void this.curseur.offsetWidth;
    this.curseur.classList.add("clique");
    if (!el) return;
    son("clic", 0.05);
    if (el.matches("input, textarea, select")) el.focus();
    else el.click();
  }

  private defiler(el: HTMLElement | null, d: number): void {
    let n: HTMLElement | null = el;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) break;
      n = n.parentElement;
    }
    (n && n !== document.body ? n : document.scrollingElement)?.scrollBy({ top: d * innerHeight * 1.8 });
  }

  /** Le squelette de la main, en lumière, dans le coin : ce que Max voit (sans l'image de la caméra). */
  private dessinerSquelette(main: { x: number; y: number }[] | null): void {
    const c = this.sctx;
    const L = this.squelette.width;
    const H = this.squelette.height;
    c.clearRect(0, 0, L, H);
    c.font = "600 9px ui-monospace, Menlo, monospace";
    c.fillStyle = "rgba(120, 210, 255, 0.8)";
    c.fillText(main ? "MAIN · SUIVIE" : "EN ATTENTE DE TA MAIN…", 8, 14);
    if (!main) return;
    const p = (i: number) => [(1 - main[i].x) * L, main[i].y * H] as const;
    c.strokeStyle = "rgba(120, 210, 255, 0.85)";
    c.lineWidth = 2;
    c.shadowColor = "rgba(79, 183, 255, 1)";
    c.shadowBlur = 6;
    c.beginPath();
    for (const [a, b] of OS) {
      c.moveTo(...p(a));
      c.lineTo(...p(b));
    }
    c.stroke();
    c.shadowBlur = 0;
    for (let i = 0; i < 21; i++) {
      const [x, y] = p(i);
      c.fillStyle = i === 4 || i === 8 ? (this.serrage > 0.8 ? "#fff" : "#c6ecff") : "rgba(79, 183, 255, 0.9)";
      c.beginPath();
      c.arc(x, y, i === 4 || i === 8 ? 3.5 : 2, 0, Math.PI * 2);
      c.fill();
    }
    // la zone de la caméra qui couvre l'écran
    c.strokeStyle = "rgba(79, 183, 255, 0.25)";
    c.setLineDash([3, 3]);
    c.strokeRect(0.18 * L, 0.15 * H, 0.64 * L, 0.55 * H);
    c.setLineDash([]);
  }
}
