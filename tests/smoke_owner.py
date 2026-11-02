r"""Exercise the installed speaker model using public English speech fixtures.

Downloads public test audio; uses a temporary profile, never the user's enrollment.
This checks integration, not accuracy on a person's microphone recordings.
Run from the project root: .venv\Scripts\python.exe tests/smoke_owner.py
"""
import io
import sys
import tempfile
from pathlib import Path

import numpy as np
import av
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from owner_voice import OwnerVoice


def recording(url):
    response = httpx.get(url, follow_redirects=True, timeout=60)
    response.raise_for_status()
    with av.open(io.BytesIO(response.content), mode="r") as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        chunks = []
        for frame in container.decode(audio=0):
            chunks.extend(f.to_ndarray().flatten() for f in resampler.resample(frame))
        chunks.extend(f.to_ndarray().flatten() for f in resampler.resample(None))
    return np.concatenate(chunks).astype(np.float32) / 32768


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="nexa-speaker-test-") as temporary:
        owner = OwnerVoice(Path(temporary), server.VOICES_DIR / "speaker")
        speech = owner._speech(recording(
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/Obama.wav"
        ), minimum=34)
        owner.enroll([speech[start * 16000:(start + 8) * 16000] for start in (0, 8, 16)])
        print("Three-sample enrollment passed.", flush=True)
        matched, reason = owner.verify(speech[24 * 16000:34 * 16000])
        print(f"Same speaker, held-out speech: {reason}", flush=True)
        assert matched, "A held-out clip from the enrolled speaker was rejected"
        different = recording("https://raw.githubusercontent.com/openai/whisper/main/tests/jfk.flac")
        matched, reason = owner.verify(different)
        print(f"Different speaker: {reason}", flush=True)
        assert not matched, "A different speaker was accepted"
        owner.remove()
        assert not owner.status()["enrolled"]
    print("Speaker model smoke check passed; your actual voice profile was untouched.")
