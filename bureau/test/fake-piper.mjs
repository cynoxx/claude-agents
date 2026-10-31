#!/usr/bin/env node
// Faux serveur Piper pour les tests : même protocole (une ligne JSON par phrase), écrit un petit fichier.
// FAKE_PIPER_MODE = ok | plante (ne démarre pas) | rate (chaque phrase échoue)
import fs from "node:fs";
import { createInterface } from "node:readline";
const mode = process.env.FAKE_PIPER_MODE ?? "ok";
if (mode === "plante") {
  process.stderr.write("ModuleNotFoundError: No module named 'piper'\n");
  process.exit(1);
}
setTimeout(() => console.log(JSON.stringify({ pret: true })), 30);
createInterface({ input: process.stdin }).on("line", (l) => {
  const d = JSON.parse(l);
  if (mode === "rate") return console.log(JSON.stringify({ id: d.id, ok: false, erreur: "boum" }));
  fs.writeFileSync(d.fichier, `WAV:${d.texte}`);
  if (process.env.FAKE_PIPER_LOG) fs.appendFileSync(process.env.FAKE_PIPER_LOG, d.texte + "\n");
  setTimeout(() => console.log(JSON.stringify({ id: d.id, ok: true })), 20);
});
