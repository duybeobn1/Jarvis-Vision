"""Download the official MediaPipe Hand Landmarker model asset."""

from __future__ import annotations

import urllib.request
from pathlib import Path


MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/1/hand_landmarker.task"
)
MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "hand_landmarker.task"


def main() -> None:
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.exists():
        print(f"Model already exists: {MODEL_PATH}")
        return

    print(f"Downloading Hand Landmarker model to {MODEL_PATH}")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print("Download complete.")


if __name__ == "__main__":
    main()
