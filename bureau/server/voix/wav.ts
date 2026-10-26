/** PCM 16 bits mono → fichier WAV (ce que whisper-cli attend). */
export function encoderWav(pcm: Int16Array, taux = 16000): Buffer {
  const donnees = pcm.length * 2;
  const b = Buffer.alloc(44 + donnees);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + donnees, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16); // taille du bloc fmt
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(taux, 24);
  b.writeUInt32LE(taux * 2, 28); // octets par seconde
  b.writeUInt16LE(2, 32); // octets par échantillon
  b.writeUInt16LE(16, 34); // bits par échantillon
  b.write("data", 36, "ascii");
  b.writeUInt32LE(donnees, 40);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i], 44 + i * 2);
  return b;
}
