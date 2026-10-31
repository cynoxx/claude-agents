# La voix de Max avec XTTS v2 (voix neuronale locale, très naturelle) : charge le modèle une fois, puis lit des
# demandes sur l'entrée standard, une ligne JSON par phrase : {"id": 1, "texte": "...", "fichier": "/chemin.wav"}
# (et, pour l'essai des voix, "locuteur"). Répond une ligne JSON par demande : {"id": 1, "ok": true}.
# Arguments : locuteur, vitesse, appareil (cpu ou mps), puis « accord » si la licence du modèle a été acceptée et
# « ref=/chemin.wav » pour parler avec une voix de référence (une voix française : plus d'accent anglais).
#
# Pour une voix propre :
# - le modèle est appelé directement, avec des réglages plus sages que ceux par défaut (moins de « hasard » : plus de
#   syllabes inventées ni de bégaiements) ;
# - les phrases trop longues pour leur texte (XTTS « babille » parfois après une phrase courte) sont refaites, puis
#   coupées si besoin ;
# - le son est nettoyé : silences du début et de la fin retirés, fondus de 10 ms, volume égalisé.
import json
import os
import sys
import tempfile
import wave

locuteur = sys.argv[1] if len(sys.argv) > 1 else ""
vitesse = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
appareil = sys.argv[3] if len(sys.argv) > 3 else "cpu"
options = sys.argv[4:]
if "accord" in options:
    # l'utilisateur a accepté la licence CPML pendant l'installation (npm run voix-xtts)
    os.environ["COQUI_TOS_AGREED"] = "1"
reference = next((o[4:] for o in options if o.startswith("ref=")), "")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np  # noqa: E402
from TTS.api import TTS  # noqa: E402

try:
    import torch  # noqa: E402

    # tous les cœurs du processeur (par défaut, PyTorch en garde sous le coude)
    torch.set_num_threads(max(1, os.cpu_count() or 1))
except Exception:
    torch = None

# des réglages plus calmes que ceux du modèle (0,75 / 0,85) : une diction plus nette, sans syllabes inventées
REGLAGES = {"temperature": 0.6, "top_p": 0.8, "top_k": 40, "repetition_penalty": 8.0, "length_penalty": 1.0}

tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False)
if appareil == "auto":
    mps = getattr(getattr(torch, "backends", None), "mps", None)
    appareil = "mps" if mps is not None and mps.is_available() else "cpu"
if appareil != "cpu":
    try:
        tts.to(appareil)
    except Exception:  # la puce graphique ne sait pas : on reste sur le processeur
        appareil = "cpu"
modele = tts.synthesizer.tts_model
connus = sorted(tts.speakers or [])
if locuteur not in connus and connus:
    locuteur = connus[0]
taux = int(getattr(tts.synthesizer, "output_sample_rate", 24000) or 24000)

# les « empreintes » de voix, calculées une fois : la voix de référence (si elle est là), sinon les voix intégrées
empreintes = {}


def empreinte(qui):
    if qui in empreintes:
        return empreintes[qui]
    if qui == "@reference":
        e = modele.get_conditioning_latents(audio_path=[reference], gpt_cond_len=30, gpt_cond_chunk_len=6, max_ref_length=60)
    else:
        s = modele.speaker_manager.speakers[qui]
        e = (s["gpt_cond_latent"], s["speaker_embedding"])
    empreintes[qui] = e
    return e


voix_ref = ""
if reference and os.path.exists(reference):
    try:
        empreinte("@reference")
        voix_ref = "@reference"
    except Exception as e:  # une référence illisible : les voix intégrées
        print(json.dumps({"avertissement": f"voix de référence illisible : {e}"}), flush=True)


def generer(texte, qui, temperature):
    gpt, emb = empreinte(qui)
    r = dict(REGLAGES, temperature=temperature)
    with torch.inference_mode() if torch else _rien():
        sortie = modele.inference(texte, "fr", gpt, emb, speed=vitesse, enable_text_splitting=False, **r)
    son = sortie["wav"]
    if hasattr(son, "cpu"):
        son = son.cpu().numpy()
    return np.asarray(son, dtype=np.float32).reshape(-1)


class _rien:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def duree_attendue(texte):
    # environ 14 caractères par seconde en français, plus un petit souffle
    return 0.45 + len(texte) / (14.0 * max(0.5, vitesse))


def nettoyer(a):
    # silences du début et de la fin retirés (seuil relatif), fondus, volume égalisé
    if a.size == 0:
        return a
    pic = float(np.max(np.abs(a))) or 1.0
    fen = max(1, int(taux * 0.01))
    n = a.size // fen
    if n > 2:
        energie = np.sqrt(np.mean(a[: n * fen].reshape(n, fen) ** 2, axis=1))
        actif = np.where(energie > pic * 0.02)[0]
        if actif.size:
            debut = max(0, (actif[0] - 2) * fen)
            fin = min(a.size, (actif[-1] + 4) * fen)
            a = a[debut:fin]
    a = a * (0.89 / pic)
    f = min(a.size // 2, int(taux * 0.01))
    if f > 0:
        rampe = np.linspace(0.0, 1.0, f, dtype=np.float32)
        a[:f] *= rampe
        a[-f:] *= rampe[::-1]
    return np.concatenate([a, np.zeros(int(taux * 0.06), dtype=np.float32)])


def couper_babil(a, texte):
    # garde jusqu'au dernier silence avant la durée attendue (+30 %)
    limite = int(duree_attendue(texte) * 1.3 * taux)
    if a.size <= limite:
        return a
    fen = max(1, int(taux * 0.02))
    pic = float(np.max(np.abs(a))) or 1.0
    for i in range(limite, int(limite * 0.6), -fen):
        if float(np.sqrt(np.mean(a[i - fen : i] ** 2))) < pic * 0.03:
            return a[:i]
    return a[:limite]


def dire(texte, qui, fichier):
    qui = qui or voix_ref or locuteur
    if qui != "@reference" and qui not in connus:
        qui = voix_ref or locuteur
    a = generer(texte, qui, REGLAGES["temperature"])
    # trop longue pour son texte : XTTS a babillé, on refait plus sagement, puis on coupe s'il le faut
    if a.size / taux > duree_attendue(texte) * 1.6 + 0.6:
        b = generer(texte, qui, 0.45)
        a = b if b.size < a.size else a
        a = couper_babil(a, texte)
    a = np.clip(nettoyer(a), -1.0, 1.0)
    with wave.open(fichier, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taux)
        w.writeframes((a * 32767).astype("<i2").tobytes())


# une première phrase pour tout mettre en route (la suivante sera plus rapide)
with tempfile.TemporaryDirectory() as dossier:
    try:
        dire("Bonjour.", "", os.path.join(dossier, "essai.wav"))
    except Exception:
        if appareil == "cpu":
            raise
        # la puce graphique a calé sur une opération : tout sur le processeur
        appareil = "cpu"
        tts.to("cpu")
        empreintes.clear()
        if voix_ref:
            empreinte("@reference")
        dire("Bonjour.", "", os.path.join(dossier, "essai.wav"))
print(json.dumps({"pret": True, "locuteur": "voix de référence" if voix_ref else locuteur, "locuteurs": connus, "appareil": appareil}), flush=True)

for ligne in sys.stdin:
    demande = {}
    try:
        demande = json.loads(ligne)
        dire(demande["texte"], demande.get("locuteur") or "", demande["fichier"])
        print(json.dumps({"id": demande["id"], "ok": True}), flush=True)
    except Exception as e:  # une phrase ratée ne doit pas arrêter la voix
        print(json.dumps({"id": demande.get("id"), "ok": False, "erreur": str(e)}), flush=True)
