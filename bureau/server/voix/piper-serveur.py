# La voix de Max avec Piper (voix neuronale locale) : charge le modèle une fois, puis lit des demandes sur
# l'entrée standard, une ligne JSON par phrase : {"id": 1, "texte": "...", "fichier": "/chemin.wav"}.
# Répond une ligne JSON par demande : {"id": 1, "ok": true} (ou {"ok": false, "erreur": "..."}).
import json
import sys
import wave

from piper import PiperVoice, SynthesisConfig

voix = PiperVoice.load(sys.argv[1])
vitesse = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
# length_scale > 1 ralentit, < 1 accélère : on inverse pour que « vitesse » se lise naturellement
reglage = SynthesisConfig(length_scale=1.0 / max(0.5, min(vitesse, 2.0)))
print(json.dumps({"pret": True}), flush=True)

for ligne in sys.stdin:
    demande = {}
    try:
        demande = json.loads(ligne)
        with wave.open(demande["fichier"], "wb") as w:
            voix.synthesize_wav(demande["texte"], w, reglage)
        print(json.dumps({"id": demande["id"], "ok": True}), flush=True)
    except Exception as e:  # une phrase ratée ne doit pas arrêter la voix
        print(json.dumps({"id": demande.get("id"), "ok": False, "erreur": str(e)}), flush=True)
