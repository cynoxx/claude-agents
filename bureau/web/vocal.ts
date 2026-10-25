// Le vocal côté écran : bouton micro, dictée dans la zone de mission, voix de Max qui lit les moments clés.
import type { EtatBureau, MissionVue } from "../shared/protocol.ts";
import type { Dictee, Parole } from "./voix-navigateur.ts";
import { assemblerTexte, quoiDire } from "./voix.ts";

const CLE_MUET = "bureau.voix-coupee";
const CLE_AUTO = "bureau.lancer-apres-dictee";
const OCCUPEE = ["planification", "travail", "relecture", "pause"];

const lire = (cle: string): string | null => {
  try {
    return localStorage.getItem(cle);
  } catch {
    return null;
  }
};
const ecrire = (cle: string, valeur: string): void => {
  try {
    localStorage.setItem(cle, valeur);
  } catch {
    // navigation privée ou stockage bloqué : le réglage ne sera pas retenu, sans gravité
  }
};
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Vocal {
  private precedent: MissionVue | null | undefined = undefined;
  private base = "";
  private form = $<HTMLFormElement>("mission");
  private texte = $<HTMLTextAreaElement>("texte");
  private micro = $<HTMLButtonElement>("btn-micro");
  private muet = $<HTMLButtonElement>("btn-muet");
  private auto = $<HTMLInputElement>("auto-lancer");

  constructor(
    private dictee: Dictee,
    private parole: Parole,
    private toast: (message: string) => void,
  ) {
    if (dictee.disponible) {
      this.micro.hidden = false;
      $("auto").hidden = false;
      this.auto.checked = lire(CLE_AUTO) === "1";
      this.auto.addEventListener("change", () => ecrire(CLE_AUTO, this.auto.checked ? "1" : "0"));
      this.micro.addEventListener("click", () => this.basculer());
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.altKey) && e.code === "Space") {
          e.preventDefault();
          this.basculer();
        }
      });
    }
    if (parole.disponible) {
      this.muet.hidden = false;
      parole.muet = lire(CLE_MUET) === "1";
      this.majMuet();
      this.muet.addEventListener("click", () => {
        parole.muet = !parole.muet;
        if (parole.muet) parole.taire();
        ecrire(CLE_MUET, parole.muet ? "1" : "0");
        this.majMuet();
      });
    }
  }

  /** À appeler à chaque état reçu du serveur : Max parle aux moments clés, le micro se verrouille pendant une mission. */
  surEtat(etat: EtatBureau): void {
    const m = etat.mission;
    const dit = quoiDire(this.precedent, m);
    if (this.precedent !== undefined && m && this.precedent?.nom !== m.nom) this.parole.taire();
    this.precedent = m;
    if (dit) this.parole.parler(dit);

    const occupee = !!m && OCCUPEE.includes(m.phase);
    this.micro.disabled = occupee || !etat.claude.ok;
    if (occupee && this.dictee.ecoute) this.dictee.arreter();
  }

  private basculer(): void {
    if (this.dictee.ecoute) return this.dictee.arreter();
    if (this.micro.disabled || this.texte.disabled) return;
    this.parole.taire();
    this.base = this.texte.value;
    this.micro.classList.add("ecoute");
    this.micro.textContent = "🎤 J'écoute…";
    this.dictee.demarrer({
      onTexte: (dicte) => {
        this.texte.value = assemblerTexte(this.base, dicte);
      },
      onErreur: (message) => this.toast(message),
      onFin: (final) => {
        this.micro.classList.remove("ecoute");
        this.micro.textContent = "🎤 Parler";
        if (final && this.auto.checked) this.form.requestSubmit();
      },
    });
  }

  private majMuet(): void {
    this.muet.textContent = this.parole.muet ? "🔇" : "🔊";
    this.muet.title = this.parole.muet ? "Max est muet : cliquer pour qu'il reparle" : "Max parle : cliquer pour le faire taire";
  }
}
