// Le Studio vidéo, gratuit et sur ton Mac. Dans le dossier « Max Studio » d'iCloud Drive (donc aussi sur ton iPhone) :
//   <Compte>/voix/    tu déposes ta voix (« Loi 9.m4a ») → le Studio monte la vidéo verticale sous-titrée
//   <Compte>/clips/   tu déposes une vidéo prête (Fruit TV) → mise au format vertical si besoin
//   <Compte>/fonds/   (facultatif) des vidéos ou images de fond ; <Compte>/musique/ (facultatif) la musique dessous
//   <Compte>/scripts/ les textes que Max t'écrit, à lire en t'enregistrant
//   Prêtes/<Compte>/  les vidéos montées, avec leur légende (.txt)
// Chaque vidéo est prévue un jour (une par jour et par compte) ; à l'heure de chaque plateforme, Max te le rappelle, et
// « publier » copie la légende, montre la vidéo et ouvre la page d'envoi (les API officielles gardent privées les vidéos
// envoyées par une appli non vérifiée : on publie donc toi-même, en un geste, depuis le Mac ou l'iPhone).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Plateforme, StudioVue, VideoStudio } from "../../shared/protocol.ts";
import type { CompteStudio, StudioConfig } from "../config.ts";
import { jourDe } from "../max/coach.ts";
import { argsMontage, argsVertical, argsVoix, legende, lireMotsWhisper, sousTitresAss, titreDepuisFichier, type Mot } from "./montage.ts";

export const DOSSIER_PRETES = "Prêtes";
const AUDIO = /\.(m4a|mp3|wav|aac|caf|aiff?|ogg|opus|flac)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const IMAGE = /\.(jpe?g|png|heic|webp)$/i;
export const PAGES_ENVOI: Record<Plateforme, string> = {
  tiktok: "https://www.tiktok.com/tiktokstudio/upload",
  youtube: "https://studio.youtube.com",
  instagram: "https://www.instagram.com",
};
export const NOM_PLATEFORME: Record<Plateforme, string> = { tiktok: "TikTok", youtube: "YouTube Shorts", instagram: "Instagram Reels" };

export type Executer = (bin: string, args: string[], o?: { timeoutMs?: number; entree?: string }) => Promise<{ ok: boolean; sortie: string; erreur: string }>;

const executerVraiment: Executer = (bin, args, o = {}) =>
  new Promise((resolve) => {
    const p = execFile(bin, args, { timeout: o.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024 }, (e, sortie, erreur) =>
      resolve({ ok: !e, sortie: String(sortie), erreur: String(erreur || (e as Error | null)?.message || "").trim() }),
    );
    if (o.entree !== undefined) p.stdin?.end(o.entree);
  });

interface Reponse {
  ok: boolean;
  texte: string;
}

interface VideoInterne extends VideoStudio {
  /** compte/nom|taille|date : pour ne pas traiter deux fois le même fichier. */
  source: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const heureDe = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const lendemain = (jour: string) => {
  const d = new Date(`${jour}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return jourDe(d);
};
const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const choisir = <T>(liste: T[], cle: string): T | null => (liste.length ? liste[parseInt(createHash("md5").update(cle).digest("hex").slice(0, 8), 16) % liste.length] : null);

/** Le jour où publier une nouvelle vidéo : le premier jour libre pour ce compte (aujourd'hui s'il reste une heure). */
export function jourLibre(videos: Pick<VideoStudio, "compte" | "jour" | "publiee">[], compte: CompteStudio, maintenant: Date): string {
  const heures = Object.values(compte.horaires).filter(Boolean).sort();
  let jour = jourDe(maintenant);
  if (!heures.length || heures.at(-1)! <= heureDe(maintenant)) jour = lendemain(jour);
  const pris = new Set(videos.filter((v) => v.compte === compte.id && v.jour).map((v) => v.jour));
  while (pris.has(jour)) jour = lendemain(jour);
  return jour;
}

export class Studio extends EventEmitter {
  private videos: VideoInterne[] = [];
  private readonly fichierEtat: string;
  private minuteur?: NodeJS.Timeout;
  private horloge?: NodeJS.Timeout;
  private file: Promise<void> = Promise.resolve();
  private vus = new Map<string, string>();
  private derniereMinute = "";
  private readonly executer: Executer;

  constructor(
    private o: {
      config: StudioConfig & { dossier: string };
      ffmpeg: string;
      whisper: { bin: string; modele: string };
      dossierEtat: string;
      maintenant?: () => Date;
      executer?: Executer;
      /** Tous les combien regarder les dossiers (ms). */
      intervalleMs?: number;
    },
  ) {
    super();
    this.executer = o.executer ?? executerVraiment;
    this.fichierEtat = path.join(o.dossierEtat, "studio", "videos.json");
    try {
      this.videos = JSON.parse(fs.readFileSync(this.fichierEtat, "utf8"));
    } catch {
      this.videos = [];
    }
    // une vidéo en montage quand Max s'est arrêté : à refaire
    this.videos = this.videos.filter((v) => v.statut !== "montage");
  }

  private get maintenant(): Date {
    return this.o.maintenant?.() ?? new Date();
  }
  private get dossier(): string {
    return this.o.config.dossier;
  }
  private dossierCompte(c: CompteStudio, sous: string): string {
    return path.join(this.dossier, c.nom, sous);
  }
  private compte(cle: string): CompteStudio | undefined {
    const c = sansAccents(cle);
    return this.o.config.comptes.find((x) => x.id === cle || sansAccents(x.nom) === c);
  }

  /** Crée les dossiers, puis regarde les dépôts régulièrement et rappelle les publications à l'heure. */
  demarrer(): void {
    for (const c of this.o.config.comptes) {
      for (const sous of [c.type === "voix" ? "voix" : "clips", "scripts", ...(c.type === "voix" ? ["fonds", "musique"] : [])]) fs.mkdirSync(this.dossierCompte(c, sous), { recursive: true });
      fs.mkdirSync(path.join(this.dossier, DOSSIER_PRETES, c.nom), { recursive: true });
    }
    void this.scanner();
    this.minuteur = setInterval(() => void this.scanner(), this.o.intervalleMs ?? 20_000);
    this.horloge = setInterval(() => this.verifierHeure(), 15_000);
  }

  arreter(): void {
    clearInterval(this.minuteur);
    clearInterval(this.horloge);
  }

  /** Regarde les dossiers de dépôt ; un fichier dont la taille n'a pas bougé depuis le dernier passage est traité. */
  async scanner(): Promise<void> {
    for (const c of this.o.config.comptes) {
      const dos = this.dossierCompte(c, c.type === "voix" ? "voix" : "clips");
      let noms: string[] = [];
      try {
        noms = fs.readdirSync(dos);
      } catch {
        continue;
      }
      for (const nom of noms) {
        if (nom.startsWith(".") || !(c.type === "voix" ? AUDIO : VIDEO).test(nom)) continue; // « .Loi 9.m4a.icloud » : pas encore téléchargé
        const f = path.join(dos, nom);
        let st: fs.Stats;
        try {
          st = fs.statSync(f);
        } catch {
          continue;
        }
        const source = `${c.id}/${nom}|${st.size}|${Math.round(st.mtimeMs)}`;
        if (this.videos.some((v) => v.source === source)) continue;
        // encore en train d'arriver (iCloud, AirDrop) : on attend qu'il ne bouge plus
        if (this.vus.get(f) !== source) {
          this.vus.set(f, source);
          continue;
        }
        this.vus.delete(f);
        this.ajouter(c, f, source);
      }
    }
    await this.file;
  }

  private ajouter(c: CompteStudio, f: string, source: string): void {
    const titre = titreDepuisFichier(path.basename(f));
    const v: VideoInterne = { id: `${c.id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, compte: c.id, titre, statut: "montage", publiee: {}, creee: jourDe(this.maintenant), source };
    this.videos.push(v);
    this.sauver();
    this.file = this.file.then(() => this.monter(c, v, f));
  }

  private async monter(c: CompteStudio, v: VideoInterne, f: string): Promise<void> {
    const sortieDos = path.join(this.dossier, DOSSIER_PRETES, c.nom);
    fs.mkdirSync(sortieDos, { recursive: true });
    const sortie = path.join(sortieDos, `${v.titre}.mp4`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bureau-studio-"));
    try {
      let texte = "";
      if (c.type === "clips") {
        const largeur = await this.taille(f);
        if (largeur && largeur.l < largeur.h) fs.copyFileSync(f, sortie);
        else {
          const r = await this.executer(this.o.ffmpeg, argsVertical(f, sortie), { timeoutMs: 15 * 60_000 });
          if (!r.ok) throw new Error(`ffmpeg : ${r.erreur.split("\n").slice(-2).join(" ")}`);
        }
      } else {
        const wav = path.join(tmp, "voix.wav");
        const r1 = await this.executer(this.o.ffmpeg, argsVoix(f, wav));
        if (!r1.ok) throw new Error(`ta voix n'a pas pu être lue (${r1.erreur.split("\n").at(-1)})`);
        const mots = await this.mots(wav, tmp);
        texte = mots.map((m) => m.texte).join(" ");
        const dureeVoix = (await this.duree(wav)) ?? (mots.at(-1)?.fin ?? 0) + 0.3;
        const duree = Math.max(4, dureeVoix + 0.8 + (c.appel ? 1.2 : 0));
        const ass = path.join(tmp, "s.ass");
        fs.writeFileSync(ass, sousTitresAss(mots, duree, { titre: v.titre, bandeau: c.bandeau, appel: c.appel, couleur: c.couleur }));
        const fonds = this.fichiers(this.dossierCompte(c, "fonds"), (n) => VIDEO.test(n) || IMAGE.test(n));
        const fond = choisir(fonds, v.titre);
        const musique = choisir(this.fichiers(this.dossierCompte(c, "musique"), (n) => AUDIO.test(n)), v.titre);
        const r2 = await this.executer(
          this.o.ffmpeg,
          argsMontage({ voix: wav, ass, sortie, duree, fond: fond ? { fichier: fond, type: VIDEO.test(fond) ? "video" : "image" } : null, musique, teinte: "#3a0d12" }),
          { timeoutMs: 15 * 60_000 },
        );
        if (!r2.ok) throw new Error(`le montage a échoué (${r2.erreur.split("\n").slice(-2).join(" ")})`);
        v.duree = Math.round(duree);
      }
      v.legende = legende(c.legende, v.titre, texte);
      fs.writeFileSync(path.join(sortieDos, `${v.titre}.txt`), v.legende + "\n");
      v.fichier = sortie;
      v.statut = "prete";
      v.jour = jourLibre(this.videos.filter((x) => x !== v && x.statut === "prete"), c, this.maintenant);
      this.emit("prete", `🎬 Vidéo prête : ${c.nom} — ${v.titre}, prévue le ${v.jour}.`);
    } catch (e) {
      v.statut = "erreur";
      v.erreur = (e as Error).message;
      this.emit("prete", `⚠️ Studio : ${c.nom} — ${v.titre} : ${v.erreur}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      this.sauver();
    }
  }

  private fichiers(dos: string, garder: (n: string) => boolean): string[] {
    try {
      return fs
        .readdirSync(dos)
        .filter((n) => !n.startsWith(".") && garder(n))
        .sort()
        .map((n) => path.join(dos, n));
    } catch {
      return [];
    }
  }

  private get ffprobe(): string {
    return path.join(path.dirname(this.o.ffmpeg), "ffprobe").replace(/^ffprobe$|^\.\/ffprobe$/, "ffprobe");
  }

  private async duree(f: string): Promise<number | null> {
    const r = await this.executer(this.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]);
    const d = parseFloat(r.sortie);
    return r.ok && d > 0 ? d : null;
  }

  private async taille(f: string): Promise<{ l: number; h: number } | null> {
    const r = await this.executer(this.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f]);
    const [l, h] = r.sortie.trim().split(",").map(Number);
    return r.ok && l > 0 && h > 0 ? { l, h } : null;
  }

  /** Les mots minutés de ta voix (Whisper, un mot par segment). Sans Whisper : pas de sous-titres, la vidéo se fait quand même. */
  private async mots(wav: string, tmp: string): Promise<Mot[]> {
    if (!fs.existsSync(this.o.whisper.modele)) return [];
    const base = path.join(tmp, "mots");
    const fils = String(Math.min(8, Math.max(2, os.cpus().length)));
    const r = await this.executer(this.o.whisper.bin, ["-m", this.o.whisper.modele, "-l", "fr", "-ml", "1", "-sow", "-oj", "-of", base, "-np", "-t", fils, "-f", wav], { timeoutMs: 10 * 60_000 });
    try {
      return r.ok ? lireMotsWhisper(fs.readFileSync(`${base}.json`, "utf8")) : [];
    } catch {
      return [];
    }
  }

  private sauver(): void {
    fs.mkdirSync(path.dirname(this.fichierEtat), { recursive: true });
    fs.writeFileSync(this.fichierEtat, JSON.stringify(this.videos.slice(-200), null, 2) + "\n");
    this.emit("etat");
  }

  /** Les prochaines publications prévues (pas encore faites), dans l'ordre. */
  prochaines(n = 6): StudioVue["prochaines"] {
    const auj = jourDe(this.maintenant);
    const out: StudioVue["prochaines"] = [];
    for (const v of this.videos) {
      const c = this.compte(v.compte);
      if (!c || v.statut !== "prete" || !v.jour) continue;
      for (const [p, h] of Object.entries(c.horaires) as [Plateforme, string][]) {
        if (h && !v.publiee[p]) out.push({ id: v.id, titre: v.titre, compte: c.nom, plateforme: p, quand: `${v.jour < auj ? auj : v.jour} ${h}` });
      }
    }
    return out.sort((a, b) => a.quand.localeCompare(b.quand)).slice(0, n);
  }

  /** À l'heure d'une publication prévue aujourd'hui, le rappel (une fois). */
  private verifierHeure(): void {
    const d = this.maintenant;
    const minute = `${jourDe(d)} ${heureDe(d)}`;
    if (minute === this.derniereMinute) return;
    this.derniereMinute = minute;
    for (const p of this.prochaines(50)) {
      if (p.quand !== minute) continue;
      this.emit("rappel", `C'est l'heure de poster « ${p.titre} » sur ${NOM_PLATEFORME[p.plateforme]} (${p.compte}). Dis-moi « publie-la » et je te prépare tout.`, p);
    }
  }

  private trouver(cle: string): VideoInterne | undefined {
    const c = sansAccents(cle);
    const prets = this.videos.filter((v) => v.statut === "prete");
    return this.videos.find((v) => v.id === cle) ?? prets.find((v) => sansAccents(v.titre) === c) ?? prets.find((v) => sansAccents(v.titre).includes(c));
  }

  /** Prépare la publication : légende copiée, vidéo montrée dans le Finder, page d'envoi ouverte. */
  async publier(cle: string, plateforme: Plateforme): Promise<Reponse> {
    const v = cle ? this.trouver(cle) : this.videos.find((x) => this.prochaines(50).some((p) => p.id === x.id && p.plateforme === plateforme));
    if (!v || v.statut !== "prete" || !v.fichier) return { ok: false, texte: `Pas de vidéo prête${cle ? ` pour « ${cle} »` : ""}.` };
    await this.executer("pbcopy", [], { entree: v.legende ?? "" });
    await this.executer("open", ["-R", v.fichier]);
    await this.executer("open", [PAGES_ENVOI[plateforme]]);
    return { ok: true, texte: `« ${v.titre} » est prête pour ${NOM_PLATEFORME[plateforme]} : la légende est copiée (colle-la), la vidéo est montrée dans le Finder et la page d'envoi est ouverte. Sur l'iPhone, elle est dans Fichiers › iCloud Drive › Max Studio › ${DOSSIER_PRETES}. Dis-moi quand c'est posté.` };
  }

  marquerPubliee(cle: string, plateforme: Plateforme): Reponse {
    const v = this.trouver(cle);
    if (!v || v.statut !== "prete") return { ok: false, texte: `Vidéo introuvable : ${cle}.` };
    v.publiee[plateforme] = jourDe(this.maintenant);
    this.sauver();
    const reste = Object.keys(this.compte(v.compte)?.horaires ?? {}).filter((p) => !v.publiee[p as Plateforme]);
    return { ok: true, texte: `« ${v.titre} » publiée sur ${NOM_PLATEFORME[plateforme]}.${reste.length ? ` Reste : ${reste.map((p) => NOM_PLATEFORME[p as Plateforme]).join(", ")}.` : " Partout, bravo."}` };
  }

  /** Change le jour prévu d'une vidéo. */
  replanifier(cle: string, jour: string): Reponse {
    const v = this.trouver(cle);
    if (!v || v.statut !== "prete") return { ok: false, texte: `Vidéo introuvable : ${cle}.` };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return { ok: false, texte: "Jour au format AAAA-MM-JJ." };
    v.jour = jour;
    this.sauver();
    return { ok: true, texte: `« ${v.titre} » prévue le ${jour}.` };
  }

  /** Écrit le script d'une vidéo dans <Compte>/scripts, pour le lire en s'enregistrant (aussi sur l'iPhone). */
  script(compte: string, titre: string, texte: string): Reponse {
    const c = this.compte(compte);
    if (!c) return { ok: false, texte: `Compte inconnu : ${compte} (${this.o.config.comptes.map((x) => x.nom).join(", ")}).` };
    const nom = titre.replace(/[/\\:*?"<>|]+/g, " ").trim().slice(0, 80);
    if (!nom || !texte.trim()) return { ok: false, texte: "Il faut un titre et un texte." };
    const dos = this.dossierCompte(c, "scripts");
    fs.mkdirSync(dos, { recursive: true });
    fs.writeFileSync(path.join(dos, `${nom}.txt`), texte.trim() + "\n");
    return { ok: true, texte: `Script « ${nom} » rangé dans Max Studio › ${c.nom} › scripts. Enregistre-toi en le lisant, puis dépose l'audio en le nommant « ${nom} » dans ${c.nom} › voix.` };
  }

  vue(): StudioVue {
    return {
      dossier: this.dossier,
      comptes: this.o.config.comptes.map((c) => ({ id: c.id, nom: c.nom, type: c.type, horaires: c.horaires })),
      videos: this.videos.slice(-30).map(({ source: _s, ...v }) => v),
      prochaines: this.prochaines(),
    };
  }

  /** Pour le contexte de Max. */
  decrire(): string {
    const auj = jourDe(this.maintenant);
    const p = this.prochaines(4);
    const enRetard = this.videos.filter((v) => v.statut === "prete" && v.jour && v.jour < auj && Object.keys(this.compte(v.compte)?.horaires ?? {}).some((x) => !v.publiee[x as Plateforme]));
    const aujourdhui = this.o.config.comptes.filter((c) => c.type === "voix" && !this.videos.some((v) => v.compte === c.id && v.jour === auj));
    return [
      `Studio vidéo : ${p.length ? `prochaines publications : ${p.map((x) => `${x.titre} (${x.compte}) sur ${NOM_PLATEFORME[x.plateforme]} le ${x.quand}`).join(" ; ")}` : "rien de prévu"}.`,
      enRetard.length ? `En retard (pas encore postées) : ${enRetard.map((v) => v.titre).join(", ")}.` : "",
      aujourdhui.length ? `Pas encore de vidéo pour aujourd'hui : ${aujourdhui.map((c) => c.nom).join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
}
