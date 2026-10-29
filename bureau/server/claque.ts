// Trois claquements de mains → Max s'allume. Un petit programme qui écoute le micro en continu (ffmpeg), détecte les
// claquements (un son bref et fort, puis le silence : la voix et la musique ne ressemblent pas à ça) et lance
// scripts/reveiller-max.sh, comme « Dis Siri, Max au rapport ». Rien n'est enregistré ni envoyé : le son est analysé
// au vol, sur le Mac, puis jeté.
//   npm run claque              l'essayer dans le Terminal
//   npm run claque-installer    le lancer tout seul à chaque ouverture de session
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";
import { listeFfmpeg } from "./voix/diagnostic.ts";
import { choisirMicro } from "./voix/micro.ts";
import { argsFfmpegMicro } from "./voix/oreille.ts";
import { TAUX } from "./voix/vad.ts";

const IMAGE_MS = 20;
const IMAGE = Math.round((TAUX * IMAGE_MS) / 1000);

export interface OptionsClaques {
  /** Niveau minimum d'un claquement (0 à 1, rapporté au maximum du micro). Plus bas : plus sensible. */
  seuil?: number;
  /** Combien de claquements il faut. */
  combien?: number;
  /** Les claquements doivent tenir dans cette durée (ms). */
  fenetreMs?: number;
  /** Appelé à chaque claquement reconnu (1, 2, 3…), pour montrer qu'il entend. */
  surClaque?: (numero: number) => void;
  /** Appelé quand un son fort est refusé parce qu'il dure trop (voix, musique) : aide à régler. */
  surRejet?: (niveau: number) => void;
}

/**
 * Détecte des claquements dans un flux PCM 16 bits mono. Un claquement : l'énergie grimpe d'un coup bien au-dessus du
 * bruit ambiant, puis retombe en moins de ~120 ms. La parole ou la musique restent fortes plus longtemps : refusées.
 * Le temps est compté en échantillons : le résultat ne dépend pas de l'horloge (testable).
 */
export class DetecteurClaques {
  private reste = Buffer.alloc(0);
  private image = 0;
  private fond = 0.01;
  private pic = 0;
  private depuis = -1;
  private dernier = -1e9;
  private claques: number[] = [];
  private muetJusqua = -1;
  /** Un son long a été refusé : on attend qu'il se termine avant de réécouter (sinon sa fin pourrait compter). */
  private attente = false;
  /** Le niveau le plus fort entendu depuis la dernière lecture (0 à 1). */
  private creteMax = 0;
  private o: Required<OptionsClaques>;

  constructor(o: OptionsClaques = {}) {
    this.o = { seuil: o.seuil ?? 0.12, combien: o.combien ?? 3, fenetreMs: o.fenetreMs ?? 2800, surClaque: o.surClaque ?? (() => {}), surRejet: o.surRejet ?? (() => {}) };
  }

  /** Le niveau le plus fort depuis le dernier appel (puis remis à zéro). */
  crete(): number {
    const c = this.creteMax;
    this.creteMax = 0;
    return c;
  }

  /** Renvoie true quand le dernier morceau complète la série de claquements. */
  ajouter(pcm: Buffer): boolean {
    const tout = Buffer.concat([this.reste, pcm]);
    const n = Math.floor(tout.length / (IMAGE * 2));
    this.reste = tout.subarray(n * IMAGE * 2);
    let declenche = false;
    for (let i = 0; i < n; i++) {
      let somme = 0;
      for (let k = 0; k < IMAGE; k++) {
        const s = tout.readInt16LE((i * IMAGE + k) * 2) / 32768;
        somme += s * s;
      }
      if (this.traiter(Math.sqrt(somme / IMAGE))) declenche = true;
    }
    return declenche;
  }

  private traiter(rms: number): boolean {
    const t = this.image++ * IMAGE_MS;
    if (rms > this.creteMax) this.creteMax = rms;
    if (this.attente) {
      if (rms < Math.max(this.fond * 3, this.o.seuil * 0.4)) this.attente = false;
      return false;
    }
    if (this.depuis < 0) {
      // le bruit de fond suit doucement l'ambiance (jamais en dessous d'un plancher)
      this.fond = Math.max(0.004, this.fond * 0.98 + rms * 0.02);
      if (rms > Math.max(this.o.seuil, this.fond * 6) && t - this.dernier > 120) {
        this.depuis = t;
        this.pic = rms;
      }
      return false;
    }
    this.pic = Math.max(this.pic, rms);
    const duree = t - this.depuis;
    if (rms < this.pic * 0.3 && duree <= 140) {
      // retombé vite : un claquement
      this.depuis = -1;
      this.dernier = t;
      if (t < this.muetJusqua) return false;
      this.claques = this.claques.filter((c) => t - c <= this.o.fenetreMs);
      this.claques.push(t);
      this.o.surClaque(this.claques.length);
      if (this.claques.length >= this.o.combien) {
        this.claques = [];
        this.muetJusqua = t + 8000;
        return true;
      }
      return false;
    }
    if (duree > 140) {
      // trop long : de la voix, de la musique, un bruit continu
      this.depuis = -1;
      this.attente = true;
      this.o.surRejet(this.pic);
    }
    return false;
  }
}

async function main(): Promise<void> {
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const config = loadConfig(process.env.BUREAU_CONFIG_DIR ?? racine);
  const seuil = Number(process.env.CLAQUE_SEUIL) || config.claque.sensibilite;
  const niveaux = process.argv.includes("--niveaux") || !!process.env.CLAQUE_NIVEAUX;
  const detecteur = new DetecteurClaques({
    seuil,
    surClaque: (n) => console.log(`${"👏".repeat(n)} ${n}/3`),
    surRejet: (niveau) => niveaux && console.log(`   (son fort mais trop long, niveau ${niveau.toFixed(2)} : voix ou musique, ignoré)`),
  });
  // --niveaux : montre le niveau du micro chaque seconde, pour régler la sensibilité
  if (niveaux) setInterval(() => console.log(`🎚  niveau ${"█".repeat(Math.min(40, Math.round(detecteur.crete() * 80)))} (seuil ${seuil})`), 1000).unref();
  let ffmpeg: ChildProcess | null = null;
  let silence = 0;
  let averti = false;

  const lancerMax = () => {
    console.log(`👏 Trois claquements : j'allume Max (${new Date().toLocaleTimeString("fr-FR")}).`);
    // la sortie du script (ses erreurs, s'il y en a) va dans le même journal
    const p = spawn("bash", [path.join(racine, "scripts", "reveiller-max.sh")], { stdio: ["ignore", "inherit", "inherit"], detached: true, env: { ...process.env, BUREAU_CLAQUE: "1" } });
    p.on("exit", (code) => console.log(code === 0 ? "✅ Max est allumé." : `⚠️  Le script de Max a échoué (code ${code}) : regarde ~/Library/Logs/Bureau.log`));
    p.unref();
  };

  const ecouter = async () => {
    const micro = config.voix.micro ?? choisirMicro((await listeFfmpeg(config.voix.ffmpeg)) ?? "");
    if (!micro) {
      console.log("⚠️  Aucun micro trouvé : je réessaie dans 30 s.");
      return setTimeout(() => void ecouter(), 30_000);
    }
    console.log(`👂 J'écoute les claquements (micro ${micro}, seuil ${seuil}). Claque trois fois dans tes mains pour allumer Max.`);
    ffmpeg = spawn(config.voix.ffmpeg, argsFfmpegMicro(micro), { stdio: ["ignore", "pipe", "pipe"] });
    ffmpeg.stderr!.on("data", (d: Buffer) => process.stderr.write(d));
    ffmpeg.stdout!.on("data", (b: Buffer) => {
      // un micro non autorisé donne du silence parfait : on le dit une fois
      silence = b.every((x) => x === 0) ? silence + b.length : 0;
      if (silence > TAUX * 2 * 12 && !averti) {
        averti = true;
        console.log("⚠️  Je n'entends rien du tout : le micro n'est sans doute pas autorisé. Réglages Système › Confidentialité › Microphone.");
      }
      if (detecteur.ajouter(b)) lancerMax();
    });
    const debut = Date.now();
    ffmpeg.on("close", (code) => {
      if (Date.now() - debut < 4000) {
        console.log(`⚠️  ffmpeg s'arrête tout de suite (code ${code}) : en arrière-plan, macOS refuse souvent le micro. Essaie : npm run claque-installer -- terminal`);
      }
      setTimeout(() => void ecouter(), 5000);
    });
    ffmpeg.on("error", (e) => console.log(`⚠️  ffmpeg : ${e.message}`));
  };
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => {
    ffmpeg?.kill();
    process.exit(0);
  });
  await ecouter();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) void main();
