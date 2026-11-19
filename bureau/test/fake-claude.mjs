#!/usr/bin/env node
// Faux `claude` pour les tests : imite `claude -p` sans consommer de quota.
// FAKE_MODE = ok | quota | crash | bad-plan | slow
// FAKE_PLAN = plan JSON à renvoyer ; FAKE_PROJET = ajoute un codeur sur ce projet
// FAKE_LOG = fichier où ajouter {argv, cwd} à chaque appel ; FAKE_DELAY = ms entre événements
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const prompt = args[args.indexOf("-p") + 1] ?? "";
const mode = process.env.FAKE_MODE ?? "ok";
const delay = Number(process.env.FAKE_DELAY ?? 20);
const resume = args.includes("--resume");
const relecture = prompt.includes("RELECTURE");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: args, cwd: process.cwd() }) + "\n");

if (args.includes("--version")) {
  console.log("9.9.9 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(JSON.stringify({ loggedIn: process.env.FAKE_AUTH !== "out", authMethod: "oauth_token" }));
  process.exit(process.env.FAKE_AUTH === "out" ? 1 : 0);
}

// Mode conversation (Max en continu) : lit les messages sur stdin, répond en streaming.
// Le message contient « quota » → limite atteinte ; « plante » → le processus meurt ; « outil » → appelle un outil.
if (args.includes("--input-format")) {
  const session = `fake-conv-${Math.random().toString(36).slice(2, 8)}`;
  emit({ type: "system", subtype: "init", session_id: session });
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin });
  let file = Promise.resolve();
  rl.on("line", (ligne) => {
    file = file.then(async () => {
      const texte = JSON.parse(ligne).message.content;
      if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ message: texte }) + "\n");
      if (texte.includes("plante")) {
        process.stderr.write("erreur interne\n");
        process.exit(1);
      }
      if (texte.includes("quota")) {
        emit({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1793865600", session_id: session });
        return;
      }
      if (texte.includes("outil")) {
        emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__bureau__etat_bureau", input: {} }] } });
      }
      const reponse = process.env.FAKE_REPONSE ?? `Bien reçu : ${texte}. Autre chose ?`;
      for (let i = 0; i < reponse.length; i += 7) {
        emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reponse.slice(i, i + 7) } } });
        await sleep(delay);
      }
      emit({ type: "assistant", message: { content: [{ type: "text", text: reponse }] } });
      emit({ type: "result", subtype: "success", is_error: false, result: reponse, session_id: session });
    });
  });
  rl.on("close", () => file.then(() => process.exit(0)));
} else {

if (mode === "slow") await sleep(10_000);

// Conseiller : une question, une réponse (avec une ligne « À retenir »), sans écrire de fichier.
const systeme = args[args.indexOf("--append-system-prompt") + 1] ?? "";
if (systeme.includes("le conseiller «")) {
  emit({ type: "system", subtype: "init", session_id: "fake-conseil" });
  if (mode === "quota") {
    emit({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1793865600" });
    process.exit(1);
  }
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebSearch", input: { query: prompt.slice(0, 40) } }] } });
  await sleep(delay);
  const reponse = process.env.FAKE_REPONSE ?? `Mon conseil sur : ${prompt.split("\n").at(-1)}\nÀ retenir : préfère réviser le matin`;
  emit({ type: "assistant", message: { content: [{ type: "text", text: reponse }] } });
  emit({ type: "result", subtype: "success", is_error: false, result: reponse });
  process.exit(0);
}

// Tri automatique des mails : « promo » dans la ligne → pubs, sinon à traiter (ou FAKE_TRI, JSON).
if (args.includes("--json-schema") && prompt.startsWith("TRI DES MAILS")) {
  const tri = process.env.FAKE_TRI ? JSON.parse(process.env.FAKE_TRI) : { categories: { a_traiter: [], etudes: [], business: [], perso: [], pubs: [] }, resume: "Un mail important à traiter." };
  if (!process.env.FAKE_TRI) {
    for (const m of prompt.matchAll(/^\[(\d+)\] (.*)$/gm)) (/promo/i.test(m[2]) ? tri.categories.pubs : tri.categories.a_traiter).push(Number(m[1]));
  }
  emit({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(tri), structured_output: tri });
  process.exit(0);
}

if (args.includes("--json-schema")) {
  const robots1 = [{ role: "chercheur", tache: "Chercher les infos" }];
  if (process.env.FAKE_PROJET) robots1.push({ role: "codeur", tache: "Coder la fonctionnalité" });
  const plan = process.env.FAKE_PLAN
    ? JSON.parse(process.env.FAKE_PLAN)
    : {
        titre: "Mission test",
        slug: "mission-test",
        annonce: "Je prends un chercheur et un rédacteur.",
        projet: process.env.FAKE_PROJET ?? null,
        etapes: [{ robots: robots1 }, { robots: [{ role: "redacteur", tache: "Écrire la synthèse" }] }],
      };
  const structured = mode === "bad-plan" ? { titre: "incomplet" } : plan;
  emit({ type: "result", subtype: "success", is_error: false, result: JSON.stringify(structured), structured_output: structured });
  process.exit(0);
}

const session = `fake-${Math.random().toString(36).slice(2, 8)}`;
emit({ type: "system", subtype: "init", session_id: session, cwd: process.cwd() });
await sleep(delay);

if (!relecture && !resume && mode === "quota") {
  emit({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1793865600", session_id: session });
  process.exit(1);
}
if (!relecture && mode === "crash") {
  process.stderr.write("boom\n");
  process.exit(1);
}

emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "WebSearch", input: { query: "recherche de test" } }] } });
await sleep(delay);

if (relecture) {
  fs.writeFileSync(path.join(process.cwd(), "RESULTAT.md"), "# Résultat\n\nSynthèse de test par Max.\n");
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Write", input: { file_path: path.join(process.cwd(), "RESULTAT.md") } }] } });
} else {
  const cible = prompt.match(/rapport dans : (.+)$/m)?.[1]?.trim() ?? path.join(process.cwd(), "rapport.md");
  fs.writeFileSync(cible, `# Rapport\n\nTâche : ${prompt.split("\n")[0]}\n\n## Sources\n- https://example.com\n`);
  if (prompt.includes("branche Git")) fs.writeFileSync(path.join(process.cwd(), "fake-change.txt"), "changement\n");
  emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Write", input: { file_path: cible } }] } });
}
await sleep(delay);
emit({ type: "assistant", message: { content: [{ type: "text", text: "Travail terminé." }] } });
emit({ type: "result", subtype: "success", is_error: false, result: "Travail terminé.", session_id: session });
}
