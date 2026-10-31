#!/usr/bin/env node
// Faux ffmpeg pour les tests : écrit du PCM 16 bits mono 16 kHz sur stdout.
// FAKE_FFMPEG = phrase (silence, 1 s de « voix », silence, puis fin) | erreur | infini
const mode = process.env.FAKE_FFMPEG ?? "phrase";
const args = process.argv.slice(2);
if (args.includes("-version")) {
  console.log("ffmpeg version 9.9-fake");
  process.exit(0);
}
if (args.includes("-list_devices")) {
  process.stderr.write("[AVFoundation indev @ 0x1] AVFoundation audio devices:\n[AVFoundation indev @ 0x1] [0] Microphone MacBook Pro\n");
  process.exit(1);
}
const TAUX = 16000;
const morceau = (ms, voix) => {
  const n = Math.round((TAUX * ms) / 1000);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const bruit = (Math.random() * 2 - 1) * 100;
    b.writeInt16LE(Math.round(voix ? 8000 * Math.sin((2 * Math.PI * 220 * i) / TAUX) + bruit : bruit), i * 2);
  }
  return b;
};
if (mode === "erreur") {
  process.stderr.write("[avfoundation] Input/output error: accès au micro refusé\n");
  process.exit(1);
}
if (mode === "infini") {
  setInterval(() => process.stdout.write(morceau(100, false)), 100);
} else {
  // un octet isolé à la fin du premier morceau, pour vérifier le recollage des échantillons coupés en deux
  const tout = Buffer.concat([morceau(500, false), morceau(1000, true), morceau(1200, false)]);
  process.stdout.write(tout.subarray(0, 7777));
  setTimeout(() => {
    process.stdout.write(tout.subarray(7777));
    process.stdout.end();
  }, 20);
}
