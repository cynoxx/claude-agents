// La caméra et face-api : chargés seulement quand on en a besoin (la bibliothèque pèse plus d'un Mo).
// Tout se passe dans la page : l'image de la caméra n'est ni enregistrée ni envoyée ; seuls 128 nombres
// (le « descripteur » du visage) partent vers le serveur du Bureau, sur ce Mac.
import type * as FaceApi from "@vladmandic/face-api";
import { lacet } from "./visage-pur.ts";

export interface Analyse {
  /** L'orientation de la tête (0,5 de face). */
  lacet: number;
  /** Le descripteur (128 nombres), seulement si demandé. */
  descripteur?: number[];
  /** Confiance de la détection (0 à 1). */
  score: number;
}

let api: Promise<typeof FaceApi> | null = null;

function chargerApi(): Promise<typeof FaceApi> {
  api ??= (async () => {
    const f = await import("@vladmandic/face-api");
    await (f.tf as unknown as { ready(): Promise<void> }).ready();
    await Promise.all([
      f.nets.tinyFaceDetector.loadFromUri("/modeles-visage"),
      f.nets.faceLandmark68Net.loadFromUri("/modeles-visage"),
      f.nets.faceRecognitionNet.loadFromUri("/modeles-visage"),
    ]);
    return f;
  })();
  api.catch(() => (api = null));
  return api;
}

export class CameraVisage {
  private flux: MediaStream | null = null;

  constructor(private video: HTMLVideoElement) {}

  get allumee(): boolean {
    return !!this.flux;
  }

  /** Charge les modèles et allume la caméra (le navigateur demande l'autorisation la première fois). */
  async demarrer(): Promise<void> {
    const [, flux] = await Promise.all([chargerApi(), navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false })]);
    this.flux = flux;
    this.video.srcObject = flux;
    await this.video.play();
  }

  arreter(): void {
    this.flux?.getTracks().forEach((t) => t.stop());
    this.flux = null;
    this.video.srcObject = null;
  }

  /**
   * Un visage est-il là ? Détection seule, petite et rapide (pour guetter ton arrivée, ou que Max te suive du
   * regard) : sa confiance et le centre de sa boîte, en proportion de l'image (x de 0 à 1, dans l'image brute).
   */
  async detecter(): Promise<{ score: number; x: number; y: number; taille: number } | null> {
    if (!this.flux || this.video.readyState < 2) return null;
    const f = await chargerApi();
    const r = await f.detectSingleFace(this.video, new f.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.45 }));
    if (!r) return null;
    const l = this.video.videoWidth || 640;
    const h = this.video.videoHeight || 480;
    const b = r.box;
    return { score: r.score, x: (b.x + b.width / 2) / l, y: (b.y + b.height / 2) / h, taille: b.width / l };
  }

  /** Cherche un visage dans l'image ; null s'il n'y en a pas exactement un de net. */
  async analyser(avecDescripteur: boolean): Promise<Analyse | null> {
    if (!this.flux || this.video.readyState < 2) return null;
    const f = await chargerApi();
    const options = new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
    const base = f.detectSingleFace(this.video, options).withFaceLandmarks();
    const r = avecDescripteur ? await base.withFaceDescriptor() : await base;
    if (!r) return null;
    const d = (r as { descriptor?: Float32Array }).descriptor;
    return { lacet: lacet(r.landmarks.positions), score: r.detection.score, ...(d ? { descripteur: Array.from(d) } : {}) };
  }
}
