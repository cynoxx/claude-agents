// L'atelier : Max seul, en plein écran, pour regarder chaque humeur (http://localhost:4747/atelier.html).
// ?max=parole fixe l'humeur au départ ; ?nu=1 cache les boutons (pour les captures).
import { Entite } from "./max3d/entite.ts";
import { REGLAGES, type Humeur } from "./max3d/entite-pur.ts";

const NOMS: Record<Humeur, string> = { veille: "Veille", ecoute: "Écoute", reflexion: "Réflexion", parole: "Parole", alerte: "Alerte", fete: "Réussite", soir: "Soir" };
const params = new URLSearchParams(location.search);
if (params.get("nu")) document.body.dataset.nu = "1";
const max = new Entite(document.getElementById("max") as HTMLCanvasElement);
max.demarrer();
const nav = document.getElementById("humeurs")!;
const choisir = (h: Humeur) => {
  max.forcer(h);
  for (const b of nav.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.h === h));
};
for (const h of Object.keys(REGLAGES) as Humeur[]) {
  const b = document.createElement("button");
  b.textContent = NOMS[h];
  b.dataset.h = h;
  b.addEventListener("click", () => choisir(h));
  nav.appendChild(b);
}
choisir((params.get("max") as Humeur) in REGLAGES ? (params.get("max") as Humeur) : "ecoute");
window.addEventListener("keydown", (e) => {
  if (e.key === " ") max.apparaitre();
  if (e.key === "s") max.saluer();
});
