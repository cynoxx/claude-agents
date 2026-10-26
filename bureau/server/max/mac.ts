// La télécommande du Mac : la liste fermée des gestes que Max a le droit de faire (apps, sites, son, lumière,
// capture, verrouillage, musique, contacts, iMessage, mails, agenda, météo).
// Rien ne passe par un shell : chaque geste lance un programme précis (open, osascript, screencapture, pmset,
// icalBuddy) avec ses arguments. Les textes venant de la conversation (nom d'app, message, titre…) sont donnés au
// script AppleScript en arguments (argv), jamais collés dans le script lui-même.
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";

export type Executer = (bin: string, args: string[], timeoutMs?: number) => Promise<{ code: number; stdout: string; stderr: string }>;

export const executerReel: Executer = (bin, args, timeoutMs = 30_000) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if ((err as NodeJS.ErrnoException | null)?.code === "ENOENT") return resolve({ code: 127, stdout: "", stderr: `${bin} introuvable` });
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

export interface Reponse {
  ok: boolean;
  texte: string;
}
export interface Contact {
  nom: string;
  valeur: string;
  type: string;
}
export interface Evenement {
  heure: string; // « 08:30 », vide pour toute la journée
  titre: string;
}

export interface OptionsMac {
  /** Faux hors macOS : chaque geste répond qu'il ne marche que sur Mac. */
  actif: boolean;
  executer?: Executer;
  /** Où ranger les captures d'écran (le Bureau du Mac par défaut). */
  dossierCaptures?: string;
  musique?: "auto" | "spotify" | "musique";
  /** Ville pour la météo ; null = devinée par wttr.in. */
  ville?: string | null;
  fetch?: typeof fetch;
  maintenant?: () => Date;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NOM_APP = /^[\p{L}\p{N} .'&+()-]{1,60}$/u;

/** Les refus de macOS, traduits en ce qu'il faut faire. */
export function expliquerErreur(stderr: string): string {
  const s = stderr.trim();
  if (/-1743|Not authorized to send Apple events|n.est pas autoris/i.test(s)) {
    return "macOS ne m'a pas encore donné la permission. Va dans Réglages Système > Confidentialité et sécurité > Automatisation, et autorise Raccourcis (ou Terminal) à contrôler cette app.";
  }
  if (/-1719|assistive access|accessibilit/i.test(s)) {
    return "Il me faut l'autorisation d'accessibilité : Réglages Système > Confidentialité et sécurité > Accessibilité, ajoute et coche Raccourcis (ou Terminal).";
  }
  return `Le Mac a répondu par une erreur : ${s.split("\n").filter(Boolean).at(-1) ?? "inconnue"}`;
}

/** « Nom\tvaleur\tlibellé » par ligne → contacts (les libellés Apple « _$!<Mobile>!$_ » nettoyés). */
export function lireContacts(sortie: string): Contact[] {
  return sortie
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 2 && p[0].trim() && p[1].trim())
    .map(([nom, valeur, type = ""]) => ({ nom: nom.trim(), valeur: valeur.trim(), type: type.replace(/^_\$!<(.*)>!\$_$/, "$1").trim() }));
}

/** Sortie d'icalBuddy (« titre\tAAAA-MM-JJ at HH:MM » par ligne) → événements du jour, dans l'ordre. */
export function lireAgendaIcal(sortie: string, jour: string): Evenement[] {
  const out: Evenement[] = [];
  for (const l of sortie.split("\n")) {
    const [titre, ...reste] = l.split("\t");
    const quand = reste.join(" ");
    if (!titre?.trim() || !quand.includes(jour)) continue;
    const h = /(\d{1,2}):(\d{2})/.exec(quand);
    out.push({ heure: h ? `${pad(Number(h[1]))}:${h[2]}` : "", titre: titre.trim() });
  }
  return out.sort((a, b) => a.heure.localeCompare(b.heure));
}

const decrireEvenements = (ev: Evenement[]) => ev.map((e) => `${e.heure || "Toute la journée"} ${e.titre}`).join("\n");

// --- scripts AppleScript (les données arrivent par argv) -------------------------------------------------

const S_FERMER = ["on run argv", "tell application (item 1 of argv) to quit", "end run"];
const S_VOLUME = [
  "on run argv",
  "set a to item 1 of argv",
  'if a is "muet" then',
  "set volume output muted true",
  'return "muet"',
  "end if",
  "set v to output volume of (get volume settings)",
  'if a is "plus" then',
  "set v to v + 10",
  'else if a is "moins" then',
  "set v to v - 10",
  "else",
  "set v to a as integer",
  "end if",
  "if v > 100 then set v to 100",
  "if v < 0 then set v to 0",
  "set volume output volume v",
  "set volume output muted false",
  "return v as string",
  "end run",
];
// touches de luminosité du clavier (144 = plus, 145 = moins) : demande l'autorisation d'accessibilité
const S_LUMIERE = [
  "on run argv",
  "set n to (item 2 of argv) as integer",
  'tell application "System Events"',
  "repeat n times",
  'if item 1 of argv is "plus" then',
  "key code 144",
  "else",
  "key code 145",
  "end if",
  "delay 0.05",
  "end repeat",
  "end tell",
  "end run",
];
const sMusique = (app: string, verbe: string) => [
  `tell application "${app}"`,
  ...(verbe ? [verbe, "delay 0.4"] : []),
  "try",
  'if player state is stopped then return ""',
  'return (name of current track) & " — " & (artist of current track)',
  "on error",
  'return ""',
  "end try",
  "end tell",
];
const S_CHERCHER_MUSIQUE = [
  "on run argv",
  "set q to item 1 of argv",
  'tell application "Music"',
  "try",
  "play playlist q",
  'return "la playlist " & q',
  "end try",
  "set r to (every track of library playlist 1 whose name contains q or artist contains q or album contains q)",
  'if r is {} then return ""',
  "play item 1 of r",
  'return (name of item 1 of r) & " — " & (artist of item 1 of r)',
  "end tell",
  "end run",
];
const S_CONTACTS = [
  "on run argv",
  'set out to ""',
  "set k to 0",
  'tell application "Contacts"',
  "repeat with p in (every person whose name contains (item 1 of argv))",
  "repeat with ph in phones of p",
  "set out to out & (name of p) & tab & (value of ph) & tab & (label of ph) & linefeed",
  "end repeat",
  "repeat with em in emails of p",
  'set out to out & (name of p) & tab & (value of em) & tab & "email" & linefeed',
  "end repeat",
  "set k to k + 1",
  "if k >= 10 then exit repeat",
  "end repeat",
  "end tell",
  "return out",
  "end run",
];
const S_IMESSAGE = [
  "on run argv",
  'tell application "Messages"',
  "set s to 1st account whose service type = iMessage",
  "send (item 2 of argv) to participant (item 1 of argv) of s",
  "end tell",
  "end run",
];
const S_MAILS = [
  "on run argv",
  "set n to (item 1 of argv) as integer",
  'set seulNonLus to (item 2 of argv) is "1"',
  'set out to ""',
  "set k to 0",
  'tell application "Mail"',
  "repeat with m in (messages of inbox)",
  "if (not seulNonLus) or (read status of m is false) then",
  "set c to content of m",
  "if length of c > 400 then set c to text 1 thru 400 of c",
  'set out to out & "---" & linefeed & "De : " & (sender of m) & linefeed & "Sujet : " & (subject of m) & linefeed & "Reçu : " & ((date received of m) as string) & linefeed & c & linefeed',
  "set k to k + 1",
  "if k >= n then exit repeat",
  "end if",
  "end repeat",
  "end tell",
  "return out",
  "end run",
];
const S_DATE = [
  "set d to current date",
  "set day of d to 1",
  "set year of d to (item 1 of argv) as integer",
  "set month of d to (item 2 of argv) as integer",
  "set day of d to (item 3 of argv) as integer",
];
// secours sans icalBuddy : Calendrier ne trouve pas les répétitions d'un événement récurrent
const S_AGENDA = [
  "on run argv",
  ...S_DATE,
  "set time of d to 0",
  "set f to d + 1 * days",
  'set out to ""',
  'tell application "Calendar"',
  "repeat with c in calendars",
  "repeat with e in (every event of c whose start date >= d and start date < f)",
  "if allday event of e then",
  'set out to out & "-1" & tab & "-1" & tab & (summary of e) & linefeed',
  "else",
  "set s to start date of e",
  "set out to out & (hours of s) & tab & (minutes of s) & tab & (summary of e) & linefeed",
  "end if",
  "end repeat",
  "end repeat",
  "end tell",
  "return out",
  "end run",
];
const S_RDV = [
  "on run argv",
  ...S_DATE,
  "set time of d to ((item 4 of argv) as integer) * 60",
  "set f to d + ((item 5 of argv) as integer) * minutes",
  'tell application "Calendar"',
  'if (item 7 of argv) is "" then',
  "set c to first calendar whose writable is true",
  "else",
  "set c to first calendar whose name is (item 7 of argv)",
  "end if",
  "make new event at end of events of c with properties {summary:(item 6 of argv), start date:d, end date:f}",
  "return name of c",
  "end tell",
  "end run",
];

export class Mac {
  private executer: Executer;
  private appMusique?: "Spotify" | "Music";

  constructor(private o: OptionsMac) {
    this.executer = o.executer ?? executerReel;
  }

  private get maintenant(): Date {
    return this.o.maintenant?.() ?? new Date();
  }

  private horsMac(): Reponse | null {
    return this.o.actif ? null : { ok: false, texte: "Je ne peux piloter l'ordinateur que sur un Mac." };
  }

  /** Lance un script AppleScript ; un argument qui commence par « - » est protégé pour ne pas être pris pour une option. */
  private async osa(lignes: string[], argv: string[] = [], timeoutMs?: number) {
    const args = lignes.flatMap((l) => ["-e", l]);
    return this.executer("osascript", [...args, ...argv.map((a) => (a.startsWith("-") ? `​${a}` : a))], timeoutMs);
  }

  private async geste(bin: string, args: string[], reussite: string): Promise<Reponse> {
    const r = await this.executer(bin, args);
    return r.code === 0 ? { ok: true, texte: reussite } : { ok: false, texte: expliquerErreur(r.stderr) };
  }

  // apps et sites

  async ouvrirApp(nom: string): Promise<Reponse> {
    const n = nom.trim();
    if (this.horsMac()) return this.horsMac()!;
    if (!NOM_APP.test(n)) return { ok: false, texte: "Ce nom d'app ne me semble pas valide." };
    const r = await this.executer("open", ["-a", n]);
    if (r.code === 0) return { ok: true, texte: `${n} est ouvert.` };
    return { ok: false, texte: /Unable to find application|introuvable/i.test(r.stderr) ? `Je ne trouve pas d'app appelée « ${n} » sur ce Mac.` : expliquerErreur(r.stderr) };
  }

  async fermerApp(nom: string): Promise<Reponse> {
    const n = nom.trim();
    if (this.horsMac()) return this.horsMac()!;
    if (!NOM_APP.test(n)) return { ok: false, texte: "Ce nom d'app ne me semble pas valide." };
    const r = await this.osa(S_FERMER, [n]);
    return r.code === 0 ? { ok: true, texte: `${n} est fermé.` } : { ok: false, texte: expliquerErreur(r.stderr) };
  }

  async ouvrirSite(adresse: string): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    let url: URL;
    try {
      url = new URL(adresse.trim());
    } catch {
      return { ok: false, texte: "Ce n'est pas une adresse web valide." };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, texte: "Je n'ouvre que des adresses web (http ou https)." };
    return this.geste("open", [url.href], `J'ai ouvert ${url.hostname.replace(/^www\./, "")}.`);
  }

  async chercherYoutube(recherche: string): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    const q = recherche.trim();
    if (!q) return { ok: false, texte: "Que faut-il chercher sur YouTube ?" };
    return this.geste("open", [`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`], `J'ai lancé la recherche YouTube « ${q} ».`);
  }

  // réglages

  async volume(niveau: string): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    const n = niveau.trim().toLowerCase();
    const nombre = /^\d{1,3}$/.test(n) ? Number(n) : NaN;
    if (!["plus", "moins", "muet"].includes(n) && !(nombre >= 0 && nombre <= 100)) return { ok: false, texte: "Donne un volume entre 0 et 100, ou plus, moins, muet." };
    const r = await this.osa(S_VOLUME, [n]);
    if (r.code !== 0) return { ok: false, texte: expliquerErreur(r.stderr) };
    return { ok: true, texte: n === "muet" ? "Son coupé." : `Volume à ${r.stdout.trim() || n}.` };
  }

  async luminosite(sens: "plus" | "moins", crans = 2): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    if (sens !== "plus" && sens !== "moins") return { ok: false, texte: "Dis plus ou moins." };
    if (!(Number.isInteger(crans) && crans >= 1 && crans <= 16)) return { ok: false, texte: "Entre 1 et 16 crans." };
    const r = await this.osa(S_LUMIERE, [sens, String(crans)]);
    return r.code === 0 ? { ok: true, texte: `Luminosité ${sens === "plus" ? "augmentée" : "baissée"}.` } : { ok: false, texte: expliquerErreur(r.stderr) };
  }

  async capture(): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    const d = this.maintenant;
    const nom = `Capture Max ${iso(d)} ${pad(d.getHours())}h${pad(d.getMinutes())}m${pad(d.getSeconds())}.png`;
    const fichier = path.join(this.o.dossierCaptures ?? path.join(os.homedir(), "Desktop"), nom);
    return this.geste("screencapture", ["-x", fichier], `Capture d'écran enregistrée : ${nom}.`);
  }

  async verrouiller(): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    return this.geste("pmset", ["displaysleepnow"], "Écran verrouillé.");
  }

  // musique

  private async quelleApp(): Promise<"Spotify" | "Music"> {
    if (this.o.musique === "spotify") return "Spotify";
    if (this.o.musique === "musique") return "Music";
    if (!this.appMusique) this.appMusique = (await this.executer("open", ["-Ra", "Spotify"])).code === 0 ? "Spotify" : "Music";
    return this.appMusique;
  }

  async musique(action: "jouer" | "pause" | "suivant" | "precedent" | "quoi", recherche?: string): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    const app = await this.quelleApp();
    const nomApp = app === "Spotify" ? "Spotify" : "Musique";
    const q = recherche?.trim();
    if (action === "jouer" && q) {
      if (app === "Spotify") return this.geste("open", [`spotify:search:${encodeURIComponent(q)}`], `J'ai ouvert la recherche « ${q} » dans Spotify : choisis ce que tu veux écouter.`);
      const r = await this.osa(S_CHERCHER_MUSIQUE, [q]);
      if (r.code !== 0) return { ok: false, texte: expliquerErreur(r.stderr) };
      return r.stdout.trim() ? { ok: true, texte: `Je lance ${r.stdout.trim()}.` } : { ok: false, texte: `Rien trouvé pour « ${q} » dans ta bibliothèque Musique.` };
    }
    const verbe = { jouer: "play", pause: "pause", suivant: "next track", precedent: "previous track", quoi: "" }[action];
    if (verbe === undefined) return { ok: false, texte: "Action inconnue : jouer, pause, suivant, precedent ou quoi." };
    const r = await this.osa(sMusique(app, verbe));
    if (r.code !== 0) return { ok: false, texte: expliquerErreur(r.stderr) };
    const titre = r.stdout.trim();
    if (action === "quoi") return { ok: true, texte: titre ? `En ce moment dans ${nomApp} : ${titre}.` : `Rien ne joue dans ${nomApp}.` };
    const fait = { jouer: "Lecture", pause: "Pause", suivant: "Morceau suivant", precedent: "Morceau précédent" }[action];
    return { ok: true, texte: `${fait} dans ${nomApp}${titre && action !== "pause" ? ` : ${titre}` : ""}.` };
  }

  // contacts et messages

  async chercherContact(nom: string): Promise<Reponse & { contacts: Contact[] }> {
    if (this.horsMac()) return { ...this.horsMac()!, contacts: [] };
    const q = nom.trim();
    if (!q) return { ok: false, texte: "Quel contact ?", contacts: [] };
    const r = await this.osa(S_CONTACTS, [q]);
    if (r.code !== 0) return { ok: false, texte: expliquerErreur(r.stderr), contacts: [] };
    const contacts = lireContacts(r.stdout);
    if (!contacts.length) return { ok: false, texte: `Aucun contact ne s'appelle « ${q} ».`, contacts };
    return { ok: true, texte: contacts.map((c) => `${c.nom} : ${c.valeur}${c.type ? ` (${c.type})` : ""}`).join("\n"), contacts };
  }

  /**
   * Le destinataire d'un iMessage : un numéro ou une adresse tels quels, sinon le contact du nom donné
   * (son mobile d'abord). Plusieurs personnes différentes → il faut préciser.
   */
  async trouverDestinataire(qui: string): Promise<{ ok: true; nom: string; handle: string } | { ok: false; texte: string }> {
    const q = qui.trim();
    if (/^\+?[\d\s.()-]{6,}$/.test(q) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) return { ok: true, nom: q, handle: q.replace(/[\s.()-]/g, "") };
    const r = await this.chercherContact(q);
    if (!r.ok) return { ok: false, texte: r.texte };
    const noms = [...new Set(r.contacts.map((c) => c.nom))];
    if (noms.length > 1) return { ok: false, texte: `Plusieurs contacts correspondent : ${noms.join(", ")}. Demande lequel.` };
    const telephones = r.contacts.filter((c) => c.type !== "email");
    const choisi = telephones.find((c) => /mobile|iphone|portable/i.test(c.type)) ?? telephones[0] ?? r.contacts[0];
    return { ok: true, nom: choisi.nom, handle: choisi.type === "email" ? choisi.valeur : choisi.valeur.replace(/[\s.()-]/g, "") };
  }

  async envoyerIMessage(destinataire: string, texte: string): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    const r = await this.osa(S_IMESSAGE, [destinataire, texte]);
    return r.code === 0 ? { ok: true, texte: "Message envoyé." } : { ok: false, texte: expliquerErreur(r.stderr) };
  }

  // mails, agenda, météo

  async lireMails(nombre = 5, seulementNonLus = true): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    const n = Math.min(Math.max(Math.round(nombre) || 5, 1), 20);
    const r = await this.osa(S_MAILS, [String(n), seulementNonLus ? "1" : "0"], 90_000);
    if (r.code !== 0) return { ok: false, texte: expliquerErreur(r.stderr) };
    return { ok: true, texte: r.stdout.trim() || (seulementNonLus ? "Aucun mail non lu dans la boîte de réception." : "Aucun mail dans la boîte de réception.") };
  }

  /** « aujourdhui », « demain », « apres-demain » ou AAAA-MM-JJ → le jour, ou null. */
  jour(quand: string): string | null {
    const q = quand.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "");
    const decalage = { aujourdhui: 0, "": 0, demain: 1, "apres-demain": 2, "apres demain": 2 }[q];
    if (decalage !== undefined) {
      const d = this.maintenant;
      return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + decalage));
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
    return m && new Date(`${q}T12:00:00`).getMonth() === Number(m[2]) - 1 ? q : null;
  }

  async agenda(quand: string): Promise<Reponse & { evenements: Evenement[] }> {
    if (this.horsMac()) return { ...this.horsMac()!, evenements: [] };
    const jour = this.jour(quand);
    if (!jour) return { ok: false, texte: "Donne un jour : aujourd'hui, demain, ou une date AAAA-MM-JJ.", evenements: [] };
    const [a, m, j] = jour.split("-").map(Number);
    const lendemain = iso(new Date(a, m - 1, j + 1));
    let evenements: Evenement[];
    const ical = await this.executer(
      "icalBuddy",
      ["-nc", "-nrd", "-npn", "-eed", "-b", "", "-iep", "title,datetime", "-po", "title,datetime", "-ps", "|\t|", "-df", "%Y-%m-%d", "-tf", "%H:%M", `eventsFrom:${jour}`, `to:${lendemain}`],
      60_000,
    );
    if (ical.code === 0) {
      evenements = lireAgendaIcal(ical.stdout, jour);
    } else {
      const r = await this.osa(S_AGENDA, [String(a), String(m), String(j)], 90_000);
      if (r.code !== 0) return { ok: false, texte: expliquerErreur(r.stderr), evenements: [] };
      evenements = r.stdout
        .split("\n")
        .map((l) => l.split("\t"))
        .filter((p) => p.length >= 3 && p[2].trim())
        .map(([h, mi, ...t]) => ({ heure: Number(h) < 0 ? "" : `${pad(Number(h))}:${pad(Number(mi))}`, titre: t.join(" ").trim() }))
        .sort((x, y) => x.heure.localeCompare(y.heure));
    }
    if (!evenements.length) return { ok: true, texte: `Rien dans l'agenda le ${jour}.`, evenements };
    return { ok: true, texte: `Agenda du ${jour} :\n${decrireEvenements(evenements)}`, evenements };
  }

  /** Vérifie un rendez-vous avant de le préparer ; renvoie le problème, ou null. */
  validerRdv(o: { titre: string; date: string; heure: string; minutes: number }): string | null {
    const h = /^(\d{1,2})[:h](\d{2})?$/.exec(o.heure.trim());
    if (!o.titre.trim()) return "Il faut un titre au rendez-vous.";
    if (!this.jour(o.date) || !h || Number(h[1]) > 23 || Number(h[2] ?? 0) > 59) return "Il me faut une date (AAAA-MM-JJ) et une heure (HH:MM).";
    if (!(Math.round(o.minutes) >= 5 && Math.round(o.minutes) <= 24 * 60)) return "Durée entre 5 minutes et 24 heures.";
    return null;
  }

  async creerRdv(o: { titre: string; date: string; heure: string; minutes: number; calendrier?: string }): Promise<Reponse> {
    if (this.horsMac()) return this.horsMac()!;
    const probleme = this.validerRdv(o);
    if (probleme) return { ok: false, texte: probleme };
    const jour = this.jour(o.date)!;
    const h = /^(\d{1,2})[:h](\d{2})?$/.exec(o.heure.trim())!;
    const duree = Math.round(o.minutes);
    const [a, m, j] = jour.split("-").map(Number);
    const debut = Number(h[1]) * 60 + Number(h[2] ?? 0);
    const r = await this.osa(S_RDV, [String(a), String(m), String(j), String(debut), String(duree), o.titre.trim(), o.calendrier?.trim() ?? ""], 60_000);
    if (r.code !== 0) return { ok: false, texte: expliquerErreur(r.stderr) };
    return { ok: true, texte: `Rendez-vous « ${o.titre.trim()} » ajouté le ${jour} à ${pad(Number(h[1]))}:${h[2] ?? "00"}${r.stdout.trim() ? ` dans le calendrier ${r.stdout.trim()}` : ""}.` };
  }

  async meteo(ville?: string): Promise<Reponse & { court?: string }> {
    const v = (ville ?? this.o.ville ?? "").trim();
    try {
      const r = await (this.o.fetch ?? fetch)(`https://wttr.in/${encodeURIComponent(v)}?format=j1&lang=fr`, { signal: AbortSignal.timeout(10_000) });
      const j = (await r.json()) as {
        current_condition: { temp_C: string; FeelsLikeC: string; lang_fr?: { value: string }[]; weatherDesc?: { value: string }[] }[];
        weather: { maxtempC: string; mintempC: string }[];
        nearest_area?: { areaName: { value: string }[] }[];
      };
      const c = j.current_condition[0];
      const desc = (c.lang_fr?.[0]?.value ?? c.weatherDesc?.[0]?.value ?? "").trim();
      const lieu = j.nearest_area?.[0]?.areaName?.[0]?.value ?? v;
      const jour = j.weather[0];
      return {
        ok: true,
        texte: `${lieu ? `${lieu} : ` : ""}${c.temp_C} degrés${desc ? `, ${desc.toLowerCase()}` : ""} (ressenti ${c.FeelsLikeC}). Aujourd'hui entre ${jour.mintempC} et ${jour.maxtempC} degrés.`,
        court: `${c.temp_C}°${desc ? ` · ${desc}` : ""}`,
      };
    } catch (e) {
      return { ok: false, texte: `Je n'arrive pas à avoir la météo : ${(e as Error).message}` };
    }
  }
}
