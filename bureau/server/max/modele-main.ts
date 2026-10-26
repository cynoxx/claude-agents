// Le modèle de détection de la main (MediaPipe Hands, 7,8 Mo) : téléchargé une seule fois, au premier usage,
// dans le dossier des données, puis servi à la page avec les fichiers WebAssembly de @mediapipe/tasks-vision.
import fs from "node:fs";
import path from "node:path";

export const URL_MODELE_MAIN = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
export const FICHIER_MODELE_MAIN = "hand_landmarker.task";

let enCours: Promise<string> | null = null;

/** Le chemin du modèle, téléchargé s'il n'est pas encore là (un seul téléchargement à la fois). */
export function assurerModeleMain(dossier: string, url = URL_MODELE_MAIN): Promise<string> {
  const fichier = path.join(dossier, FICHIER_MODELE_MAIN);
  if (fs.existsSync(fichier)) return Promise.resolve(fichier);
  enCours ??= (async () => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`téléchargement du modèle de la main impossible (${r.status})`);
    const octets = Buffer.from(await r.arrayBuffer());
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(fichier + ".part", octets);
    fs.renameSync(fichier + ".part", fichier);
    return fichier;
  })().finally(() => {
    enCours = null;
  });
  return enCours;
}
