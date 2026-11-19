#!/usr/bin/env node
// Faux `say` pour les tests. `say -v ?` liste des voix ; sinon note la phrase dans FAKE_SAY_LOG et attend FAKE_SAY_MS.
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "-v" && args[1] === "?") {
  console.log(
    process.env.FAKE_SAY_VOIX ??
      [
        "Samantha            en_US    # Hello, my name is Samantha.",
        "Thomas              fr_FR    # Bonjour, je m’appelle Thomas.",
        "Audrey (Premium)    fr_FR    # Bonjour, je m’appelle Audrey.",
        "Amélie              fr_CA    # Bonjour, je m’appelle Amélie.",
      ].join("\n"),
  );
  process.exit(0);
}
if (process.env.FAKE_SAY_LOG) fs.appendFileSync(process.env.FAKE_SAY_LOG, JSON.stringify(args) + "\n");
setTimeout(() => process.exit(0), Number(process.env.FAKE_SAY_MS ?? 50));
