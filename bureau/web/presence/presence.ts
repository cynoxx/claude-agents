// L'écran « Présence » : Max au centre, et autour de lui trois plans de verre au plus (la mission du jour,
// l'échéance, la carte du moment), l'heure en haut à droite, sa phrase en bas. Les boutons et le champ de l'ancien
// écran sont déplacés ici (ils gardent leurs actions) ; l'ancien habillage (niveau, XP, panneaux) disparaît.
import type { ClientMessage, EtatBureau } from "../../shared/protocol.ts";
import { carteEcheance, carteMission, carteMoment, MOT_ETAT, type CarteMoment } from "./presence-pur.ts";

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const $ = (id: string) => document.getElementById(id);

export class Presence {
  private racine: HTMLElement;
  private dernier = new Map<string, string>();

  constructor(private envoyer: (m: ClientMessage) => void) {
    document.body.classList.add("presence");
    const jarvis = $("jarvis")!;
    this.racine = document.createElement("div");
    this.racine.className = "pr";
    this.racine.innerHTML = `
<header class="pr-haut">
  <div class="pr-marque"><button type="button" class="pr-nom" title="Sons de l'interface">MAX</button><span class="pr-statut-place"></span></div>
  <div class="pr-outils"></div>
  <div class="pr-temps"><div class="pr-heure chiffre">--:--</div><div class="pr-date"></div><div class="pr-meteo"></div></div>
</header>
<section class="pr-carte verre pr-mission" aria-label="Mission du jour"></section>
<div class="pr-droite"><section class="pr-carte verre pr-echeance" aria-label="Échéance" hidden></section>
<section class="pr-carte verre pr-moment" aria-label="En ce moment" hidden></section></div>
<div class="pr-etat" aria-live="polite"></div>
<div class="pr-bas"><div class="pr-phrase"></div><div class="pr-poles-place"></div><div class="pr-champ-place"></div></div>`;
    jarvis.appendChild(this.racine);

    // on déplace les éléments vivants de l'ancien écran : ils gardent leurs écouteurs et leurs mises à jour
    const outils = this.racine.querySelector(".pr-outils")!;
    for (const id of ["j-minuteur", "j-alarme", "j-liens", "j-obscur", "j-gestes", "j-visage", "j-reveil", "j-bureau"]) {
      const el = $(id);
      if (el) outils.appendChild(el);
    }
    this.racine.querySelector(".pr-statut-place")!.replaceWith($("j-statut")!);
    const phrase = this.racine.querySelector(".pr-phrase")!;
    for (const id of ["j-toi", "j-dit", "j-soucis", "j-entendu"]) {
      const el = $(id);
      if (el) phrase.appendChild(el);
    }
    this.racine.querySelector(".pr-poles-place")!.replaceWith($("qg-poles")!);
    this.racine.querySelector(".pr-champ-place")!.replaceWith($("j-form")!);
    const champ = document.getElementById("j-texte") as HTMLInputElement | null;
    if (champ) champ.placeholder = "Écris à Max, ou dis « Max, … »";
    // les boutons parlent par symboles : le texte va dans l'info-bulle
    const titres: Record<string, string> = { "j-obscur": "Mode obscur : concentration", "j-bureau": "Le Bureau : tes pôles et l'équipe", "j-reveil": "Réveiller Max ou le mettre en veille" };
    for (const [id, t] of Object.entries(titres)) $(id)?.setAttribute("title", t);

    // le nom de Max coupe ou remet les sons (comme avant)
    this.racine.querySelector(".pr-nom")!.addEventListener("click", () => (document.querySelector("#verrou .j-nom") as HTMLElement | null)?.click());

    this.racine.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const s = t.closest<HTMLElement>("[data-sanction]");
      if (s) this.envoyer({ type: "sanction", action: s.dataset.sanction === "annuler" ? "annuler" : "faite" });
      else if (t.closest(".pr-moment[data-bureau]")) this.envoyer({ type: "vue", vue: "bureau" });
      else if (t.closest(".pr-echeance, .pr-mission")) this.envoyer({ type: "pole", pole: "etudes" });
    });

    this.horloge();
    setInterval(() => this.horloge(), 1000);
  }

  rendre(e: EtatBureau): void {
    const a = e.assistant;
    const etat = a?.etat ?? "veille";
    this.racine.dataset.etat = etat;
    this.poser(".pr-etat", "etat", `<span>${echapper(MOT_ETAT[etat])}</span>`);
    this.poser(".pr-meteo", "meteo", echapper(e.jarvis?.meteo ?? ""));

    const m = carteMission(e);
    const blocs = m.blocs
      ? `<div class="pr-blocs" role="img" aria-label="${m.blocs.faits} blocs faits sur ${m.blocs.total}">${Array.from({ length: m.blocs.total }, (_, i) => `<i class="${i < m.blocs!.faits ? "fait" : ""}"></i>`).join("")}</div>`
      : "";
    this.poser(".pr-mission", "mission", `
<div class="etiquette">Mission du jour</div>
<div class="pr-titre">${echapper(m.titre)}</div>
<div class="pr-sous">${echapper(m.sous)}</div>${blocs}
${m.lignes.map((l) => `<div class="pr-ligne"><span>${echapper(l.gauche)}</span><span class="chiffre">${echapper(l.droite)}</span></div>`).join("")}`);

    const ech = carteEcheance(e);
    const carteE = this.racine.querySelector<HTMLElement>(".pr-echeance")!;
    carteE.hidden = !ech;
    carteE.classList.toggle("braise", !!ech?.urgent);
    if (ech) this.poser(".pr-echeance", "echeance", `<div class="etiquette">Échéance</div><div class="pr-grand chiffre">${echapper(ech.grand)}</div><div class="pr-nom-ech">${echapper(ech.nom)}</div><div class="pr-sous">${echapper(ech.sous)}</div>`);

    this.rendreMoment(carteMoment(e));
  }

  private rendreMoment(c: CarteMoment | null): void {
    const el = this.racine.querySelector<HTMLElement>(".pr-moment")!;
    el.hidden = !c;
    if (!c) return;
    el.classList.toggle("braise", c.ton === "braise");
    el.classList.toggle("or", c.ton === "or");
    if (c.bureau) el.dataset.bureau = "oui";
    else delete el.dataset.bureau;
    const boutons = c.sanction
      ? `<div class="pr-boutons"><button type="button" data-sanction="faite">C'est fait</button><button type="button" data-sanction="annuler" class="discret" title="Malade, journée exceptionnelle : pas de sanction aujourd'hui">Annuler</button></div>`
      : "";
    this.poser(".pr-moment", "moment", `<div class="etiquette">${echapper(c.etiquette)}</div><div class="pr-titre moyen">${echapper(c.titre)}</div>${c.sous ? `<div class="pr-sous">${echapper(c.sous)}</div>` : ""}${boutons}`);
  }

  /** Remplace un contenu seulement s'il a changé (pas de clignotement, les boutons restent cliquables). */
  private poser(selecteur: string, cle: string, html: string): void {
    if (this.dernier.get(cle) === html) return;
    this.dernier.set(cle, html);
    const el = this.racine.querySelector(selecteur);
    if (el) el.innerHTML = html;
  }

  private horloge(): void {
    const d = new Date();
    this.poser(".pr-heure", "heure", d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
    this.poser(".pr-date", "date", d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }));
    // après 21 h, tout l'écran passe à l'ambre
    document.body.dataset.soir = d.getHours() >= 21 || d.getHours() < 6 ? "oui" : "non";
  }
}
