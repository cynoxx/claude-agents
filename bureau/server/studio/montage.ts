// Le montage des vidéos du Studio, sans DOM ni processus (testable) : les mots minutés de Whisper deviennent des
// sous-titres mot par mot (ASS, le mot dit en couleur), et la commande ffmpeg monte une vidéo verticale 9:16 :
// fond (ta vidéo, ton image ou un dégradé sombre qui bouge), titre, sous-titres, ta voix et la musique en dessous.

export interface Mot {
  texte: string;
  /** en secondes */
  debut: number;
  fin: number;
}

export const LARGEUR = 1080;
export const HAUTEUR = 1920;

/** La sortie JSON de `whisper-cli -ml 1 -sow -oj` (un mot par segment) → les mots minutés. */
export function lireMotsWhisper(json: string): Mot[] {
  const d = JSON.parse(json) as { transcription?: { offsets?: { from: number; to: number }; text?: string }[] };
  return (d.transcription ?? [])
    .map((s) => ({ texte: (s.text ?? "").trim(), debut: (s.offsets?.from ?? 0) / 1000, fin: (s.offsets?.to ?? 0) / 1000 }))
    .filter((m) => m.texte && !/^\[.*\]$/.test(m.texte));
}

/** Les mots en groupes courts à l'écran : 3 mots au plus, coupés après une ponctuation ou un blanc dans la voix. */
export function grouperMots(mots: Mot[], max = 3): Mot[][] {
  const groupes: Mot[][] = [];
  let g: Mot[] = [];
  for (const [i, m] of mots.entries()) {
    g.push(m);
    const suivant = mots[i + 1];
    const coupe = g.length >= max || /[.,!?;:…]$/.test(m.texte) || (suivant && suivant.debut - m.fin > 0.35);
    if (coupe || !suivant) {
      groupes.push(g);
      g = [];
    }
  }
  return groupes;
}

const temps = (s: number) => {
  const cs = Math.max(0, Math.round(s * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const echapperAss = (t: string) => t.replace(/[{}]/g, "").replace(/\\/g, "").replace(/\n/g, " ");

export interface Habillage {
  /** En haut, tout le long (« LOI 9 »). */
  titre: string;
  /** Sous le titre, plus petit (« 48 LOIS POUR RÉUSSIR EN MÉDECINE »). */
  bandeau?: string;
  /** Les 2,5 dernières secondes (« Le livre complet : lien en bio »). */
  appel?: string;
  /** Couleur du mot dit, en #RRGGBB. */
  couleur?: string;
  police?: string;
}

/** #RRGGBB → la couleur ASS (&HBBGGRR&). */
export const couleurAss = (hex: string) => {
  const h = hex.replace("#", "").padStart(6, "0");
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
};

/** Le fichier de sous-titres ASS : titre en accroche puis en haut, mots en gros au centre, appel à la fin. */
export function sousTitresAss(mots: Mot[], duree: number, h: Habillage): string {
  const police = h.police ?? "Arial Black";
  const or = couleurAss(h.couleur ?? "#FFD23F");
  const lignes = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${LARGEUR}`,
    `PlayResY: ${HAUTEUR}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Mots,${police},104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,5,70,70,0,1`,
    `Style: Titre,${police},92,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,4,0,1,6,2,8,60,60,230,1`,
    `Style: Bandeau,${police},40,${or},${or},&H00000000,&H64000000,-1,0,0,0,100,100,3,0,1,4,0,8,60,60,350,1`,
    `Style: Appel,${police},64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,70,70,300,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev = (debut: number, fin: number, style: string, texte: string, couche = 0) =>
    lignes.push(`Dialogue: ${couche},${temps(debut)},${temps(fin)},${style},,0,0,0,,${texte}`);
  const titre = echapperAss(h.titre.toUpperCase());
  // l'accroche : le titre en grand au centre, qui claque, puis il reste en haut
  ev(0, 1.4, "Mots", `{\\fs150\\fscx140\\fscy140\\t(0,180,\\fscx100\\fscy100)\\fad(0,200)}${titre}`, 2);
  ev(1.2, duree, "Titre", `{\\fad(250,0)}${titre}`);
  if (h.bandeau) ev(1.2, duree, "Bandeau", `{\\fad(250,0)}${echapperAss(h.bandeau.toUpperCase())}`);
  const finMots = h.appel ? Math.max(1.4, duree - 2.5) : duree;
  for (const g of grouperMots(mots)) {
    const debutG = Math.max(1.4, g[0].debut);
    for (const [i, m] of g.entries()) {
      const debut = i === 0 ? debutG : Math.max(debutG, m.debut);
      const fin = i === g.length - 1 ? Math.max(m.fin, debut + 0.25) : Math.max(g[i + 1].debut, debut + 0.05);
      if (debut >= finMots) continue;
      // le groupe entier, le mot dit en couleur ; le groupe « saute » à son apparition
      const pop = i === 0 ? "{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}" : "";
      const texte = g.map((x, j) => (j === i ? `{\\c${or}}${echapperAss(x.texte.toUpperCase())}{\\c&HFFFFFF&}` : echapperAss(x.texte.toUpperCase()))).join(" ");
      ev(debut, Math.min(fin, finMots), "Mots", pop + texte, 1);
    }
  }
  if (h.appel) ev(finMots, duree, "Appel", `{\\fad(200,0)}${echapperAss(h.appel)}`);
  return lignes.join("\n") + "\n";
}

export interface EntreesMontage {
  voix: string;
  ass: string;
  sortie: string;
  duree: number;
  /** Une vidéo ou une image de fond ; sinon un dégradé sombre qui bouge. */
  fond?: { fichier: string; type: "video" | "image" } | null;
  musique?: string | null;
  /** La couleur du dégradé (#RRGGBB), sans fond. */
  teinte?: string;
}

const echapperFiltre = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");

/** Les arguments de ffmpeg pour monter la vidéo verticale. */
export function argsMontage(e: EntreesMontage): string[] {
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  const d = e.duree.toFixed(2);
  if (e.fond?.type === "video") args.push("-stream_loop", "-1", "-i", e.fond.fichier);
  else if (e.fond?.type === "image") args.push("-loop", "1", "-framerate", "30", "-i", e.fond.fichier);
  else args.push("-f", "lavfi", "-i", `gradients=s=${LARGEUR}x${HAUTEUR}:c0=0x07070c:c1=${(e.teinte ?? "#3a0d12").replace("#", "0x")}:x0=0:y0=0:x1=${LARGEUR}:y1=${HAUTEUR}:speed=0.008:rate=30`);
  args.push("-i", e.voix);
  if (e.musique) args.push("-stream_loop", "-1", "-i", e.musique);
  const cadre = `scale=${LARGEUR}:${HAUTEUR}:force_original_aspect_ratio=increase,crop=${LARGEUR}:${HAUTEUR}`;
  const fond =
    e.fond?.type === "image"
      ? `[0:v]${cadre},zoompan=z='min(zoom+0.0005,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${LARGEUR}x${HAUTEUR}:fps=30,eq=brightness=-0.18:saturation=0.85`
      : e.fond?.type === "video"
        ? `[0:v]${cadre},fps=30,eq=brightness=-0.2:saturation=0.8`
        : `[0:v]noise=alls=6:allf=t`;
  const filtres = [
    `${fond},vignette=PI/4,ass='${echapperFiltre(e.ass)}',format=yuv420p[v]`,
    `[1:a]aresample=48000,loudnorm=I=-14:TP=-1.5:LRA=11,apad=pad_dur=0.6[voix]`,
  ];
  if (e.musique) {
    filtres.push(`[voix]asplit=2[voixa][voixb]`, `[2:a]aresample=48000,volume=0.22[mus]`, `[mus][voixb]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[musb]`, `[voixa][musb]amix=inputs=2:duration=first:normalize=0[a]`);
  } else filtres.push(`[voix]anull[a]`);
  args.push(
    "-filter_complex", filtres.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-t", d,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", "30",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    e.sortie,
  );
  return args;
}

/** Les arguments de ffmpeg pour préparer ta voix : début silencieux coupé, mono 16 kHz (ce que Whisper attend). */
export function argsVoix(entree: string, sortie: string): string[] {
  return ["-y", "-hide_banner", "-loglevel", "error", "-i", entree, "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,highpass=f=70", "-ac", "1", "-ar", "16000", sortie];
}

/** Les arguments de ffmpeg pour mettre un clip au format vertical (le clip au centre, flouté derrière). */
export function argsVertical(entree: string, sortie: string): string[] {
  return [
    "-y", "-hide_banner", "-loglevel", "error", "-i", entree,
    "-filter_complex",
    `[0:v]split[a][b];[a]scale=${LARGEUR}:${HAUTEUR}:force_original_aspect_ratio=increase,crop=${LARGEUR}:${HAUTEUR},boxblur=24:4,eq=brightness=-0.15[fond];[b]scale=${LARGEUR}:-2[clip];[fond][clip]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    sortie,
  ];
}

/** La légende à coller sous la vidéo : le modèle du compte, avec {titre} et {phrase} (la première phrase dite). */
export function legende(modele: string, titre: string, texte: string): string {
  const premiere = (texte.match(/^.*?[.!?…](\s|$)/)?.[0] ?? texte).trim();
  const phrase = premiere.length > 140 ? premiere.slice(0, 139).trimEnd() + "…" : premiere;
  return modele.replace(/\{titre\}/g, titre).replace(/\{phrase\}/g, phrase).trim();
}

/** « loi 9.m4a », « Loi_9 - final.wav » → « Loi 9 ». */
export function titreDepuisFichier(nom: string): string {
  const base = nom.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+-\s+.*$/, "").replace(/\s+/g, " ").trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}
