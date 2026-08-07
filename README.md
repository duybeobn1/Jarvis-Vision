# Jarvis Vision

An experimental computer-vision project for building a spatial AI assistant inspired by JARVIS: an assistant that understands voice, hand motion, and a persistent 3D world.

> Project status: planning / first prototype

## Vision

The long-term goal is a multimodal assistant that can see the user and the surrounding workspace, understand natural voice commands, and let the user create and manipulate virtual 3D objects directly with both hands.

The reference interaction is the holographic interface shown in the [Iron Man 2 scene](https://www.youtube.com/watch?v=Ddk9ci6geSs&t=120s), especially from 2:00 to 2:32. The first prototype will use a normal monitor instead of a holographic or AR display, while preserving the interaction model.

## First demo: create a 3D box with both hands

The first successful demonstration should work as follows:

1. The user says: **“Create a box.”**
2. The camera detects both hands and their 3D landmarks.
3. The thumb, index, and middle fingertips of each hand define six anchors.
4. The system infers the remaining two corners of a virtual box.
5. Moving the hands changes the box size, position, and depth in real time.
6. Closing both hands into fists captures the box.
7. The user can say: **“Make it metallic,” “delete it,” “duplicate it,”** or **“make it larger.”**

The box must follow the hands smoothly, without visible jumps, flickering gesture states, or unstable geometry.

## What we are building

This is a continuous spatial interaction system, not a collection of isolated gestures.

```text
Camera + microphone
        ↓
Hand landmarks + speech-to-text
        ↓
World-space tracking and filtering
        ↓
Gesture state machine
        ↓
3D interaction and geometry engine
        ↓
Three-dimensional scene renderer
        ↓
Voice response and visual feedback
```

The system will be divided into these layers:

1. **Capture** – camera frames, microphone input, timestamps, and device health.
2. **Perception** – hand detection, handedness, landmarks, fingertip anchors, fist pose, and confidence.
3. **World coordinates** – convert image coordinates into a stable 3D interaction space.
4. **Motion processing** – smoothing, velocity, acceleration, confidence handling, and lost-hand recovery.
5. **Interaction engine** – create, grab, resize, move, rotate, release, undo, and reset.
6. **Geometry engine** – create and update boxes, spheres, cylinders, curves, and later custom meshes.
7. **Renderer** – display the scene, hand rays, selection state, previews, materials, lighting, and transitions.
8. **Voice and intent** – interpret commands and select the active object or interaction mode.
9. **Assistant layer** – memory, scene understanding, explanations, and future tool/device control.

The low-latency hand-motion loop should remain deterministic. An AI model may interpret “create a box,” but it should not control every frame of the hand movement.

## Proposed prototype architecture

The initial architecture will use a Python vision service and a browser-based 3D renderer:

```text
Python vision service
  OpenCV + MediaPipe + NumPy
        │
        │ landmarks, confidence, gestures, timestamps
        │ WebSocket / JSON
        ▼
Three.js 3D client
  scene, geometry, materials, animation, UI
        ▲
        │ commands and scene events
        │
Voice / intent service
```

This separation makes it possible to replace the camera or tracking model without rewriting the 3D interface.

## Equipment for the demo version

### Minimum equipment

- Laptop or desktop computer
- Built-in or USB webcam capable of 720p/1080p at approximately 30 FPS
- Built-in microphone, USB microphone, or headset
- Stable lighting facing the user
- Clear space in front of the camera for both hands
- Normal monitor; no AR headset is required for the first demo

### Recommended setup

- External 1080p webcam on a small tripod
- Separate USB microphone or headset
- Camera positioned at chest or eye height
- Matte or uncluttered background
- Approximately one metre of space for hand movement
- Consistent front lighting and limited backlighting

### Optional upgrades

- Ultraleap hand-tracking camera for more reliable 3D hand position
- Depth or stereo camera for improved world-space depth
- Dedicated GPU for heavier vision or speech models
- AR headset, projector, or spatial display for a later presentation layer
- Physical objects, LEDs, motors, or smart-home devices for future control demos

The first milestone intentionally avoids expensive hardware. We should prove the interaction model on a webcam before buying depth or AR equipment.

## Software stack

### Core

- Python 3.11 or newer
- OpenCV for camera capture, image processing, calibration, and diagnostics
- MediaPipe Hand Landmarker for real-time hand landmarks
- NumPy for vector and matrix operations
- SciPy for filtering and numerical utilities when needed
- Three.js for the interactive 3D scene
- WebSocket transport between the Python service and the 3D client

### Voice

- Local speech-to-text where practical, such as Whisper or faster-whisper
- Text-to-speech for assistant responses
- A small command parser before introducing an LLM
- An LLM later for flexible natural-language intent, planning, and scene queries

### Development and testing

- Git for version control
- A virtual Python environment
- Browser developer tools for the Three.js client
- Recorded camera sessions for repeatable testing
- Automated tests for coordinate transforms, gesture states, and geometry

## Documents and subjects to read

### Read first

1. [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) – live hand tracking, landmarks, handedness, confidence, and running modes.
2. [MediaPipe Python HandLandmarker API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/HandLandmarker) – implementation details for image, video, and live-stream processing.
3. [OpenCV-Python introduction](https://docs.opencv.org/master/d0/de3/tutorial_py_intro.html) – camera frames, images, NumPy integration, and the Python workflow.
4. [OpenCV video tutorials](https://docs.opencv.org/4.13.0/d6/d00/tutorial_py_root.html) – video capture, tracking, image processing, and camera handling.
5. [OpenCV calibration and 3D reconstruction tutorials](https://docs.opencv.org/5.0/tutorials/tutorials.html) – the concepts needed to move from screen coordinates toward world coordinates.
6. [Three.js fundamentals](https://threejs.org/manual/en/fundamentals.html) – scenes, cameras, renderers, lights, objects, and the scene graph.

### Then study

- 3D vectors, coordinate systems, coordinate transforms, and homogeneous coordinates
- Quaternions and rotation interpolation
- Pinch detection and temporal gesture recognition
- Exponential moving average, One Euro filtering, and Kalman filtering
- Finite-state machines and hysteresis for reliable gesture activation
- Camera calibration, depth ambiguity, stereo vision, and hand occlusion
- WebSocket messaging, timestamps, frame synchronization, and latency measurement
- Procedural geometry and mesh generation
- Scene graphs, object identity, selection, and undo/redo
- Human-computer interaction principles for discoverable, non-fatiguing gestures

### Later research

- Ultraleap hand tracking documentation
- RGB-D and stereo-camera calibration
- SLAM and spatial anchors
- OpenXR and AR display pipelines
- Signed-distance fields, voxels, and implicit surfaces for free-form 3D creation
- Multimodal intent models and agent planning

## Development plan

### Phase 0 – Project foundation

- Create the repository structure and development environment.
- Define coordinate conventions, units, timestamps, and message schemas.
- Add logging, configuration, and a reproducible local run command.
- Decide on a minimum supported operating system and Python version.

### Phase 1 – Camera and single-hand tracking

- Open the webcam and display the live feed.
- Detect one hand and draw landmarks.
- Measure frame rate, inference latency, and confidence.
- Save short recordings for repeatable tests.

**Exit criterion:** stable landmark tracking with visible diagnostics.

### Phase 2 – Two-hand tracking and motion data

- Track two hands and identify left versus right.
- Extract wrist, palm, thumb, index, and middle-fingertip positions.
- Detect a stable two-hand fist capture pose.
- Add smoothing without introducing unacceptable latency.
- Handle temporary hand loss and occlusion.

**Exit criterion:** two hands can move continuously without major jitter.

### Phase 3 – 3D interaction space

- Define a virtual workspace in front of the camera.
- Map hand landmarks into a stable 3D coordinate system.
- Add calibration and a visible origin/grid.
- Show fingertip anchors, box axes, and confidence.

**Exit criterion:** the user can understand where their hands are in the virtual scene.

### Phase 4 – First 3D object

- Render a Three.js scene with a grid and lighting.
- Use six fingertip anchors to infer and preview an eight-vertex box.
- Update position and dimensions at interactive frame rate.
- Add smooth interpolation and fist-based commit behavior.
- Add reset and undo.

**Exit criterion:** the user can create a stable box repeatedly in under ten seconds.

### Phase 5 – Voice commands

- Add push-to-talk first, then a wake phrase if reliable.
- Implement a small explicit command grammar.
- Connect commands to scene actions: create, select, delete, duplicate, resize, material, and reset.
- Add spoken confirmation for ambiguous or destructive actions.

**Exit criterion:** voice selects the operation and hands control its continuous parameters.

### Phase 6 – Spatial manipulation

- Grab and move existing objects.
- Add two-hand scale and rotation.
- Add object snapping, constraints, and axis locks.
- Add visual previews, selection outlines, and interaction affordances.
- Measure end-to-end latency and jitter.

**Exit criterion:** the interaction feels continuous rather than like a sequence of button presses.

### Phase 7 – Beyond primitives

- Create spheres, cylinders, tubes, and curves.
- Turn a drawn 3D path into a smooth tube or surface.
- Add materials, lighting presets, grouping, and duplication.
- Explore free-form volumetric modeling only after primitive creation is reliable.

### Phase 8 – Advanced hardware and presentation

- Compare webcam tracking with depth and dedicated hand-tracking hardware.
- Add spatial anchors and environment understanding.
- Experiment with AR, projection, or another spatial display.
- Prepare a polished JARVIS-style demonstration.

## Initial interaction specification

The first gesture vocabulary should stay small:

| Interaction | Meaning |
|---|---|
| Both hands visible | Enter spatial interaction context |
| Six fingertips visible | Preview the box model |
| Both fists held | Capture/commit the box |
| Open palm | Pause interaction / safety stop |
| Hands apart/together | Change size |
| Midpoint movement | Move object |
| Relative hand rotation | Rotate object |
| Voice command | Choose object, primitive, or mode |

Every gesture should have an activation threshold, a release threshold, a confidence requirement, and a timeout. This prevents accidental actions.

## Success criteria for the demo

- Works with a normal webcam and microphone.
- Tracks both hands in real time under normal indoor lighting.
- Creates a box from hand motion rather than a mouse or keyboard.
- The preview does not jump when creation starts.
- The box follows hand movement smoothly.
- Pinch release commits the object reliably.
- Voice commands can create, reset, delete, and modify the object.
- The scene remains understandable when tracking confidence drops.
- Camera and microphone data stay local during the prototype unless a future feature explicitly requires a remote service.

## Main technical risks

### Depth ambiguity

A single RGB webcam does not measure true physical depth reliably. The first prototype will use an inferred interaction volume. A depth or dedicated hand-tracking camera may be needed for convincing world-space manipulation.

### Occlusion

Two hands can hide one another, especially during crossing or close interaction. The interaction design should avoid requiring precise crossing and should show confidence feedback.

### Jitter and latency

Filtering improves stability but adds delay. We will measure the tradeoff instead of smoothing blindly.

### Gesture ambiguity

The same movement can mean selection, resizing, or navigation. Voice, object context, activation poses, and explicit state transitions will reduce ambiguity.

### User fatigue

Large arm movements are visually impressive but tiring. The system should support small, comfortable gestures and keyboard/voice fallbacks during development.

## Repository layout target

```text
Jarvis Vision/
├── README.md
├── vision_service/
│   ├── capture/
│   ├── tracking/
│   ├── gestures/
│   ├── coordinates/
│   └── main.py
├── scene_client/
│   ├── src/
│   ├── public/
│   └── package.json
├── voice/
├── shared/
│   └── schemas/
├── tests/
├── recordings/
├── docs/
├── configs/
└── .gitignore
```

## First implementation task

Build a minimal camera application that:

1. Opens the webcam.
2. Tracks up to two hands.
3. Draws landmarks and handedness.
4. Calculates six fingertip anchors and fist state.
5. Displays frame rate and latency.
6. Logs a short recording for later testing.

Only after this is stable should we build the 3D box interaction.

## Phase 1 quickstart

The first diagnostic is implemented in `vision_service/main.py`.

```bash
cd "/Users/duybeobn1/Projects/Jarvis Vision"
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/download_hand_model.py
python -m vision_service.main
```

Press **Q** or **Escape** in the camera window to stop it. Use `--camera 1` if the desired webcam is not camera index 0. Use `--no-mirror` when the camera feed should not behave like a mirror.

On macOS, grant Camera access to the terminal or application that launches Python in **System Settings → Privacy & Security → Camera**. The diagnostic currently uses the CPU delegate for predictable first-prototype behavior.

The Phase 1 window reports the number of detected hands, handedness, confidence, fist capture state, FPS, inference time, and total loop time. It is intentionally a measurement tool before it becomes a polished interface.

### Current Phase 1 interaction

The active Phase 1 interaction is the six-anchor box experiment. The old two-pinch rectangle workflow has been removed so the prototype can focus on modeling geometry directly.

### Six-anchor box experiment

The diagnostic also experiments with a six-anchor wireframe: the thumb, index, and middle fingertips of the left hand define three corresponding points on one face, while the same three fingertips on the right hand define the opposite face. The missing fourth point on each rectangular face is inferred from the other three points. This produces an eight-vertex box model from six tracked fingertip anchors. The current overlay uses approximate MediaPipe depth and is a geometry experiment, not yet calibrated world-space 3D.

To capture the six-anchor model, close both hands into fists and hold for roughly half a second. The last stable wireframe is frozen in green as `BOX CAPTURED`. Press **C** to clear captured virtual geometry.

## Guiding principle

Build the system in layers that can be measured independently: perception, motion, interaction, geometry, rendering, and language. The final experience may feel like magic, but each layer must remain observable, testable, and replaceable.
