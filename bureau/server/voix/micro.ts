// Choisir le micro dans la liste d'ffmpeg (`ffmpeg -f avfoundation -list_devices true -i ""`).

export interface Micro {
  index: number;
  nom: string;
}

const VIRTUELS = /zoom|teams|blackhole|soundflower|loopback|agr[ée]g|aggregate|virtual|virtuel|iphone|ipad|\bobs\b|krisp|camo/i;
const INTEGRES = /macbook|imac|mac mini|mac studio|studio display|built-in|int[ée]gr|interne/i;

export function listerMicros(sortie: string): Micro[] {
  const out: Micro[] = [];
  let audio = false;
  for (const l of sortie.split("\n")) {
    if (/audio devices:/i.test(l)) audio = true;
    else if (/video devices:/i.test(l)) audio = false;
    else if (audio) {
      const m = l.match(/\[(\d+)\]\s+(.+?)\s*$/);
      if (m) out.push({ index: Number(m[1]), nom: m[2] });
    }
  }
  return out;
}

/** Le micro intégré du Mac de préférence, sinon le premier micro réel ; format avfoundation « :N ». */
export function choisirMicro(sortie: string): string | null {
  const micros = listerMicros(sortie);
  if (!micros.length) return null;
  const choisi =
    micros.find((m) => INTEGRES.test(m.nom) && !VIRTUELS.test(m.nom)) ?? micros.find((m) => !VIRTUELS.test(m.nom)) ?? micros[0];
  return `:${choisi.index}`;
}
