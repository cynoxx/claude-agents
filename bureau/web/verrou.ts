// L'écran verrouillé (« Face ID » du Bureau) et l'enregistrement du visage.
// Verrouillé : la caméra s'allume quand on vient de demander Max (Siri) ou d'un clic ; il faut être reconnu ET
// tourner la tête à gauche puis à droite (une photo ne le peut pas). La caméra s'éteint dès que c'est fini, ou au
// bout de 30 secondes.
import type { ClientMessage, ServerMessage, VerrouVue } from "../shared/protocol.ts";
import { son } from "./sons.ts";
import { CameraVisage } from "./camera-visage.ts";
import { ScanVisage } from "./scan-visage.ts";
import { MouvementTete } from "./visage-pur.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const DUREE_MS = 30_000;
/** Après une reconnaissance ratée, le guet reprend au bout de 15 secondes. */
const PAUSE_GUET_MS = 15_000;
const PREF_GUET = "max-guet";
const lirePref = (cle: string) => {
  try {
    return localStorage.getItem(cle) !== "non";
  } catch {
    return true;
  }
};
const DEMANDE_RECENTE_MS = 60_000;
const PRISES = 5;
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class EcranVerrou {
  private camera = new CameraVisage($<HTMLVideoElement>("v-video"));
  private cameraInscription = new CameraVisage($<HTMLVideoElement>("vr-video"));
  private vue?: VerrouVue;
  private session = 0; // une recherche en cours (pour pouvoir l'arrêter)
  private derniereDemandeVue = 0;
  private reponse?: (r: { ok: boolean; texte: string }) => void;
  /** Le guet : verrouillé, la caméra repère ton arrivée et lance la reconnaissance toute seule. */
  private guetVoulu = lirePref(PREF_GUET);
  private enGuet = false;
  private pauseGuetJusqua = 0;
  private relanceGuet?: number;
  /** Le scanner plein écran pendant la reconnaissance, et la sortie (le grand final) en cours. */
  private scan = new ScanVisage($<HTMLCanvasElement>("v-scan"), $<HTMLVideoElement>("v-video"));
  private enSortie = false;
  /** Une vérification attend la réponse du Bureau (qui annonce le déverrouillage juste avant de répondre). */
  private verifEnCours = false;

  constructor(private envoyer: (m: ClientMessage) => void) {
    $("v-camera").addEventListener("click", () => {
      // pendant le guet, la caméra est déjà allumée : la reconnaissance la reprend
      const guet = this.enGuet;
      if (guet) this.session++;
      void this.reconnaitre(guet);
    });
    $("v-guet").addEventListener("click", () => {
      this.guetVoulu = !this.guetVoulu;
      try {
        localStorage.setItem(PREF_GUET, this.guetVoulu ? "oui" : "non");
      } catch {
        // pas de mémoire du navigateur : le choix vaut pour cette page
      }
      if (!this.guetVoulu && this.enGuet) this.stopper();
      this.majGuet();
      this.peutEtreAutomatique();
    });
    $("j-visage").addEventListener("click", () => this.ouvrirReglages());
    $("vr-fermer").addEventListener("click", () => this.fermerReglages());
    $("vr-enregistrer").addEventListener("click", () => this.inscrire());
    $("vr-verrouiller").addEventListener("click", () => {
      this.fermerReglages();
      this.envoyer({ type: "verrouiller" });
    });
    $("vr-effacer").addEventListener("click", () => {
      if (confirm("Effacer ton visage ? Max ne sera plus verrouillé.")) this.envoyer({ type: "visage-effacer" });
    });
    document.addEventListener("visibilitychange", () => this.peutEtreAutomatique());
  }

  /** La réponse du serveur à une vérification, un enregistrement ou un effacement. */
  recevoir(m: Extract<ServerMessage, { type: "visage" }>): void {
    if (this.reponse) {
      this.reponse(m);
      this.reponse = undefined;
    } else this.statut(m.texte, m.ok);
  }

  rendre(v: VerrouVue | undefined, alarme = false): void {
    this.vue = v;
    const verrouille = !!v?.verrouille;
    // reconnu : l'écran reste le temps du grand final, puis s'efface
    const garder = this.enSortie || this.verifEnCours;
    $("verrou").hidden = !verrouille && !garder;
    document.body.dataset.verrou = verrouille ? "oui" : "non";
    $("verrou").classList.toggle("v-alarme", alarme);
    if (v) $("v-titre").textContent = alarme ? "⏰ Debout ! Regarde la caméra pour arrêter le réveil" : v.prenom ? `Bonjour ${v.prenom} ?` : "Max est verrouillé";
    $("j-visage").textContent = v?.enregistre ? "🔐 Visage" : "🔐 Activer le visage";
    $("j-visage").hidden = !v?.actif;
    if (!verrouille && this.camera.allumee && !garder) {
      this.session++;
      this.camera.arreter();
      $("v-cadre").dataset.actif = "non";
    }
    this.majReglages();
    this.majGuet();
    this.peutEtreAutomatique();
  }

  /** Une demande de réveil récente (Siri) allume la caméra toute seule, si la page est visible ; sinon, le guet. */
  private peutEtreAutomatique(): void {
    const v = this.vue;
    if (!v?.verrouille || document.hidden) return;
    if (v.demande && v.demande !== this.derniereDemandeVue && Date.now() - v.demande < DEMANDE_RECENTE_MS) {
      this.derniereDemandeVue = v.demande;
      if (this.enGuet) this.session++;
      if (!this.camera.allumee || this.enGuet) void this.reconnaitre(this.camera.allumee);
      return;
    }
    void this.guetter();
  }

  private majGuet(): void {
    const b = $("v-guet");
    b.hidden = !this.vue?.enregistre;
    b.textContent = this.guetVoulu ? "👁 Max guette ton arrivée · arrêter" : "👁 Guetter mon arrivée";
    b.dataset.actif = this.guetVoulu ? "oui" : "non";
  }

  /**
   * Le guet : la caméra regarde, en petit et doucement (une image toutes les 0,6 s, sans l'afficher). Dès qu'un
   * visage apparaît deux fois de suite, la reconnaissance démarre toute seule. Rien ne sort de la page.
   */
  private async guetter(): Promise<void> {
    const v = this.vue;
    if (!this.guetVoulu || !v?.verrouille || !v.enregistre || document.hidden || this.camera.allumee || this.enGuet) return;
    const attente = this.pauseGuetJusqua - Date.now();
    if (attente > 0) {
      clearTimeout(this.relanceGuet);
      this.relanceGuet = window.setTimeout(() => void this.guetter(), attente + 50);
      return;
    }
    this.enGuet = true;
    const session = ++this.session;
    $("verrou").dataset.guet = "oui";
    this.statut("👁 Max guette ton arrivée…");
    try {
      await this.camera.demarrer();
    } catch {
      this.enGuet = false;
      $("verrou").dataset.guet = "non";
      this.statut("Passe devant la caméra pour que Max te reconnaisse.");
      return;
    }
    let vus = 0;
    while (session === this.session && this.vue?.verrouille && !document.hidden && this.guetVoulu) {
      const d = await this.camera.detecter().catch(() => null);
      vus = d && d.score > 0.6 ? vus + 1 : 0;
      if (vus >= 2) break;
      await attendre(600);
    }
    this.enGuet = false;
    $("verrou").dataset.guet = "non";
    if (session !== this.session) return;
    if (vus >= 2 && this.vue?.verrouille) {
      // te voilà : la reconnaissance démarre, avec la caméra déjà allumée
      await this.reconnaitre(true);
      this.pauseGuetJusqua = Date.now() + PAUSE_GUET_MS;
      void this.guetter();
    } else this.stopper();
  }

  private statut(texte: string, ok = false): void {
    const s = $("v-statut");
    s.textContent = texte;
    s.dataset.ok = ok ? "oui" : "non";
  }

  private stopper(): void {
    this.session++;
    if (!this.enSortie) {
      this.scan.arreter();
      $("verrou").dataset.scan = "non";
    }
    this.camera.arreter();
    this.cameraInscription.arreter();
    $("v-cadre").dataset.actif = "non";
    $("vr-cadre").dataset.actif = "non";
  }

  private async allumer(): Promise<boolean> {
    try {
      this.statut("Allumage de la caméra…");
      await this.camera.demarrer();
      return true;
    } catch (e) {
      const nom = (e as DOMException).name;
      this.statut(
        nom === "NotAllowedError"
          ? "La caméra est refusée : autorise-la pour cette page (icône dans la barre d'adresse), puis réessaie."
          : nom === "NotFoundError"
            ? "Aucune caméra trouvée."
            : `La caméra ne démarre pas : ${(e as Error).message}`,
      );
      this.stopper();
      return false;
    }
  }

  /** Verrouillé : cherche ton visage qui tourne à gauche et à droite, et l'envoie au Bureau pour vérification. */
  async reconnaitre(cameraDejaAllumee = false): Promise<void> {
    if (this.camera.allumee && !cameraDejaAllumee) return;
    const session = ++this.session;
    $("v-cadre").dataset.actif = "oui";
    if (!cameraDejaAllumee && !(await this.allumer())) return;
    // l'écran devient un scanner
    $("verrou").dataset.scan = "oui";
    this.scan.demarrer();
    son("clic");
    const tete = new MouvementTete();
    let dernierEnvoi = 0;
    const fin = Date.now() + DUREE_MS;
    this.statut("Regarde la caméra, puis tourne doucement la tête à gauche et à droite.");
    while (session === this.session && Date.now() < fin && this.vue?.verrouille) {
      const a = await this.camera.analyser(false).catch(() => null);
      this.scan.voir(a);
      if (!a) {
        this.statut("Je ne vois pas ton visage : mets-toi bien en face.");
        await attendre(80);
        continue;
      }
      tete.ajouter(a.lacet);
      const reste = tete.reste;
      this.scan.progres(reste === "les deux" ? 0.3 : reste ? 0.55 : 0.8, reste === "les deux" ? "Visage verrouillé" : reste ? "Vivacité : un côté" : "Empreinte en cours");
      if (reste) {
        this.statut(reste === "les deux" ? "Je te vois. Tourne doucement la tête à gauche, puis à droite." : "Maintenant, tourne la tête de l'autre côté.");
        continue;
      }
      if (Date.now() - dernierEnvoi < 1200) continue;
      const net = await this.camera.analyser(true).catch(() => null);
      if (!net?.descripteur) continue;
      dernierEnvoi = Date.now();
      this.statut("Vérification…");
      this.scan.progres(0.9, "Comparaison");
      this.verifEnCours = true;
      const r = await this.demanderAuServeur({ type: "visage-verifier", descripteur: net.descripteur, vivant: true });
      this.verifEnCours = false;
      if (r.ok) {
        this.statut("Reconnu !", true);
        son("deverrouille");
        await this.sortir();
        return;
      }
      this.scan.refuser();
      son("ferme");
      this.statut(r.texte);
    }
    if (session === this.session) {
      if (this.vue?.verrouille) this.statut("Je ne t'ai pas reconnu. Clique sur « Me reconnaître » pour réessayer.");
      this.stopper();
    }
  }

  /** Le grand final : « Accès autorisé », ton visage s'envole en particules vers Max, puis l'écran s'efface. */
  private async sortir(): Promise<void> {
    this.enSortie = true;
    $("verrou").hidden = false;
    const ecran = $("verrou");
    ecran.dataset.scan = "accorde";
    await this.scan.accorder(this.vue?.prenom ?? "");
    ecran.classList.add("v-sort");
    await attendre(450);
    this.enSortie = false;
    ecran.classList.remove("v-sort");
    this.stopper();
    this.rendre(this.vue);
    // Max se forme en comète sur l'écran qui apparaît
    if (!this.vue?.verrouille) window.dispatchEvent(new Event("max-apparait"));
  }

  private demanderAuServeur(m: ClientMessage): Promise<{ ok: boolean; texte: string }> {
    return new Promise((resolve) => {
      this.reponse = resolve;
      this.envoyer(m);
      setTimeout(() => {
        if (this.reponse === resolve) {
          this.reponse = undefined;
          resolve({ ok: false, texte: "Le Bureau ne répond pas." });
        }
      }, 5000);
    });
  }

  // --- réglages : enregistrer, verrouiller, effacer -----------------------------------------------------

  private ouvrirReglages(): void {
    $("v-reglages").hidden = false;
    this.majReglages();
  }

  private fermerReglages(): void {
    $("v-reglages").hidden = true;
    delete $("v-reglages").dataset.inscription;
    this.stopper();
  }

  private majReglages(): void {
    const v = this.vue;
    const enregistre = !!v?.enregistre;
    $("vr-intro").textContent = enregistre
      ? `Ton visage est enregistré${v?.prenom ? ` (${v.prenom})` : ""}. Max se verrouille à chaque mise en veille ; il te reconnaît à la caméra quand tu le réveilles.`
      : "Enregistre ton visage : ensuite, Max ne se réveillera que pour toi (tu passes devant la caméra et tu tournes la tête, comme Face ID).";
    $("vr-prenom-ligne").hidden = enregistre;
    $("vr-enregistrer").textContent = enregistre ? "📷 Réenregistrer mon visage" : "📷 Enregistrer mon visage";
    $("vr-verrouiller").hidden = !enregistre;
    $("vr-effacer").hidden = !enregistre;
  }

  /** Cinq prises du visage, yeux ouverts, en bougeant un peu la tête entre chaque. */
  private async inscrire(): Promise<void> {
    if (this.cameraInscription.allumee) return;
    const session = ++this.session;
    const ouvert = $("v-reglages");
    ouvert.dataset.inscription = "oui";
    $("vr-cadre").dataset.actif = "oui";
    const info = $("vr-statut");
    const dire = (t: string) => (info.textContent = t);
    try {
      dire("Allumage de la caméra…");
      await this.cameraInscription.demarrer();
    } catch (e) {
      dire((e as DOMException).name === "NotAllowedError" ? "La caméra est refusée : autorise-la pour cette page, puis réessaie." : `La caméra ne démarre pas : ${(e as Error).message}`);
      delete ouvert.dataset.inscription;
      this.stopper();
      return;
    }
    const prises: number[][] = [];
    const conseils = ["Regarde la caméra, bien en face.", "Tourne un tout petit peu la tête à gauche.", "Un peu à droite.", "Lève légèrement le menton.", "De nouveau bien en face."];
    const fin = Date.now() + 60_000;
    while (session === this.session && prises.length < PRISES && Date.now() < fin) {
      dire(`${conseils[prises.length]} (${prises.length}/${PRISES})`);
      const a = await this.cameraInscription.analyser(true).catch(() => null);
      if (!a?.descripteur || a.score < 0.7) {
        await attendre(150);
        continue;
      }
      prises.push(a.descripteur);
      await attendre(900);
    }
    this.stopper();
    delete ouvert.dataset.inscription;
    if (prises.length < PRISES) {
      dire("Je n'ai pas eu assez de prises nettes. Mets-toi face à la lumière et réessaie.");
      return;
    }
    const prenom = ($<HTMLInputElement>("vr-prenom").value || this.vue?.prenom || "").trim();
    const r = await this.demanderAuServeur({ type: "visage-enregistrer", descripteurs: prises, prenom });
    dire(r.ok ? "C'est enregistré ! Max se verrouillera à sa prochaine mise en veille." : r.texte);
  }
}
