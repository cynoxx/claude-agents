// `npm run voix-humaine` : donne à Max une voix humaine (ElevenLabs). Tu colles ta clé API une fois, tu écoutes
// les voix françaises qui lui vont (homme, grave et posé), tu choisis à l'oreille, Max te dit une phrase avec, et
// c'est retenu dans bureau.config.json (qui ne quitte pas ton Mac).
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, loadConfig } from "./config.ts";
import { classerVoix, decrireVoix, enregistrerChoix, type VoixPartagee } from "./voix/choix-voix.ts";
import { API_ELEVENLABS, ElevenLabs, cleElevenLabs, lireQuota, messageErreur } from "./voix/elevenlabs.ts";

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dossierConfig = process.env.BUREAU_CONFIG_DIR ?? racine;
const fichierConfig = path.join(dossierConfig, CONFIG_FILE);
const config = loadConfig(dossierConfig);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "max-voix-"));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const jouer = (fichier: string) => new Promise<void>((r) => execFile("afplay", [fichier], () => r()));

async function api<T>(cle: string, chemin: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${API_ELEVENLABS}${chemin}`, {
    method: init.method ?? "GET",
    headers: { "xi-api-key": cle, "content-type": "application/json" },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(messageErreur(r.status, j));
  return j as T;
}

async function ecouterExtrait(v: VoixPartagee, i: number): Promise<void> {
  const f = path.join(tmp, `${i}.mp3`);
  if (!fs.existsSync(f)) {
    const r = await fetch(v.preview_url!);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  console.log(`   ▶ ${v.name}…`);
  await jouer(f);
}

async function main() {
  console.log("🎙  La voix humaine de Max (ElevenLabs)\n");
  let cle = cleElevenLabs(config.voix.elevenlabs);
  let nouvelleCle = false;
  if (!cle) {
    console.log("Il faut une clé API ElevenLabs (une seule fois) :");
    console.log("  1. Crée un compte sur https://elevenlabs.io (le plan gratuit suffit pour essayer).");
    console.log("  2. En bas à gauche : ton profil → « API Keys » → « Create API Key ».");
    console.log("     Laisse toutes les permissions (ou au moins Text to Speech, Voices et User), puis copie la clé.\n");
    cle = (await rl.question("Colle ta clé ici puis Entrée : ")).trim();
    nouvelleCle = true;
  }
  let quota;
  try {
    quota = await lireQuota((u, i) => fetch(u, i), cle);
  } catch (e) {
    console.error(`\n✘ ${(e as Error).message.replace(/^ElevenLabs : /, "")}. Vérifie la clé (et ses permissions), puis relance npm run voix-humaine.`);
    process.exit(1);
  }
  const gratuit = quota.limite <= 10_000;
  console.log(`✔ Clé acceptée · ${quota.utilises.toLocaleString("fr-FR")} / ${quota.limite.toLocaleString("fr-FR")} caractères utilisés ce mois-ci\n`);

  console.log("… Je cherche les voix françaises d'homme, graves et posées");
  const pages = await Promise.all(
    ["", "deep", "calm", "narration"].map((recherche) =>
      api<{ voices: VoixPartagee[] }>(cle, `/v1/shared-voices?page_size=40&language=fr&gender=male&sort=usage_character_count_1y${recherche ? `&search=${recherche}` : ""}`).catch(() => ({ voices: [] })),
    ),
  );
  const voix = classerVoix(pages.flatMap((p) => p.voices), { gratuit, combien: 6 });
  if (!voix.length) {
    console.error("✘ ElevenLabs n'a renvoyé aucune voix. Réessaie dans un moment.");
    process.exit(1);
  }
  const liste = () => voix.forEach((v, i) => console.log(`  ${i + 1}. ${decrireVoix(v)}`));
  console.log("\nLes voix qui iraient bien à Max :\n");
  liste();
  console.log("\nJe te les fais écouter une par une (monte le son).\n");
  for (let i = 0; i < voix.length; i++) await ecouterExtrait(voix[i], i).catch(() => console.log("   (extrait indisponible)"));

  for (;;) {
    const r = (await rl.question("\nTon choix : tape son numéro (ou « e3 » pour réécouter la 3, « l » pour revoir la liste, « q » pour quitter) : ")).trim().toLowerCase();
    if (r === "q") process.exit(0);
    if (r === "l") {
      liste();
      continue;
    }
    const ecoute = r.match(/^e\s*(\d)$/);
    if (ecoute) {
      const v = voix[Number(ecoute[1]) - 1];
      if (v) await ecouterExtrait(v, Number(ecoute[1]) - 1).catch(() => {});
      continue;
    }
    const v = voix[Number(r) - 1];
    if (!v) continue;

    // la voix rejoint ton compte (c'est ce qui permet à Max de s'en servir)
    let id = v.voice_id;
    try {
      id = (await api<{ voice_id: string }>(cle, `/v1/voices/add/${v.public_owner_id}/${v.voice_id}`, { method: "POST", body: { new_name: `Max · ${v.name}` } })).voice_id;
    } catch (e) {
      console.log(`  (ajout à ton compte : ${(e as Error).message} — j'essaie quand même)`);
    }
    console.log(`\n… Max essaie la voix de ${v.name}`);
    const essai = new ElevenLabs({ ...config.voix.elevenlabs, cle, voix: id, nomVoix: v.name }, { dossierCache: path.join(tmp, "cache") });
    const f = path.join(tmp, "essai.wav");
    try {
      await essai.synthetiser("Bonsoir. Ici Max. Tous les systèmes sont en ligne, et ta séance de ce soir est prête. Je t'écoute.", f);
      await jouer(f);
    } catch (e) {
      console.log(`✘ ${(e as Error).message}. Choisis-en une autre.`);
      continue;
    }
    const ok = (await rl.question("On garde cette voix ? (o/n) : ")).trim().toLowerCase();
    if (!ok.startsWith("o")) continue;
    enregistrerChoix(fichierConfig, { ...(nouvelleCle ? { cle } : {}), voix: id, nomVoix: v.name });
    console.log(`\n✔ C'est fait : Max parlera avec la voix de ${v.name}.`);
    console.log("  Pour l'entendre : npm run arreter, puis « Dis Siri, Max au rapport ».");
    console.log(`  Ta clé et ton choix sont dans ${fichierConfig} (il ne part jamais sur GitHub).`);
    if (gratuit) console.log("  Compte gratuit : environ 10 000 caractères par mois. Quand c'est épuisé, Max reprend sa voix d'avant jusqu'au mois suivant.");
    break;
  }
  rl.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(`✘ ${(e as Error).message}`);
  process.exit(1);
});
