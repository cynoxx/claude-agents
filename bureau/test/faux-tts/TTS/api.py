# Un faux XTTS pour les tests : même interface que coqui-tts (TTS, puis le modèle et son inference), un son de
# 0,1 s par phrase.
import math


class _Gestion:
    speakers = {n: {"gpt_cond_latent": n, "speaker_embedding": n} for n in ["Ana Florence", "Damien Black", "Viktor Eka"]}


class _Modele:
    speaker_manager = _Gestion()

    def get_conditioning_latents(self, audio_path, **k):
        return ("ref", "ref")

    def inference(self, text, language, gpt_cond_latent, speaker_embedding, speed=1.0, **k):
        if "PLANTE" in text:
            raise ValueError("phrase impossible")
        assert language == "fr" and (gpt_cond_latent in _Gestion.speakers or gpt_cond_latent == "ref")
        n = int(2400 / speed)
        return {"wav": [0.5 * math.sin(i / 10) for i in range(n)]}


class _Synth:
    output_sample_rate = 24000
    tts_model = _Modele()


class TTS:
    def __init__(self, nom, progress_bar=True):
        self.speakers = sorted(_Gestion.speakers)
        self.synthesizer = _Synth()

    def to(self, appareil):
        return self
