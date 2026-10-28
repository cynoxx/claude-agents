# La voix de Max avec XTTS v2 (voix neuronale locale, très naturelle) : charge le modèle une fois, puis lit des
# demandes sur l'entrée standard, une ligne JSON par phrase : {"id": 1, "texte": "...", "fichier": "/chemin.wav"}
# (et, pour l'essai des voix, "locuteur"). Répond une ligne JSON par demande : {"id": 1, "ok": true}.
# Arguments : locuteur, vitesse, appareil (cpu ou mps), et « accord » si la licence du modèle a été acceptée.
import json
import os
import sys
import tempfile
import wave

locuteur = sys.argv[1] if len(sys.argv) > 1 else ""
vitesse = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
appareil = sys.argv[3] if len(sys.argv) > 3 else "cpu"
if len(sys.argv) > 4 and sys.argv[4] == "accord":
    # l'utilisateur a accepté la licence CPML pendant l'installation (npm run voix-xtts)
    os.environ["COQUI_TOS_AGREED"] = "1"
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np  # noqa: E402
from TTS.api import TTS  # noqa: E402

try:
    import torch  # noqa: E402

    # tous les cœurs du processeur (par défaut, PyTorch en garde sous le coude)
    torch.set_num_threads(max(1, os.cpu_count() or 1))
except Exception:
    torch = None

tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False)
# « auto » : la puce graphique du Mac (MPS) si elle est là, bien plus rapide ; on vérifie plus bas qu'elle sait dire
# une phrase, sinon retour au processeur
if appareil == "auto":
    mps = getattr(getattr(torch, "backends", None), "mps", None)
    appareil = "mps" if mps is not None and mps.is_available() else "cpu"
if appareil != "cpu":
    try:
        tts.to(appareil)
    except Exception:  # la puce graphique ne sait pas : on reste sur le processeur
        appareil = "cpu"
connus = sorted(tts.speakers or [])
if locuteur not in connus and connus:
    locuteur = connus[0]
taux = int(getattr(tts.synthesizer, "output_sample_rate", 24000) or 24000)


def dire(texte, qui, fichier):
    try:
        son = tts.tts(text=texte, speaker=qui, language="fr", speed=vitesse)
    except TypeError:  # une version sans réglage de vitesse
        son = tts.tts(text=texte, speaker=qui, language="fr")
    a = np.clip(np.asarray(son, dtype=np.float32), -1.0, 1.0)
    with wave.open(fichier, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taux)
        w.writeframes((a * 32767).astype("<i2").tobytes())


# une première phrase pour tout mettre en route (la suivante sera plus rapide)
with tempfile.TemporaryDirectory() as dossier:
    try:
        dire("Bonjour.", locuteur, os.path.join(dossier, "essai.wav"))
    except Exception:
        if appareil == "cpu":
            raise
        # la puce graphique a calé sur une opération : tout sur le processeur
        appareil = "cpu"
        tts.to("cpu")
        dire("Bonjour.", locuteur, os.path.join(dossier, "essai.wav"))
print(json.dumps({"pret": True, "locuteur": locuteur, "locuteurs": connus, "appareil": appareil}), flush=True)

for ligne in sys.stdin:
    demande = {}
    try:
        demande = json.loads(ligne)
        dire(demande["texte"], demande.get("locuteur") or locuteur, demande["fichier"])
        print(json.dumps({"id": demande["id"], "ok": True}), flush=True)
    except Exception as e:  # une phrase ratée ne doit pas arrêter la voix
        print(json.dumps({"id": demande.get("id"), "ok": False, "erreur": str(e)}), flush=True)
