import fs from "node:fs";
import path from "node:path";
import type { EtatFichier, MissionResume } from "../shared/protocol.ts";

export function slugify(text: string, maxWords = 6): string {
  const words = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, maxWords);
  return words.length ? words.join("-") : "mission";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function missionDirName(date: Date, slug: string): string {
  const jour = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${jour} ${pad(date.getHours())}h${pad(date.getMinutes())} - ${slug}`;
}

/** Crée le dossier de mission ; ajoute -2, -3… si le nom est déjà pris. */
export function createMissionDir(root: string, slug: string, date: Date): string {
  fs.mkdirSync(root, { recursive: true });
  const base = missionDirName(date, slug);
  let dir = path.join(root, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${base}-${i}`);
  fs.mkdirSync(dir);
  return dir;
}

export function writeEtat(dir: string, etat: EtatFichier): void {
  fs.writeFileSync(path.join(dir, "etat.json"), JSON.stringify(etat, null, 2));
}

export function readEtat(dir: string): EtatFichier | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "etat.json"), "utf8"));
  } catch {
    return null;
  }
}

export function appendJournal(dir: string, entry: object): void {
  const ligne = JSON.stringify({ heure: new Date().toISOString(), ...entry });
  fs.appendFileSync(path.join(dir, "journal.jsonl"), ligne + "\n");
}

/** Les missions du dossier, la plus récente d'abord. */
export function listMissions(root: string): MissionResume[] {
  if (!fs.existsSync(root)) return [];
  const out: MissionResume[] = [];
  for (const nom of fs.readdirSync(root)) {
    const etat = readEtat(path.join(root, nom));
    if (etat) out.push({ nom, titre: etat.titre, statut: etat.statut, debut: etat.debut });
  }
  return out.sort((a, b) => b.debut.localeCompare(a.debut));
}

/** Au démarrage : une mission « en cours » ou « en pause » a été coupée par l'arrêt du serveur et ne peut plus reprendre. */
export function markInterrupted(root: string): number {
  let n = 0;
  for (const m of listMissions(root)) {
    if (m.statut !== "en-cours" && m.statut !== "en-pause") continue;
    const dir = path.join(root, m.nom);
    const etat = readEtat(dir)!;
    writeEtat(dir, { ...etat, statut: "interrompue" });
    n++;
  }
  return n;
}
