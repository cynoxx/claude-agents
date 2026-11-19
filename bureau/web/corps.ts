// Le corps en 3D, façon hologramme : une silhouette dont les muscles s'allument selon ce qu'ils ont travaillé ces
// 14 derniers jours (bleu éteint → cyan → jaune → orange). On le tourne à la souris (ou au doigt), on zoome à la
// molette, ou avec la main devant la caméra (MediaPipe Hands, dans la page : l'image ne sort pas du Mac).
// Chargé seulement à l'ouverture de la fiche Sport (three.js et MediaPipe pèsent lourd).
import * as THREE from "three";
import type { SportVue } from "../shared/protocol.ts";
import { MUSCLES, type MuscleId } from "../shared/sport.ts";
import { GesteMain, type Repere } from "./geste-main.ts";

type Muscles = SportVue["muscles"];

const ETEINT = new THREE.Color("#22385c");
const PALIERS = [new THREE.Color("#2bd4ff"), new THREE.Color("#ffd23f"), new THREE.Color("#ff8a2b"), new THREE.Color("#ff4d4d")];

/** La couleur d'un muscle selon son intensité (0 à 1). */
export function couleurMuscle(intensite: number): THREE.Color {
  if (intensite <= 0) return ETEINT.clone();
  const t = Math.min(1, intensite) * (PALIERS.length - 1);
  const i = Math.min(PALIERS.length - 2, Math.floor(t));
  return PALIERS[i].clone().lerp(PALIERS[i + 1], t - i);
}

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

/** Une capsule (membre) entre deux points. */
function capsule(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const longueur = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, longueur, 6, 14), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(v(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** Un ellipsoïde posé au milieu de [a, b] (ou en un point), aligné sur le segment. */
function ellipsoide(centre: THREE.Vector3, echelle: THREE.Vector3, mat: THREE.Material, axe?: THREE.Vector3, rotZ = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
  m.position.copy(centre);
  m.scale.copy(echelle);
  if (axe) m.quaternion.setFromUnitVectors(v(0, 1, 0), axe.clone().normalize());
  if (rotZ) m.rotateZ(rotZ);
  return m;
}

interface Membres {
  epaule: THREE.Vector3;
  coude: THREE.Vector3;
  poignet: THREE.Vector3;
  hanche: THREE.Vector3;
  genou: THREE.Vector3;
  cheville: THREE.Vector3;
}

const cote = (s: 1 | -1): Membres => ({
  epaule: v(0.2 * s, 1.43),
  coude: v(0.27 * s, 1.14, -0.01),
  poignet: v(0.31 * s, 0.88, 0.02),
  hanche: v(0.09 * s, 0.9),
  genou: v(0.105 * s, 0.5, 0.01),
  cheville: v(0.11 * s, 0.1, -0.01),
});

/** Construit la silhouette et ses muscles ; renvoie le groupe et les maillages de chaque muscle. */
function construire(): { groupe: THREE.Group; muscles: Map<MuscleId, THREE.Mesh[]>; peau: THREE.Material[] } {
  const groupe = new THREE.Group();
  const peau = new THREE.MeshStandardMaterial({ color: "#7df9ff", emissive: "#0b3a4a", transparent: true, opacity: 0.16, roughness: 0.4, depthWrite: false });
  const trame = new THREE.MeshBasicMaterial({ color: "#7df9ff", wireframe: true, transparent: true, opacity: 0.07 });
  const muscles = new Map<MuscleId, THREE.Mesh[]>();
  const muscle = (id: MuscleId, m: THREE.Mesh) => {
    m.material = new THREE.MeshStandardMaterial({ color: ETEINT, emissive: ETEINT, emissiveIntensity: 0.35, roughness: 0.55, transparent: true, opacity: 0.92 });
    m.userData.muscle = id;
    muscles.set(id, [...(muscles.get(id) ?? []), m]);
    groupe.add(m);
  };
  const silhouette = (m: THREE.Mesh) => {
    groupe.add(m);
    const fil = m.clone();
    fil.material = trame;
    groupe.add(fil);
  };

  // la silhouette
  silhouette(ellipsoide(v(0, 1.66), v(0.095, 0.12, 0.105), peau));
  silhouette(capsule(v(0, 1.5), v(0, 1.57), 0.05, peau));
  silhouette(ellipsoide(v(0, 1.3, 0), v(0.2, 0.2, 0.12), peau));
  silhouette(ellipsoide(v(0, 1.07, 0), v(0.15, 0.14, 0.1), peau));
  silhouette(ellipsoide(v(0, 0.92, 0), v(0.16, 0.1, 0.11), peau));
  for (const s of [1, -1] as const) {
    const c = cote(s);
    silhouette(capsule(c.epaule, c.coude, 0.045, peau));
    silhouette(capsule(c.coude, c.poignet, 0.037, peau));
    silhouette(ellipsoide(c.poignet.clone().add(v(0.01 * s, -0.07, 0.01)), v(0.03, 0.055, 0.02), peau));
    silhouette(capsule(c.hanche, c.genou, 0.072, peau));
    silhouette(capsule(c.genou, c.cheville, 0.05, peau));
    silhouette(ellipsoide(c.cheville.clone().add(v(0, -0.05, 0.05)), v(0.04, 0.03, 0.09), peau));

    // les muscles, devant (z > 0) et derrière (z < 0)
    const bras = c.coude.clone().sub(c.epaule);
    const avantBras = c.poignet.clone().sub(c.coude);
    const cuisse = c.genou.clone().sub(c.hanche);
    const jambe = c.cheville.clone().sub(c.genou);
    muscle("pectoraux", ellipsoide(v(0.08 * s, 1.335, 0.085), v(0.08, 0.055, 0.03), peau, undefined, -0.15 * s));
    muscle("epaules", ellipsoide(c.epaule.clone().add(v(0.015 * s, -0.005, 0)), v(0.055, 0.062, 0.06), peau));
    muscle("biceps", ellipsoide(c.epaule.clone().addScaledVector(bras, 0.56).add(v(0, 0, 0.026)), v(0.031, 0.09, 0.027), peau, bras));
    muscle("triceps", ellipsoide(c.epaule.clone().addScaledVector(bras, 0.45).add(v(0, 0, -0.027)), v(0.033, 0.1, 0.027), peau, bras));
    muscle("avant_bras", ellipsoide(c.coude.clone().addScaledVector(avantBras, 0.36), v(0.036, 0.095, 0.033), peau, avantBras));
    muscle("dorsaux", ellipsoide(v(0.095 * s, 1.25, -0.08), v(0.068, 0.14, 0.028), peau, undefined, 0.3 * s));
    muscle("fessiers", ellipsoide(v(0.07 * s, 0.86, -0.08), v(0.074, 0.068, 0.04), peau));
    muscle("quadriceps", ellipsoide(c.hanche.clone().addScaledVector(cuisse, 0.5).add(v(0, 0, 0.03)), v(0.058, 0.16, 0.04), peau, cuisse));
    muscle("ischios", ellipsoide(c.hanche.clone().addScaledVector(cuisse, 0.5).add(v(0, 0, -0.03)), v(0.054, 0.15, 0.035), peau, cuisse));
    muscle("mollets", ellipsoide(c.genou.clone().addScaledVector(jambe, 0.3).add(v(0, 0, -0.025)), v(0.041, 0.1, 0.032), peau, jambe));
  }
  muscle("trapezes", ellipsoide(v(0, 1.455, -0.05), v(0.13, 0.045, 0.035), peau));
  muscle("lombaires", ellipsoide(v(0, 1.04, -0.075), v(0.068, 0.062, 0.022), peau));
  for (const x of [-0.032, 0.032]) for (const y of [1.17, 1.095, 1.02]) muscle("abdos", ellipsoide(v(x, y, 0.085), v(0.027, 0.03, 0.015), peau));

  // un socle lumineux, et un anneau qui scanne le corps de bas en haut
  const socle = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.31, 64), new THREE.MeshBasicMaterial({ color: "#7df9ff", transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  socle.rotation.x = -Math.PI / 2;
  socle.position.y = 0.02;
  groupe.add(socle);
  const scan = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.235, 64), new THREE.MeshBasicMaterial({ color: "#7df9ff", transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  scan.rotation.x = -Math.PI / 2;
  scan.name = "scan";
  groupe.add(scan);
  groupe.position.y = -0.9;
  return { groupe, muscles, peau: [peau, trame] };
}

export class Corps3D {
  private rendu: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  private pivot = new THREE.Group();
  private muscles: Map<MuscleId, THREE.Mesh[]>;
  private infos = new Map<MuscleId, Muscles[number]>();
  private lacet = 0.5;
  private tangage = 0.08;
  private distance = 4.2;
  private cible = { lacet: 0.5, tangage: 0.08, distance: 4.2 };
  private derniereAction = 0;
  private image = 0;
  private glisse: { x: number; y: number; parcouru: number } | null = null;
  private observe: ResizeObserver;
  private rayon = new THREE.Raycaster();
  private video: HTMLVideoElement | null = null;
  private flux: MediaStream | null = null;
  private mains: { detectForVideo(v: HTMLVideoElement, t: number): { landmarks: Repere[][] }; close(): void } | null = null;
  private geste = new GesteMain();
  private curseur: HTMLElement;
  private detruit = false;
  mainActive = false;

  constructor(
    private zone: HTMLElement,
    private statut: (texte: string) => void,
  ) {
    this.rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.rendu.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    zone.appendChild(this.rendu.domElement);
    this.curseur = document.createElement("div");
    this.curseur.className = "qf-curseur";
    this.curseur.hidden = true;
    zone.appendChild(this.curseur);

    this.scene.add(new THREE.AmbientLight("#9fdfff", 0.9));
    const cle = new THREE.DirectionalLight("#ffffff", 1.6);
    cle.position.set(1.5, 2, 2.5);
    this.scene.add(cle);
    const contre = new THREE.DirectionalLight("#7df9ff", 1.2);
    contre.position.set(-2, 1, -2.5);
    this.scene.add(contre);
    const c = construire();
    this.muscles = c.muscles;
    this.pivot.add(c.groupe);
    this.scene.add(this.pivot);

    this.observe = new ResizeObserver(() => this.taille());
    this.observe.observe(zone);
    this.taille();
    this.brancherSouris();
    this.statut("Glisse pour tourner · molette pour zoomer · touche un muscle");
    const boucle = () => {
      if (this.detruit) return;
      this.image = requestAnimationFrame(boucle);
      this.animer();
    };
    boucle();
  }

  /** Les muscles travaillés : couleur et intensité de chacun. */
  maj(muscles: Muscles): void {
    for (const m of muscles) {
      this.infos.set(m.id, m);
      const c = couleurMuscle(m.intensite);
      for (const mesh of this.muscles.get(m.id) ?? []) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.color.copy(c);
        mat.emissive.copy(c);
        mat.emissiveIntensity = m.intensite > 0 ? 0.55 + m.intensite * 0.5 : 0.3;
        // un muscle pas travaillé reste presque transparent : ceux qui ont bossé ressortent
        mat.opacity = m.intensite > 0 ? 0.95 : 0.4;
      }
    }
  }

  /** Allume (ou coupe) la caméra et la détection de la main. */
  async activerMain(oui: boolean): Promise<void> {
    if (!oui) return this.couperMain("Caméra coupée. Glisse pour tourner.");
    if (this.mainActive) return;
    this.mainActive = true;
    this.statut("Allumage de la caméra…");
    try {
      this.flux = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false });
      if (this.detruit) return this.couperMain("");
      this.video = document.createElement("video");
      this.video.className = "qf-video";
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.flux;
      this.zone.appendChild(this.video);
      await this.video.play();
      this.statut("Chargement de la détection de la main…");
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const fichiers = await FilesetResolver.forVisionTasks("/mediapipe");
      this.mains = await HandLandmarker.createFromOptions(fichiers, {
        baseOptions: { modelAssetPath: "/mediapipe/hand_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
      });
      if (this.detruit || !this.mainActive) return this.couperMain("");
      this.statut("✋ Pince le pouce et l'index pour attraper le corps, puis bouge la main. Approche-la pour zoomer.");
    } catch (e) {
      const refus = (e as Error).name === "NotAllowedError";
      this.couperMain(refus ? "Caméra refusée : autorise-la pour ce site, ou tourne à la souris." : `La main n'a pas pu être suivie (${(e as Error).message}). Tourne à la souris.`);
    }
  }

  detruire(): void {
    this.detruit = true;
    cancelAnimationFrame(this.image);
    this.observe.disconnect();
    this.couperMain("");
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.rendu.dispose();
    this.rendu.domElement.remove();
    this.curseur.remove();
  }

  // --- interne ---------------------------------------------------------------------------------

  private couperMain(texte: string): void {
    this.mainActive = false;
    this.mains?.close();
    this.mains = null;
    this.flux?.getTracks().forEach((t) => t.stop());
    this.flux = null;
    this.video?.remove();
    this.video = null;
    this.curseur.hidden = true;
    this.geste.suivre(null);
    if (texte) this.statut(texte);
  }

  private taille(): void {
    const l = this.zone.clientWidth || 300;
    const h = this.zone.clientHeight || 400;
    this.rendu.setSize(l, h, false);
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
  }

  private brancherSouris(): void {
    const toile = this.rendu.domElement;
    toile.style.touchAction = "none";
    toile.addEventListener("pointerdown", (e) => {
      this.glisse = { x: e.clientX, y: e.clientY, parcouru: 0 };
      this.derniereAction = performance.now();
      toile.setPointerCapture(e.pointerId);
    });
    toile.addEventListener("pointermove", (e) => {
      if (!this.glisse) return;
      this.cible.lacet += (e.clientX - this.glisse.x) * 0.01;
      this.cible.tangage = Math.max(-0.6, Math.min(0.6, this.cible.tangage + (e.clientY - this.glisse.y) * 0.006));
      this.glisse = { x: e.clientX, y: e.clientY, parcouru: this.glisse.parcouru + Math.hypot(e.clientX - this.glisse.x, e.clientY - this.glisse.y) };
      this.derniereAction = performance.now();
    });
    toile.addEventListener("pointerup", (e) => {
      // un clic (pas un glisser) sur un muscle : son bilan
      const clic = this.glisse && this.glisse.parcouru < 6;
      this.glisse = null;
      if (clic) this.toucher(e);
    });
    toile.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.cible.distance = Math.max(2.2, Math.min(6, this.cible.distance * (e.deltaY > 0 ? 1.08 : 0.93)));
        this.derniereAction = performance.now();
      },
      { passive: false },
    );
  }

  /** Un clic sur un muscle : son nom et ce qu'il a fait. */
  private toucher(e: PointerEvent): void {
    const r = this.rendu.domElement.getBoundingClientRect();
    this.rayon.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const touche = this.rayon.intersectObjects(this.pivot.children, true).find((i) => i.object.userData.muscle);
    if (!touche) return;
    const id = touche.object.userData.muscle as MuscleId;
    const info = this.infos.get(id);
    this.statut(`${MUSCLES[id]} : ${info?.fois ? `${info.fois} fois en 14 jours` : "pas travaillé ces 14 derniers jours"}${info?.derniere ? `, la dernière le ${new Date(`${info.derniere}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}` : ""}.`);
  }

  private suivreMain(): void {
    const video = this.video;
    if (!this.mains || !video || video.readyState < 2) return;
    const r = this.mains.detectForVideo(video, performance.now());
    const m = this.geste.suivre(r.landmarks[0] ?? null);
    this.curseur.hidden = !m.position;
    if (m.position) {
      this.curseur.style.left = `${m.position.x * 100}%`;
      this.curseur.style.top = `${m.position.y * 100}%`;
      this.curseur.dataset.etat = m.etat;
    }
    if (m.etat === "pince") {
      this.cible.lacet += m.dLacet;
      this.cible.tangage = Math.max(-0.6, Math.min(0.6, this.cible.tangage + m.dTangage));
      this.cible.distance = Math.max(2.2, Math.min(6, this.cible.distance / m.zoom));
      this.derniereAction = performance.now();
    }
  }

  private animer(): void {
    this.suivreMain();
    const t = performance.now();
    // sans geste depuis quelques secondes, il tourne doucement tout seul
    if (t - this.derniereAction > 4000 && !this.glisse) this.cible.lacet += 0.004;
    this.lacet += (this.cible.lacet - this.lacet) * 0.15;
    this.tangage += (this.cible.tangage - this.tangage) * 0.15;
    this.distance += (this.cible.distance - this.distance) * 0.15;
    this.pivot.rotation.set(this.tangage, this.lacet, 0);
    this.camera.position.set(0, 0.1, this.distance);
    this.camera.lookAt(0, 0, 0);
    const scan = this.pivot.getObjectByName("scan");
    if (scan) scan.position.y = 0.05 + ((t / 2600) % 1) * 1.7;
    this.rendu.render(this.scene, this.camera);
  }
}
