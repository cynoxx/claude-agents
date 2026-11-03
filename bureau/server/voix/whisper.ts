// Transcription locale avec whisper.cpp (`whisper-cli`).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** La sortie de `whisper-cli -nt -np` → une seule ligne de texte. */
export function lireSortieWhisper(sortie: string): string {
  return sortie
    .split("\n")
    .map((l) => l.replace(/^\[\d\d:\d\d:\d\d\.\d{3} --> [^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ReglagesWhisper {
  bin: string;
  modele: string;
}

/** WAV → texte en français, entièrement sur l'ordinateur (whisper-cli de whisper.cpp). */
export async function transcrire(r: ReglagesWhisper, wav: Buffer): Promise<string> {
  const fichier = path.join(os.tmpdir(), `bureau-${randomUUID()}.wav`);
  fs.writeFileSync(fichier, wav);
  const fils = String(Math.min(8, Math.max(2, os.cpus().length)));
  try {
    return await new Promise<string>((resolve, reject) => {
      execFile(r.bin, ["-m", r.modele, "-l", "fr", "-nt", "-np", "-t", fils, "-f", fichier], { timeout: 60_000, maxBuffer: 1 << 20 }, (e, stdout, stderr) => {
        if (!e) return resolve(lireSortieWhisper(stdout));
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return reject(new Error(`whisper-cli introuvable (${r.bin}). Installe-le avec « brew install whisper-cpp ».`));
        reject(new Error(String(stderr || err.message).trim().split("\n").slice(-2).join(" ")));
      });
    });
  } finally {
    fs.rmSync(fichier, { force: true });
  }
}
