"""Stream hand state to the Three.js client over a local WebSocket."""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time
from pathlib import Path
from typing import Any

import cv2
import mediapipe as mp
import websockets

from .main import (
    ANCHOR_FINGERS,
    FINGERTIP_FINGERS,
    HAND_CONNECTIONS,
    create_landmarker,
    is_fist,
    is_number_one,
    pinch_ratio,
    point_3d,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        type=Path,
        default=Path("models/hand_landmarker.task"),
        help="Path to the MediaPipe Hand Landmarker .task model.",
    )
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index.")
    parser.add_argument("--width", type=int, default=1280, help="Requested camera width.")
    parser.add_argument("--height", type=int, default=720, help="Requested camera height.")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port.")
    return parser.parse_args()


def serializable_point(point: tuple[float, float, float]) -> list[float]:
    return [round(value, 6) for value in point]


def encode_camera_frame(frame: Any, max_width: int = 960) -> str:
    """Encode a compact JPEG for the browser's camera background layer."""

    preview = frame
    height, width = frame.shape[:2]
    if width > max_width:
        preview = cv2.resize(frame, (max_width, round(height * max_width / width)))
    success, encoded = cv2.imencode(
        ".jpg",
        preview,
        [cv2.IMWRITE_JPEG_QUALITY, 72],
    )
    if not success:
        return ""
    return base64.b64encode(encoded).decode("ascii")


def build_hand_payload(result: Any) -> dict[str, Any]:
    hands: dict[str, dict[str, Any]] = {}
    anchors: dict[str, list[float]] = {}

    for hand_index, landmarks in enumerate(result.hand_landmarks):
        category = result.handedness[hand_index][0]
        label = str(category.display_name or category.category_name or "Hand").lower()
        wrist = landmarks[0]
        hand_anchors: dict[str, list[float]] = {}
        for landmark_index, finger_name in ANCHOR_FINGERS:
            point = point_3d(landmarks[landmark_index], wrist)
            encoded = serializable_point(point)
            hand_anchors[finger_name] = encoded
            anchors[f"{label}_{finger_name}"] = encoded

        fingertips = {
            finger_name: serializable_point(point_3d(landmarks[landmark_index], wrist))
            for landmark_index, finger_name in FINGERTIP_FINGERS
        }
        all_landmarks = [serializable_point(point_3d(landmark, wrist)) for landmark in landmarks]

        pinch_point = point_3d(
            type(
                "Midpoint",
                (),
                {
                    "x": (landmarks[4].x + landmarks[8].x) / 2,
                    "y": (landmarks[4].y + landmarks[8].y) / 2,
                    "z": (landmarks[4].z + landmarks[8].z) / 2,
                },
            )(),
            wrist,
        )
        hands[label] = {
            "confidence": round(float(category.score or 0.0), 4),
            "fist": is_fist(landmarks),
            "numberOne": is_number_one(landmarks),
            "pinch": pinch_ratio(landmarks) < 0.45,
            "pinchRatio": round(pinch_ratio(landmarks), 6),
            "wrist": serializable_point((float(wrist.x), float(wrist.y), float(wrist.z))),
            "pinchPoint": serializable_point(pinch_point),
            "anchors": hand_anchors,
            "fingertips": fingertips,
            "landmarks": all_landmarks,
        }

    return {
        "hands": hands,
        "anchors": anchors,
        "bothFists": len(hands) == 2 and all(hand["fist"] for hand in hands.values()),
        "bothPinching": len(hands) == 2 and all(hand["pinch"] for hand in hands.values()),
        "handConnections": HAND_CONNECTIONS,
    }


async def run_stream(args: argparse.Namespace) -> None:
    camera = cv2.VideoCapture(args.camera)
    if not camera.isOpened():
        raise RuntimeError(
            f"Could not open camera index {args.camera}. "
            "Check macOS Camera permission for the terminal or Python launcher."
        )
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    clients: set[Any] = set()

    async def client_handler(websocket: Any) -> None:
        clients.add(websocket)
        try:
            await websocket.wait_closed()
        finally:
            clients.discard(websocket)

    async def broadcast(message: str) -> None:
        if not clients:
            return
        results = await asyncio.gather(
            *(client.send(message) for client in tuple(clients)),
            return_exceptions=True,
        )
        for client, result in zip(tuple(clients), results):
            if isinstance(result, Exception):
                clients.discard(client)

    timestamp_ms = -1
    frame_number = 0
    print(f"Jarvis Vision stream listening on ws://localhost:{args.port}")
    print("Open the Three.js client after starting this process.")

    try:
        async with websockets.serve(client_handler, "localhost", args.port):
            with create_landmarker(args.model.expanduser().resolve()) as landmarker:
                while True:
                    captured_at = time.perf_counter()
                    success, frame = camera.read()
                    if not success:
                        raise RuntimeError("Camera frame could not be read.")
                    frame = cv2.flip(frame, 1)
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                    timestamp_ms = max(timestamp_ms + 1, int(captured_at * 1000))
                    result = landmarker.detect_for_video(image, timestamp_ms)
                    payload = build_hand_payload(result)
                    payload.update(
                        {
                            "type": "vision",
                            "timestamp": timestamp_ms,
                            "frame": {"width": frame.shape[1], "height": frame.shape[0]},
                            "cameraFrame": encode_camera_frame(frame) if clients else "",
                            "frameNumber": frame_number,
                        }
                    )
                    frame_number += 1
                    await broadcast(json.dumps(payload, separators=(",", ":")))
                    await asyncio.sleep(0)
    finally:
        camera.release()


def main() -> None:
    args = parse_args()
    try:
        asyncio.run(run_stream(args))
    except KeyboardInterrupt:
        print("Jarvis Vision stream stopped.")


if __name__ == "__main__":
    main()
