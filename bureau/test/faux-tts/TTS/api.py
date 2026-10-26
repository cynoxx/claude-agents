# Un faux XTTS pour les tests : même interface que coqui-tts, un son de 0,1 s par phrase.
import math


class _Synth:
    output_sample_rate = 24000


class TTS:
    def __init__(self, nom, progress_bar=True):
        self.speakers = ["Ana Florence", "Damien Black", "Viktor Eka"]
        self.synthesizer = _Synth()

    def to(self, appareil):
        return self

    def tts(self, text, speaker=None, language=None, speed=1.0):
        if "PLANTE" in text:
            raise ValueError("phrase impossible")
        assert language == "fr" and speaker in self.speakers
        n = int(2400 / speed)
        return [0.5 * math.sin(i / 10) for i in range(n)]
