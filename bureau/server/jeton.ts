// Le jeton du Bureau : un secret aléatoire, recréé à chaque démarrage, que seuls le script Siri et les outils de Max
// connaissent (fichier lisible par l'utilisateur seul). Les routes qui agissent l'exigent.
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const FICHIER_JETON = "jeton";

export function creerJeton(dossier: string): string {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const jeton = randomBytes(32).toString("hex");
  const fichier = path.join(dossier, FICHIER_JETON);
  fs.writeFileSync(fichier, jeton, { mode: 0o600 });
  fs.chmodSync(fichier, 0o600);
  return jeton;
}

export function lireJeton(dossier: string): string | null {
  try {
    return fs.readFileSync(path.join(dossier, FICHIER_JETON), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function jetonValide(attendu: string | undefined, recu: unknown): boolean {
  if (!attendu || typeof recu !== "string" || recu.length !== attendu.length) return false;
  return timingSafeEqual(Buffer.from(recu), Buffer.from(attendu));
}
