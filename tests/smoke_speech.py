"""Optional offline smoke check with installed Piper/Whisper models (no enrollment)."""
import io
import os
import re
import sys
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["NEXA_STT_DEVICE"] = "cpu"
os.environ["HF_HUB_OFFLINE"] = "1"
import server


def synthesize(phrase, voice="en_US-ryan-medium"):
    wav = server._synthesize(phrase, voice, "calm")
    with wave.open(io.BytesIO(wav)) as recording:
        rate = recording.getframerate()
        audio = np.frombuffer(recording.readframes(recording.getnframes()), dtype="<i2").astype(np.float32) / 32768
    positions = np.arange(int(len(audio) * 16000 / rate)) * rate / 16000
    audio = np.interp(positions, np.arange(len(audio)), audio).astype(np.float32)
    return audio


def normalized(text):
    return re.sub(r"[^\w\s]", "", text.lower()).split()


def check(label, audio, expected):
    audio = server.louder(np.pad(audio, (8000, 16000)))
    text, _, model = server._transcribe(audio, accurate=True)
    print(f"{label}: {expected!r} -> {text!r} ({model})", flush=True)
    assert normalized(text) == normalized(expected), f"Transcript changed or omitted words: {text!r}"


for phrase in ("What time is it?", "Open the calculator please.", "Tell me an interesting story about the ocean.",
               "Please don't close the browser. Keep it open."):
    check("clear speech", synthesize(phrase), phrase)

phrase = "Open the calculator please."
check("quiet microphone", synthesize(phrase) * 0.015, phrase)
check("British voice", synthesize(phrase, "en_GB-alan-medium"), phrase)
first, second = "Tell me about the ocean.", "Then explain why it is blue."
paused = np.concatenate((synthesize(first), np.zeros(22400, np.float32), synthesize(second)))
check("1.4 second pause", paused, f"{first} {second}")

text, _, _ = server._transcribe(np.zeros(32000, np.float32), accurate=True)
assert not text, "Silence produced a transcript"
noise = np.random.default_rng(7).normal(0, 0.005, 32000).astype(np.float32)
text, _, _ = server._transcribe(noise, accurate=True, hint="Nexa")
assert not text, "Background noise produced a transcript"
print("Offline speech smoke check passed.")
