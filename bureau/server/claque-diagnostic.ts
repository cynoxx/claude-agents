// `npm run claque-diagnostic` : vérifie tout ce dont dépendent les claquements, en 10 secondes, et dit ce qui coince.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { listeFfmpeg } from "./voix/diagnostic.ts";
import { listerMicros, choisirMicro } from "./voix/micro.ts";
import { argsFfmpegMicro } from "./voix/oreille.ts";
import { DetecteurClaques } from "./claque.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ok = (t: string) => console.log(`✅ ${t}`);
const ko = (t: string) => console.log(`❌ ${t}`);
const sortie = (bin: string, args: string[]) => new Promise<{ code: number; texte: string }>((r) => execFile(bin, args, { timeout: 8000 }, (e, o, s) => r({ code: e ? ((e as { code?: number }).code ?? 1) : 0, texte: `${o}${s}` })));

async function main(): Promise<void> {
  const config = loadConfig(racine);
  console.log("— Diagnostic des claquements —\n");
  if (process.platform !== "darwin") return void ko("Ça ne marche que sur Mac.");

  const v = await sortie(config.voix.ffmpeg, ["-version"]);
  if (v.code !== 0) return void ko("ffmpeg est introuvable : brew install ffmpeg");
  ok("ffmpeg est installé");

  const liste = (await listeFfmpeg(config.voix.ffmpeg)) ?? "";
  const micros = listerMicros(liste);
  const micro = config.voix.micro ?? choisirMicro(liste);
  if (!micro) return void ko("Aucun micro trouvé par ffmpeg. Réglages Système › Son › Entrée.");
  ok(`micros vus : ${micros.map((m) => `${m.index}=${m.nom}`).join(", ")} ; utilisé : ${micro}`);

  console.log("\n🎙  Test du micro pendant 5 secondes : CLAQUE TROIS FOIS dans tes mains maintenant…");
  let crete = 0;
  let octets = 0;
  let zeros = true;
  const claques: number[] = [];
  const dd = new DetecteurClaques({ seuil: config.claque.sensibilite, surClaque: (n) => claques.push(n) });
  await new Promise<void>((fin) => {
    const f = spawn(config.voix.ffmpeg, argsFfmpegMicro(micro), { stdio: ["ignore", "pipe", "pipe"] });
    let erreurs = "";
    f.stderr.on("data", (b: Buffer) => (erreurs += b));
    f.stdout.on("data", (b: Buffer) => {
      octets += b.length;
      if (!b.every((x) => x === 0)) zeros = false;
      dd.ajouter(b);
      crete = Math.max(crete, dd.crete());
    });
    f.on("close", () => {
      if (!octets) ko(`ffmpeg n'a rien capté : ${erreurs.trim().split("\n").slice(-2).join(" ") || "micro refusé"}. Autorise le micro : Réglages Système › Confidentialité › Microphone.`);
      fin();
    });
    setTimeout(() => f.kill(), 5000);
  });
  if (octets) {
    if (zeros) ko("Silence total : macOS refuse le micro à ce programme. Réglages Système › Confidentialité › Microphone : autorise le Terminal.");
    else if (crete < 0.03) ko(`Le micro est très faible (niveau max ${crete.toFixed(2)}) : augmente le volume d'entrée (Réglages Système › Son › Entrée) ou rapproche-toi.`);
    else ok(`le micro entend (niveau max ${crete.toFixed(2)}, seuil ${config.claque.sensibilite})`);
    if (claques.length >= 3) ok("3 claquements reconnus !");
    else if (octets && !zeros) ko(`${claques.length} claquement(s) reconnu(s) sur 3. ${crete < config.claque.sensibilite ? `Tes claquements sont sous le seuil : mets "claque": { "sensibilite": ${Math.max(0.04, +(crete * 0.6).toFixed(2))} } dans bureau.config.json.` : "Claque plus sec, un coup toutes les demi-secondes."}`);
  }

  console.log("");
  const lance = await sortie("launchctl", ["print", `gui/${os.userInfo().uid}/fr.bureau.claque`]);
  console.log(lance.code === 0 ? "✅ Le service est installé (il écoute en arrière-plan)." : "ℹ️  Le service n'est pas installé : npm run claque-installer -- terminal");
  const ps = await sortie("pgrep", ["-f", "server/claque.ts"]);
  if (ps.code === 0) console.log("✅ Le programme d'écoute tourne.");
  else {
    console.log(lance.code === 0 ? "❌ Le service est installé mais l'écoute ne tourne PAS : c'est la cause (relance : npm run claque-installer, il la démarre et vérifie)." : "ℹ️  Le programme d'écoute ne tourne pas en ce moment.");
    const etat = lance.texte.split("\n").filter((l) => /state =|last exit|runs =|program =/.test(l)).map((l) => `   ${l.trim()}`);
    if (etat.length) console.log(etat.join("\n"));
  }
  const journal = path.join(os.homedir(), "Library", "Logs", "Bureau-claque.log");
  if (fs.existsSync(journal)) console.log(`\n— Fin du journal (${journal}) :\n${fs.readFileSync(journal, "utf8").trim().split("\n").slice(-8).join("\n")}`);
  console.log("\nCopie tout ça et envoie-le-moi si ça ne marche toujours pas.");
}

void main();
