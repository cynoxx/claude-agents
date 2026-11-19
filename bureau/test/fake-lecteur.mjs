#!/usr/bin/env node
// Faux `afplay` pour les tests : note le contenu du fichier lu dans FAKE_LECTEUR_LOG, puis attend FAKE_LECTEUR_MS.
import fs from "node:fs";
const f = process.argv[2];
if (process.env.FAKE_LECTEUR_LOG) fs.appendFileSync(process.env.FAKE_LECTEUR_LOG, fs.readFileSync(f, "utf8") + "\n");
setTimeout(() => process.exit(0), Number(process.env.FAKE_LECTEUR_MS ?? 40));
