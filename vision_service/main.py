"""Phase 1 webcam diagnostic for Jarvis Vision.

Tracks up to two hands with MediaPipe Hand Landmarker, draws the landmarks,
shows handedness/confidence, detects a fist capture pose, experiments with a
six-fingertip box wireframe, and reports capture/inference performance.

Run from the repository root:

    python -m vision_service.main --model models/hand_landmarker.task

Press Q or Escape to quit.
"""

from __future__ import annotations

import argparse
import math
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp


# MediaPipe's 21 hand landmarks. Each tuple is a pair of landmark indices.
HAND_CONNECTIONS: tuple[tuple[int, int], ...] = (
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 4),
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (5, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (9, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (13, 17),
    (17, 18),
    (18, 19),
    (19, 20),
    (0, 17),
)

ANCHOR_FINGERS: tuple[tuple[int, str], ...] = (
    (4, "thumb"),
    (8, "index"),
    (12, "middle"),
)

FINGERTIP_FINGERS: tuple[tuple[int, str], ...] = (
    (4, "thumb"),
    (8, "index"),
    (12, "middle"),
    (16, "ring"),
    (20, "pinky"),
)


class PerformanceCounter:
    """Tracks display FPS over a short rolling window."""

    def __init__(self, window_size: int = 30) -> None:
        self.timestamps: deque[float] = deque(maxlen=window_size)

    def tick(self) -> float:
        now = time.perf_counter()
        self.timestamps.append(now)
        if len(self.timestamps) < 2:
            return 0.0
        elapsed = self.timestamps[-1] - self.timestamps[0]
        return (len(self.timestamps) - 1) / elapsed if elapsed else 0.0


def distance_2d(a: object, b: object) -> float:
    """Return Euclidean distance between two MediaPipe x/y landmarks."""

    return math.hypot(float(a.x) - float(b.x), float(a.y) - float(b.y))


def pinch_ratio(landmarks: list[object]) -> float:
    """Normalize thumb-index distance for object-grab detection."""

    wrist = landmarks[0]
    middle_mcp = landmarks[9]
    palm_length = max(distance_2d(wrist, middle_mcp), 1e-6)
    return distance_2d(landmarks[4], landmarks[8]) / palm_length


def fist_ratio(landmarks: list[object]) -> float:
    """Return the most extended non-thumb finger's palm-relative distance."""

    wrist = landmarks[0]
    middle_mcp = landmarks[9]
    palm_length = max(distance_2d(wrist, middle_mcp), 1e-6)
    fingertip_distances = (
        distance_2d(landmarks[8], wrist),
        distance_2d(landmarks[12], wrist),
        distance_2d(landmarks[16], wrist),
        distance_2d(landmarks[20], wrist),
    )
    return max(fingertip_distances) / palm_length


def is_fist(landmarks: list[object]) -> bool:
    """Detect a closed-fist capture pose with a conservative threshold."""

    return fist_ratio(landmarks) < 1.65


def is_number_one(landmarks: list[object]) -> bool:
    """Detect an index-up, other-fingers-folded number-one pose."""

    wrist = landmarks[0]
    middle_mcp = landmarks[9]
    palm_length = max(distance_2d(wrist, middle_mcp), 1e-6)
    ratios = {
        "thumb": distance_2d(landmarks[4], wrist) / palm_length,
        "index": distance_2d(landmarks[8], wrist) / palm_length,
        "middle": distance_2d(landmarks[12], wrist) / palm_length,
        "ring": distance_2d(landmarks[16], wrist) / palm_length,
        "pinky": distance_2d(landmarks[20], wrist) / palm_length,
    }
    return (
        ratios["index"] > 1.65
        and ratios["middle"] < 1.55
        and ratios["ring"] < 1.55
        and ratios["pinky"] < 1.55
        and ratios["thumb"] < 1.75
    )


def normalized_to_pixel(landmark: object, width: int, height: int) -> tuple[int, int]:
    x = max(0, min(width - 1, int(float(landmark.x) * width)))
    y = max(0, min(height - 1, int(float(landmark.y) * height)))
    return x, y


def draw_hand(
    frame: object,
    landmarks: list[object],
    label: str,
    confidence: float,
) -> tuple[int, int]:
    """Draw one hand and its diagnostics onto an OpenCV frame."""

    height, width = frame.shape[:2]
    points = [normalized_to_pixel(point, width, height) for point in landmarks]
    color = (255, 180, 40)

    for start, end in HAND_CONNECTIONS:
        cv2.line(frame, points[start], points[end], color, 2, cv2.LINE_AA)
    for point in points:
        cv2.circle(frame, point, 4, (245, 245, 245), -1, cv2.LINE_AA)
        cv2.circle(frame, point, 2, color, -1, cv2.LINE_AA)

    thumb = points[4]
    index = points[8]
    midpoint = ((thumb[0] + index[0]) // 2, (thumb[1] + index[1]) // 2)
    cv2.line(frame, thumb, index, color, 1, cv2.LINE_AA)
    cv2.circle(frame, midpoint, 8, color, 2, cv2.LINE_AA)

    wrist_x, wrist_y = points[0]
    cv2.putText(
        frame,
        f"{label}  {confidence:.2f}",
        (wrist_x + 10, max(24, wrist_y - 10)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.58,
        color,
        2,
        cv2.LINE_AA,
    )
    return midpoint


def smooth_vector(
    previous: tuple[float, float, float] | None,
    current: tuple[float, float, float],
    alpha: float = 0.35,
) -> tuple[float, float, float]:
    """Apply exponential smoothing to a normalized 3D landmark."""

    if previous is None:
        return current
    return tuple(
        old + alpha * (new - old) for old, new in zip(previous, current)
    )  # type: ignore[return-value]


def point_3d(landmark: object, wrist: object) -> tuple[float, float, float]:
    """Build a hand-relative 3D point for the six-anchor experiment."""

    # MediaPipe's z is relative to the hand. Adding wrist z gives us a single
    # approximate depth frame for both hands; a depth camera will improve this.
    return (
        float(landmark.x),
        float(landmark.y),
        float(landmark.z) + float(wrist.z),
    )


def add_vectors(
    first: tuple[float, float, float],
    second: tuple[float, float, float],
) -> tuple[float, float, float]:
    return tuple(a + b for a, b in zip(first, second))  # type: ignore[return-value]


def subtract_vectors(
    first: tuple[float, float, float],
    second: tuple[float, float, float],
) -> tuple[float, float, float]:
    return tuple(a - b for a, b in zip(first, second))  # type: ignore[return-value]


def box_vertices_from_six_anchors(
    anchors: dict[str, tuple[float, float, float]],
) -> dict[str, tuple[float, float, float]] | None:
    """Infer eight box vertices from three corresponding points per face."""

    required = {
        "left_thumb",
        "left_index",
        "left_middle",
        "right_thumb",
        "right_index",
        "right_middle",
    }
    if not required.issubset(anchors):
        return None

    # Each hand supplies three corresponding corners. The fourth corner of a
    # rectangular face is A + (B - A) + (C - A) = B + C - A.
    front_a = anchors["left_thumb"]
    front_b = anchors["left_index"]
    front_c = anchors["left_middle"]
    back_a = anchors["right_thumb"]
    back_b = anchors["right_index"]
    back_c = anchors["right_middle"]
    return {
        "front_a": front_a,
        "front_b": front_b,
        "front_c": front_c,
        "front_d": subtract_vectors(add_vectors(front_b, front_c), front_a),
        "back_a": back_a,
        "back_b": back_b,
        "back_c": back_c,
        "back_d": subtract_vectors(add_vectors(back_b, back_c), back_a),
    }


def project_box_point(
    point: tuple[float, float, float],
    average_depth: float,
    width: int,
    height: int,
) -> tuple[int, int]:
    """Project normalized 3D coordinates into the diagnostic image."""

    depth_offset = (point[2] - average_depth) * 180.0
    x = int(round(point[0] * width + depth_offset))
    y = int(round(point[1] * height + depth_offset * 0.45))
    return max(0, min(width - 1, x)), max(0, min(height - 1, y))


def draw_six_anchor_box(
    frame: object,
    anchors: dict[str, tuple[float, float, float]],
    color: tuple[int, int, int] = (210, 100, 255),
    title: str = "6-ANCHOR BOX",
) -> None:
    """Draw the six-anchor box as a smoothed wireframe experiment."""

    vertices = box_vertices_from_six_anchors(anchors)
    if vertices is None:
        return

    height, width = frame.shape[:2]
    average_depth = sum(point[2] for point in vertices.values()) / len(vertices)
    projected = {
        name: project_box_point(point, average_depth, width, height)
        for name, point in vertices.items()
    }
    edges = (
        ("front_a", "front_b"),
        ("front_b", "front_d"),
        ("front_d", "front_c"),
        ("front_c", "front_a"),
        ("back_a", "back_b"),
        ("back_b", "back_d"),
        ("back_d", "back_c"),
        ("back_c", "back_a"),
        ("front_a", "back_a"),
        ("front_b", "back_b"),
        ("front_c", "back_c"),
        ("front_d", "back_d"),
    )
    for start, end in edges:
        cv2.line(frame, projected[start], projected[end], color, 2, cv2.LINE_AA)

    anchor_labels = {
        "front_a": "LT",
        "front_b": "LI",
        "front_c": "LM",
        "back_a": "RT",
        "back_b": "RI",
        "back_c": "RM",
    }
    for name, label in anchor_labels.items():
        point = projected[name]
        cv2.circle(frame, point, 7, color, 2, cv2.LINE_AA)
        cv2.putText(
            frame,
            label,
            (point[0] + 8, point[1] - 8),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            color,
            1,
            cv2.LINE_AA,
        )

    cv2.putText(
        frame,
        title,
        (24, height - 24),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.62,
        color,
        2,
        cv2.LINE_AA,
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
    parser.add_argument(
        "--no-mirror",
        action="store_true",
        help="Do not mirror the camera feed. Mirroring is recommended for interaction.",
    )
    return parser.parse_args()


def create_landmarker(model_path: Path) -> object:
    if not model_path.exists():
        raise FileNotFoundError(
            f"Hand Landmarker model not found at {model_path}. "
            "Run: python scripts/download_hand_model.py"
        )

    # Start with the CPU delegate for a predictable first prototype. GPU/Metal
    # acceleration can be added after the interaction loop is stable; forcing
    # CPU also makes diagnostics work in headless or remote sessions.
    base_options = mp.tasks.BaseOptions(
        model_asset_path=str(model_path),
        delegate=mp.tasks.BaseOptions.Delegate.CPU,
    )
    options = mp.tasks.vision.HandLandmarkerOptions(
        base_options=base_options,
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_hands=2,
        min_hand_detection_confidence=0.5,
        min_hand_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return mp.tasks.vision.HandLandmarker.create_from_options(options)


def run() -> None:
    args = parse_args()
    model_path = args.model.expanduser().resolve()

    camera = cv2.VideoCapture(args.camera)
    if not camera.isOpened():
        raise RuntimeError(
            f"Could not open camera index {args.camera}. "
            "Check the camera connection and macOS camera permission."
        )
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    smoothed_anchors: dict[str, tuple[float, float, float]] = {}
    captured_anchors: dict[str, tuple[float, float, float]] | None = None
    fist_hold_frames = 0
    fist_capture_armed = True
    performance = PerformanceCounter()
    last_timestamp_ms = -1

    print("Jarvis Vision Phase 1 started")
    print("Press Q or Escape in the camera window to quit.")

    try:
        with create_landmarker(model_path) as landmarker:
            while True:
                captured_at = time.perf_counter()
                success, frame = camera.read()
                if not success:
                    print("Camera frame could not be read; stopping.")
                    break

                if not args.no_mirror:
                    frame = cv2.flip(frame, 1)

                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                timestamp_ms = max(last_timestamp_ms + 1, int(captured_at * 1000))
                last_timestamp_ms = timestamp_ms

                inference_started = time.perf_counter()
                result = landmarker.detect_for_video(mp_image, timestamp_ms)
                inference_ms = (time.perf_counter() - inference_started) * 1000

                anchor_points: dict[str, tuple[float, float, float]] = {}
                fist_labels: set[str] = set()
                for hand_index, landmarks in enumerate(result.hand_landmarks):
                    category = result.handedness[hand_index][0]
                    label = str(category.display_name or category.category_name or "Hand")
                    confidence = float(category.score or 0.0)

                    if is_fist(landmarks):
                        fist_labels.add(label)
                    draw_hand(frame, landmarks, label, confidence)
                    wrist = landmarks[0]
                    for landmark_index, finger_name in ANCHOR_FINGERS:
                        anchor_points[f"{label.lower()}_{finger_name}"] = point_3d(
                            landmarks[landmark_index], wrist
                        )

                both_fists = len(fist_labels) == 2
                if both_fists and len(smoothed_anchors) == 6:
                    fist_hold_frames += 1
                    if fist_hold_frames >= 12 and fist_capture_armed:
                        captured_anchors = dict(smoothed_anchors)
                        fist_capture_armed = False
                        print("Captured six-anchor virtual box.")
                else:
                    fist_hold_frames = 0
                    if not both_fists:
                        fist_capture_armed = True

                if len(anchor_points) == 6 and not both_fists:
                    for label, point in anchor_points.items():
                        smoothed_anchors[label] = smooth_vector(
                            smoothed_anchors.get(label), point
                        )
                    draw_six_anchor_box(frame, smoothed_anchors)
                elif not both_fists:
                    smoothed_anchors.clear()

                if captured_anchors is not None:
                    draw_six_anchor_box(
                        frame,
                        captured_anchors,
                        color=(80, 230, 120),
                        title="BOX CAPTURED",
                    )

                fps = performance.tick()
                total_ms = (time.perf_counter() - captured_at) * 1000
                cv2.rectangle(frame, (12, 12), (440, 160), (15, 15, 15), -1)
                cv2.putText(
                    frame,
                    f"Hands: {len(result.hand_landmarks)}/2",
                    (24, 38),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.62,
                    (240, 240, 240),
                    2,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    f"FPS: {fps:5.1f}  inference: {inference_ms:5.1f} ms",
                    (24, 64),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.52,
                    (190, 220, 255),
                    1,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    f"loop: {total_ms:5.1f} ms  |  C: clear  Q/Esc: quit",
                    (24, 88),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (190, 220, 255),
                    1,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    "Six fingertips = preview box",
                    (24, 116),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (190, 220, 255),
                    1,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    "Both fists hold = capture box  |  C: clear",
                    (24, 144),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (190, 220, 255),
                    1,
                    cv2.LINE_AA,
                )

                cv2.imshow("Jarvis Vision - Phase 1", frame)
                key = cv2.waitKey(1) & 0xFF
                if key in (ord("c"), ord("C")):
                    captured_anchors = None
                    print("Cleared captured virtual geometry.")
                if key in (ord("q"), 27):
                    break
    finally:
        camera.release()
        cv2.destroyAllWindows()
        print("Jarvis Vision Phase 1 stopped.")


if __name__ == "__main__":
    run()
