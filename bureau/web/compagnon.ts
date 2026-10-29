// La page du compagnon : un orbe qui respire (il écoute, réfléchit ou parle), ce que tu dis en direct, et le fil.
import type { ClientMessage, EtatBureau } from "../shared/protocol.ts";
import { Ecoute } from "./ecoute.ts";

interface Vue {
  nom: string;
  etat: "ecoute" | "reflechit" | "parle" | "pause";
  phrase: string;
  messages: { de: "toi" | "lui" | "systeme"; texte: string }[];
  probleme: string | null;
  ecoute: { mode: "page"; pauseFinMs: number };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ETATS: Record<Vue["etat"], string> = { ecoute: "Je t'écoute", reflechit: "Je réfléchis…", parle: "…", pause: "En pause" };
let ws: WebSocket | null = null;
let vue: Vue | null = null;
const envoyer = (m: object) => ws?.readyState === 1 && ws.send(JSON.stringify(m));
const ecoute = new Ecoute((m: ClientMessage) => envoyer(m));

function rendre(v: Vue): void {
  vue = v;
  document.title = v.nom;
  document.body.dataset.etat = v.etat;
  $("c-nom").textContent = v.nom;
  $("c-etat").textContent = ETATS[v.etat];
  $("c-phrase").textContent = v.phrase;
  $("c-probleme").hidden = !v.probleme;
  $("c-probleme").textContent = v.probleme ?? "";
  const fil = $("c-fil");
  fil.innerHTML = "";
  for (const m of v.messages.slice(-12)) {
    const li = document.createElement("li");
    li.className = m.de;
    li.textContent = m.texte;
    fil.append(li);
  }
  fil.scrollTop = fil.scrollHeight;
  // l'écoute de la page : coupée en pause, sourde pendant qu'il parle
  ecoute.rendre({ assistant: { etat: v.etat === "parle" ? "parle" : "ecoute", ...(v.etat === "pause" ? {} : { ecoute: v.ecoute }) } } as unknown as EtatBureau);
}

function connecter(): void {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "etat") rendre(m.etat);
  };
  ws.onclose = () => setTimeout(connecter, 1000);
}
connecter();

$<HTMLFormElement>("c-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const champ = $<HTMLInputElement>("c-texte");
  if (champ.value.trim()) envoyer({ type: "ecrire", texte: champ.value });
  champ.value = "";
});
$("c-taire").addEventListener("click", () => envoyer({ type: "taire" }));
$("c-pause").addEventListener("click", () => envoyer({ type: "pause", oui: vue?.etat !== "pause" }));

// l'orbe : un halo violet qui respire doucement, tourne quand il réfléchit, pulse quand il parle
const toile = $<HTMLCanvasElement>("c-orbe");
const ctx = toile.getContext("2d")!;
let t = 0;
function dessiner(): void {
  const r = toile.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  if (toile.width !== Math.round(r.width * dpr)) {
    toile.width = Math.round(r.width * dpr);
    toile.height = Math.round(r.height * dpr);
  }
  const L = toile.width;
  const H = toile.height;
  ctx.clearRect(0, 0, L, H);
  const e = vue?.etat ?? "ecoute";
  t += e === "reflechit" ? 0.05 : 0.016;
  const base = Math.min(L, H) * 0.26;
  const souffle = e === "parle" ? 0.12 * Math.abs(Math.sin(t * 9)) : e === "pause" ? 0 : 0.05 * Math.sin(t * 1.5);
  const R = base * (1 + souffle);
  for (let i = 4; i >= 0; i--) {
    const a = t * (0.6 + i * 0.15) + i;
    const x = L / 2 + Math.cos(a) * base * 0.12 * (e === "reflechit" ? 2 : 1);
    const y = H / 2 + Math.sin(a * 1.3) * base * 0.1;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R * (1.6 - i * 0.18));
    const c = i % 2 ? "255,122,184" : "180,108,255";
    g.addColorStop(0, `rgba(${c},${e === "pause" ? 0.12 : 0.32})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, R * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  requestAnimationFrame(dessiner);
}
dessiner();
