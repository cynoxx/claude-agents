#!/usr/bin/env node
// Faux whisper-cli pour le Studio : écrit <-of>.json avec un mot par segment.
import fs from "node:fs";
const a = process.argv.slice(2);
const base = a[a.indexOf("-of") + 1];
const mots = ["La", "discipline", "bat", "le", "talent."];
fs.writeFileSync(`${base}.json`, JSON.stringify({ transcription: mots.map((t, i) => ({ offsets: { from: 200 + i * 300, to: 450 + i * 300 }, text: " " + t })) }));
