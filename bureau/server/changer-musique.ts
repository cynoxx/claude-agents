// `npm run musique -- bella` (ou un chemin de fichier) : remplace la musique de Max par un autre de tes mp3.
// Il cherche le mot dans Téléchargements, Bureau, Musique et Documents, copie le plus récent à la place de max.mp3
// (l'ancien est gardé à côté, en max-ancien.mp3) et le retient pour la prochaine fois.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, expandHome, loadConfig } from "./config.ts";
import { chercherMp3 } from "./max/musique.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Le mp3 voulu : un chemin, ou le plus récent dont le nom contient le mot. */
export function trouverMusique(demande: string, maison = os.homedir()): string | null {
  const direct = expandHome(demande);
  if (/\.mp3$/i.test(direct) && fs.existsSync(direct)) return direct;
  const motif = new RegExp(demande.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, ".?"), "i");
  const trouves = ["Downloads", "Desktop", "Music", "Documents", path.join("Music", "Music", "Media.localized", "Music")].flatMap((d) => chercherMp3(path.join(maison, d), motif));
  trouves.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return trouves[0] ?? null;
}

function main(): void {
  const demande = process.argv.slice(2).join(" ").trim();
  if (!demande) {
    console.log("Dis-moi laquelle : npm run musique -- bella   (un mot de son nom), ou un chemin vers ton mp3.");
    return;
  }
  const config = loadConfig(racine);
  const source = trouverMusique(demande);
  if (!source) {
    console.log(`⚠️  Aucun mp3 « ${demande} » dans Téléchargements, Bureau, Musique ou Documents. Donne-moi son chemin complet.`);
    return;
  }
  const cible = config.musique.fichier;
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  if (fs.existsSync(cible) && path.resolve(source) !== path.resolve(cible)) fs.copyFileSync(cible, path.join(path.dirname(cible), "max-ancien.mp3"));
  if (path.resolve(source) !== path.resolve(cible)) fs.copyFileSync(source, cible);
  // le mot retenu : si le fichier disparaît un jour, Max le retrouvera
  const fichier = path.join(racine, CONFIG_FILE);
  const c = fs.existsSync(fichier) ? (JSON.parse(fs.readFileSync(fichier, "utf8")) as Record<string, unknown>) : {};
  const mot = path.basename(source, ".mp3").split(/[_\s.-]+/).slice(0, 2).join(".?");
  c.musique = { ...((c.musique ?? {}) as object), recherche: mot };
  fs.writeFileSync(fichier, JSON.stringify(c, null, 2) + "\n");
  console.log(`✅ La musique de Max, c'est maintenant : ${path.basename(source)}`);
  console.log("   Relance Max (npm run arreter, puis « Dis Siri, Max au rapport ») pour l'entendre. L'ancienne est gardée en max-ancien.mp3.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
