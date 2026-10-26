// Le réveil sur le Mac : à chaque tentative, Max parle sur ta musique, un peu plus fort à chaque fois (le volume du
// Mac monte de 60 à 100), et la page s'ouvre (caméra allumée si Max est verrouillé). Quand tu es réveillé, la musique
// s'arrête et le volume revient à ce qu'il était.
import os from "node:os";
import path from "node:path";
import { dureeWav } from "./message-reveil.ts";

export const VOLUMES = [60, 70, 80, 90, 100];

/** Ce que Max dit aux tentatives suivantes : de plus en plus insistant. */
export function texteInsistance(o: { essai: number; heure: Date; maintenant: Date; verrouille: boolean; prenom?: string }): string {
  const retard = Math.max(0, Math.round((o.maintenant.getTime() - o.heure.getTime()) / 60_000));
  const h = o.maintenant.getHours();
  const m = o.maintenant.getMinutes();
  const heure = `${h} heure${h > 1 ? "s" : ""}${m ? ` ${m}` : ""}`;
  const nom = o.prenom ? `${o.prenom}, ` : "";
  const phrases = [
    `Hé ! ${nom}il est ${heure}. Je sais que tu m'entends. Debout !`,
    `${nom}ça fait ${retard} minutes que je t'appelle. Pieds par terre, maintenant.`,
    `Allez, on se lève ! Chaque matin gagné, c'est un pas de plus vers l'examen.`,
    `Il est ${heure}. Je ne lâcherai pas : lève-toi et viens me voir.`,
  ];
  const phrase = phrases[(o.essai - 2) % phrases.length];
  const arreter = o.verrouille ? "Regarde la caméra pour me faire taire." : "Dis-moi « Max, je suis réveillé », ou clique sur le bouton.";
  return `${phrase} ${arreter}`;
}

export interface SonnerieMac {
  essai: number;
  heure: Date;
  test: boolean;
}

export class ReveilMac {
  private volumeAvant: number | null = null;
  private enCours = false;
  private numero = 0;

  constructor(
    private o: {
      mac: { volume(n: string): Promise<unknown>; lireVolume(): Promise<number | null> };
      musique: {
        disponible: boolean;
        mixerReveil(voix: string, duree: number, sortie: string): Promise<string | null>;
        jouerFichier(f: string): boolean;
        arreterLecture(): void;
        /** Ta musique tout de suite, pendant que la voix se fabrique (facultatif). */
        jouerAmorce?(): Promise<boolean>;
      };
      bouche: { enregistrer(texte: string, fichier: string): Promise<boolean>; dire(texte: string): void; taire(): void };
      /** Le message de la 1re tentative (heure, échéance, séance du jour). */
      premierMessage: (heure: Date) => string;
      verrou: { readonly verrouille: boolean; demander(): void } | null;
      /** Réveille Max (il écoute) quand il n'est pas verrouillé. */
      ecouter: () => void;
      ouvrirPage: () => void;
      prenom: () => string;
      dossier?: string;
      maintenant?: () => Date;
      /** Le temps laissé à la voix pour se fabriquer avant que Max parle en direct (XTTS peut être lent). */
      delaiVoixMs?: number;
      journal?: (m: string) => void;
    },
  ) {}

  async sonner(s: SonnerieMac): Promise<void> {
    const maintenant = this.o.maintenant?.() ?? new Date();
    if (!this.enCours) {
      this.enCours = true;
      this.volumeAvant = await this.o.mac.lireVolume();
      this.o.ouvrirPage();
    }
    const verrouille = !!this.o.verrou?.verrouille;
    // verrouillé : la caméra s'allume pour te reconnaître ; sinon Max t'écoute
    if (verrouille) this.o.verrou!.demander();
    else this.o.ecouter();
    await this.o.mac.volume(String(VOLUMES[Math.min(s.essai - 1, VOLUMES.length - 1)]));
    const texte =
      s.essai === 1
        ? `${this.o.premierMessage(s.heure)} ${verrouille ? "Regarde la caméra quand tu es debout." : "Dis-moi « Max, je suis réveillé » quand tu es debout."}`
        : texteInsistance({ essai: s.essai, heure: s.heure, maintenant, verrouille, prenom: this.o.prenom() });
    // la voix de Max sur ta musique ; sans musique (ou si ça rate), sa voix seule
    const journal = this.o.journal ?? (() => {});
    if (this.o.musique.disponible) {
      // ta musique démarre tout de suite : la voix (XTTS surtout) met du temps à se fabriquer
      const amorce = await this.o.musique.jouerAmorce?.().catch(() => false);
      const dossier = this.o.dossier ?? path.join(os.tmpdir(), "bureau-reveil");
      const n = ++this.numero;
      const wav = path.join(dossier, `reveil-mac-${n}.wav`);
      try {
        const delai = this.o.delaiVoixMs ?? 45_000;
        const prete = await Promise.race([this.o.bouche.enregistrer(texte, wav), new Promise<false>((r) => setTimeout(() => r(false), delai).unref?.())]);
        if (!this.enCours) return;
        if (prete) {
          const mp3 = await this.o.musique.mixerReveil(wav, dureeWav(wav), path.join(dossier, `reveil-mac-${n}.mp3`));
          if (mp3 && this.enCours && this.o.musique.jouerFichier(mp3)) return;
          journal("⏰ Réveil : le mélange voix + musique a échoué (ffmpeg ?) ; Max parle sur l'amorce.");
        } else journal(`⏰ Réveil : la voix n'était pas prête après ${Math.round(delai / 1000)} s ; Max parle en direct.`);
        // la voix n'a pas pu être mêlée à la musique : l'amorce continue, et Max parle par-dessus
        if (!amorce) this.o.musique.arreterLecture();
      } catch (e) {
        journal(`⏰ Réveil : erreur pendant la préparation de la voix (${(e as Error).message}).`);
      }
    } else journal("⏰ Réveil : pas de musique (aucun mp3 trouvé) ; Max parle seul.");
    if (this.enCours) this.o.bouche.dire(texte);
  }

  /** Réveillé (ou abandon) : la musique s'arrête, Max se tait, le volume revient. */
  async arreter(): Promise<void> {
    if (!this.enCours) return;
    this.enCours = false;
    this.o.musique.arreterLecture();
    this.o.bouche.taire();
    if (this.volumeAvant !== null) await this.o.mac.volume(String(this.volumeAvant));
    this.volumeAvant = null;
  }
}
