// Transcription locale avec whisper.cpp (`whisper-cli`).

/** La sortie de `whisper-cli -nt -np` → une seule ligne de texte. */
export function lireSortieWhisper(sortie: string): string {
  return sortie
    .split("\n")
    .map((l) => l.replace(/^\[\d\d:\d\d:\d\d\.\d{3} --> [^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
