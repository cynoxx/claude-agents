// Téléchargement du modèle Whisper (une seule fois, ~550 Mo).
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const URL_MODELE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";

/** Télécharge le modèle vers `destination` (via un fichier « .partiel », renommé seulement s'il est complet). */
export async function telechargerModele(url: string, destination: string, progres?: (fraction: number) => void): Promise<"telecharge" | "deja-la"> {
  if (fs.existsSync(destination)) return "deja-la";
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partiel = destination + ".partiel";
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Téléchargement impossible (${r.status} ${r.statusText}).`);
  const total = Number(r.headers.get("content-length") ?? 0);
  let recu = 0;
  const compteur = new Transform({
    transform(morceau: Buffer, _enc, suite) {
      recu += morceau.length;
      if (total) progres?.(recu / total);
      suite(null, morceau);
    },
  });
  try {
    await pipeline(Readable.fromWeb(r.body as never), compteur, fs.createWriteStream(partiel));
    if (total && recu !== total) throw new Error(`Téléchargement incomplet (${recu} octets sur ${total}).`);
  } catch (e) {
    fs.rmSync(partiel, { force: true });
    throw e;
  }
  fs.renameSync(partiel, destination);
  progres?.(1);
  return "telecharge";
}
