import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import {
  ballImpactCanTrigger,
  ballPalmPlanarDistance,
  cameraPointToNdc,
  pinchRatioIsEngaged,
} from './selectionMath.js';
import './style.css';

const statusElement = document.querySelector('#status');
const cameraFeedElement = document.querySelector('#camera-feed');
const landmarkCanvas = document.querySelector('#landmark-overlay');
const landmarkContext = landmarkCanvas.getContext('2d');
const zoomModeButton = document.querySelector('#mode-zoom');
const rotationModeButton = document.querySelector('#mode-rotation');
const selectionModeButton = document.querySelector('#mode-selection');
const moveModeButton = document.querySelector('#mode-move');
const ballModeButton = document.querySelector('#mode-ball');
const modelFileInput = document.querySelector('#model-file');
const calibrationButton = document.querySelector('#calibrate-workspace');
const createBoxButton = document.querySelector('#create-box');
const createBallButton = document.querySelector('#create-ball');
const logLinesElement = document.querySelector('#log-lines');
const directionElements = {
  left: document.querySelector('#arrow-left'),
  right: document.querySelector('#arrow-right'),
  up: document.querySelector('#arrow-up'),
  down: document.querySelector('#arrow-down'),
};

const TELEMETRY_SCHEMA_VERSION = 1;
const MAX_TELEMETRY_FRAMES = 3600;
const MAX_TELEMETRY_EVENTS = 1000;
const SESSION_ID = globalThis.crypto?.randomUUID?.() || `session-${Date.now()}`;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050914, 0.035);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 5.4);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.domElement.className = 'scene-canvas';
document.querySelector('#app').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x9bdcff, 0x071020, 1.8));
const keyLight = new THREE.DirectionalLight(0x9bdcff, 4.2);
keyLight.position.set(3, 4, 4);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0x7f55ff, 18, 8);
rimLight.position.set(-3, 1, -2);
scene.add(rimLight);

const grid = new THREE.GridHelper(12, 24, 0x1d6b91, 0x0d263b);
grid.position.y = -1.55;
scene.add(grid);

const worldAxes = new THREE.AxesHelper(1.2);
worldAxes.position.set(-2.8, -1.5, 0);
scene.add(worldAxes);

const boxGroup = new THREE.Group();
boxGroup.visible = false;
scene.add(boxGroup);

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const boxMaterial = new THREE.MeshStandardMaterial({
  color: 0xff55e8,
  emissive: 0x6e0f75,
  emissiveIntensity: 1.3,
  metalness: 0.45,
  roughness: 0.22,
  transparent: true,
  opacity: 0.22,
  side: THREE.DoubleSide,
});
const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
boxGroup.add(boxMesh);

const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xff55e8, transparent: true, opacity: 0.95 });
const boxEdges = new THREE.LineSegments(new THREE.EdgesGeometry(boxGeometry), edgeMaterial);
boxGroup.add(boxEdges);

const vertexMaterial = new THREE.MeshBasicMaterial({ color: 0xffd3ff });
const vertexGeometry = new THREE.SphereGeometry(0.035, 12, 8);
const vertexMarkers = Array.from({ length: 8 }, () => new THREE.Mesh(vertexGeometry, vertexMaterial));
const vertexPositions = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
];
vertexMarkers.forEach((marker, index) => marker.position.fromArray(vertexPositions[index]));
vertexMarkers.forEach((marker) => boxGroup.add(marker));

const sceneObjects = new Map();
let boxSequence = 1;
let ballSequence = 1;
const ballPhysics = new Map();
const selectionHelper = new THREE.BoxHelper(undefined, 0x65ff9b);
selectionHelper.visible = false;
scene.add(selectionHelper);
const selectionCursor = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0x65ff9b }),
);
selectionCursor.visible = false;
scene.add(selectionCursor);

const state = {
  captured: false,
  captureFrames: 0,
  captureArmed: true,
  previewTransform: null,
  baseScale: null,
  interactionMode: 'zoom',
  selectedObjectId: 'box',
  selectedObjectType: 'primitive',
  rightHand: null,
  rightMode: 'idle',
  rotationAnimation: null,
  rotationDirection: null,
  rotationDirectionUntil: 0,
  interactionState: 'preview',
  eventLog: [],
  lastMessage: null,
  telemetry: {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    startedAt: new Date().toISOString(),
    frames: [],
    events: [],
  },
  calibration: {
    enabled: false,
    origin: [0.5, 0.5, 0],
    span: [1, 1, 1],
    calibratedAt: null,
    frameNumber: null,
  },
};

function telemetryTime() {
  return {
    monotonicMs: Math.round(performance.now() * 1000) / 1000,
    wallClock: new Date().toISOString(),
  };
}

function recordTelemetryEvent(type, details = {}) {
  const time = telemetryTime();
  state.telemetry.events.push({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    type,
    ...time,
    frameNumber: state.lastMessage?.frameNumber ?? null,
    interactionMode: state.interactionMode,
    interactionState: state.interactionState,
    rightMode: state.rightMode,
    captured: state.captured,
    calibrationEnabled: state.calibration.enabled,
    selectedObjectId: state.selectedObjectId,
    selectedObjectType: state.selectedObjectType,
    ...details,
  });
  if (state.telemetry.events.length > MAX_TELEMETRY_EVENTS) {
    state.telemetry.events.shift();
  }
}

function recordTelemetryFrame(message) {
  const hands = Object.entries(message.hands || {}).map(([label, hand]) => ({
    label,
    confidence: Number(hand.confidence ?? 0),
    fist: Boolean(hand.fist),
    pinch: Boolean(hand.pinch),
    numberOne: Boolean(hand.numberOne),
  }));
  const frame = {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    type: 'vision_frame',
    frameNumber: message.frameNumber ?? null,
    sourceTimestamp: message.timestamp ?? null,
    receivedAt: new Date().toISOString(),
    handCount: hands.length,
    hands,
    interactionMode: state.interactionMode,
    interactionState: state.interactionState,
    rightMode: state.rightMode,
    captured: state.captured,
    calibrationEnabled: state.calibration.enabled,
    selectedObjectId: state.selectedObjectId,
    selectedObjectType: state.selectedObjectType,
  };
  state.telemetry.frames.push(frame);
  if (state.telemetry.frames.length > MAX_TELEMETRY_FRAMES) {
    state.telemetry.frames.shift();
  }
  return frame;
}

function resolveInteractionState() {
  if (!state.captured) {
    return state.captureFrames > 0 ? 'capture-hold' : 'preview';
  }
  const statesByMode = {
    idle: 'captured-idle',
    ready: `${state.interactionMode}-ready`,
    'selection-ready': 'selection-ready',
    'selection-candidate': 'selection-candidate',
    'selection-held': 'selection-held',
    'move-candidate': 'move-candidate',
    'move-grabbed': 'move-active',
    'move-released': 'move-ready',
    'ball-ready': 'ball-ready',
    'ball-contact': 'ball-contact',
    zoom: 'zoom-active',
    'zoom-min': 'zoom-limit',
    'zoom-max': 'zoom-limit',
    'zoom-stopped': 'zoom-stopped',
    rotate: 'rotation-active',
    'rotate-cooldown': 'rotation-cooldown',
    'rotate-lock': 'rotation-locked',
    'rotation-stopped': 'rotation-stopped',
  };
  return statesByMode[state.rightMode] || 'captured-idle';
}

function syncInteractionState(reason) {
  const nextState = resolveInteractionState();
  if (nextState === state.interactionState) return;
  const previousState = state.interactionState;
  state.interactionState = nextState;
  statusElement.dataset.interactionState = nextState;
  recordTelemetryEvent('state_transition', {
    from: previousState,
    to: nextState,
    reason,
  });
}

function logEvent(message, type = 'ui_event', details = {}) {
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  state.eventLog.unshift({ time, message });
  state.eventLog = state.eventLog.slice(0, 12);
  recordTelemetryEvent(type, { message, ...details });
  logLinesElement.replaceChildren(...state.eventLog.map((entry) => {
    const line = document.createElement('div');
    line.className = 'log-line';
    const timestamp = document.createElement('span');
    timestamp.className = 'log-time';
    timestamp.textContent = `[${entry.time}] `;
    const text = document.createElement('span');
    text.className = 'log-message';
    text.textContent = entry.message;
    line.append(timestamp, text);
    return line;
  }));
}

function downloadTelemetry() {
  const payload = {
    ...state.telemetry,
    endedAt: new Date().toISOString(),
    interactionMode: state.interactionMode,
    interactionState: state.interactionState,
    rightMode: state.rightMode,
    captured: state.captured,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jarvis-vision-${state.telemetry.sessionId}.json`;
  link.click();
  URL.revokeObjectURL(url);
  logEvent('Telemetry log downloaded', 'telemetry_export');
}

globalThis.jarvisVisionTelemetry = {
  getSnapshot: () => JSON.parse(JSON.stringify(state.telemetry)),
  download: downloadTelemetry,
};

function registerSceneObject(id, root, type) {
  const record = { id, root, type };
  root.userData.jarvisObjectId = id;
  root.userData.jarvisObjectType = type;
  sceneObjects.set(id, record);
  return record;
}

function getInteractionRoot() {
  return sceneObjects.get(state.selectedObjectId)?.root || boxGroup;
}

function updateSelectionVisual() {
  const root = getInteractionRoot();
  if (!root?.visible || state.selectedObjectId === 'box' && !state.captured) {
    selectionHelper.visible = false;
    return;
  }
  selectionHelper.setFromObject(root);
  selectionHelper.visible = true;
}

function selectSceneObject(id, reason = 'user-selection') {
  const record = sceneObjects.get(id);
  if (!record) return false;
  state.selectedObjectId = record.id;
  state.selectedObjectType = record.type;
  state.baseScale = record.root.scale.clone();
  state.rightHand = null;
  state.rightMode = 'idle';
  state.rotationAnimation = null;
  clearRotationDirection();
  updateSelectionVisual();
  recordTelemetryEvent('object_selection', {
    objectId: record.id,
    objectType: record.type,
    reason,
  });
  logEvent(`Selected ${record.type}: ${record.id}`, 'object_selection', {
    objectId: record.id,
    objectType: record.type,
    reason,
  });
  return true;
}

registerSceneObject('box', boxGroup, 'primitive');

function clearRotationDirection() {
  Object.values(directionElements).forEach((element) => element.classList.remove('active'));
  state.rotationDirection = null;
  state.rotationDirectionUntil = 0;
}

function showRotationDirection(direction) {
  clearRotationDirection();
  directionElements[direction]?.classList.add('active');
  state.rotationDirection = direction;
  state.rotationDirectionUntil = performance.now() + ROTATION_COOLDOWN_MS;
}

const temp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  c: new THREE.Vector3(),
  d: new THREE.Vector3(),
  xAxis: new THREE.Vector3(),
  yAxis: new THREE.Vector3(),
  zAxis: new THREE.Vector3(),
  center: new THREE.Vector3(),
};

function imageToWorkspace(point) {
  const [originX, originY, originZ] = state.calibration.origin;
  const [spanX, spanY, spanZ] = state.calibration.span;
  return [
    (point[0] - originX) / spanX + 0.5,
    (point[1] - originY) / spanY + 0.5,
    (point[2] - originZ) / spanZ,
  ];
}

function workspaceToScene(point) {
  return new THREE.Vector3(
    (point[0] - 0.5) * 5.6,
    (0.5 - point[1]) * 3.4,
    -point[2] * 4.0,
  );
}

function normalizedToScene(point) {
  return workspaceToScene(imageToWorkspace(point));
}

function calibrateWorkspace() {
  if (state.captured) {
    logEvent('Calibration blocked while box is captured', 'calibration', { result: 'blocked-captured' });
    statusElement.textContent = 'Clear the box before calibrating';
    return;
  }
  const hands = Object.values(state.lastMessage?.hands || {}).filter((hand) => hand?.wrist);
  if (hands.length < 2) {
    logEvent('Calibration needs both hands', 'calibration', { result: 'missing-hands' });
    statusElement.textContent = 'Show both hands, then calibrate';
    return;
  }

  const first = hands[0].wrist;
  const second = hands[1].wrist;
  const spanX = Math.abs(Number(second[0]) - Number(first[0]));
  if (!Number.isFinite(spanX) || spanX < 0.12) {
    logEvent('Calibration needs wider hand separation', 'calibration', { result: 'hands-too-close' });
    statusElement.textContent = 'Move both hands farther apart, then calibrate';
    return;
  }

  const origin = [
    (Number(first[0]) + Number(second[0])) * 0.5,
    (Number(first[1]) + Number(second[1])) * 0.5,
    (Number(first[2]) + Number(second[2])) * 0.5,
  ];
  const spanY = THREE.MathUtils.clamp(spanX * 0.75, 0.35, 0.9);
  state.calibration = {
    enabled: true,
    origin,
    span: [spanX, spanY, 1],
    calibratedAt: new Date().toISOString(),
    frameNumber: state.lastMessage?.frameNumber ?? null,
  };
  recordTelemetryEvent('calibration', {
    result: 'applied',
    origin,
    span: state.calibration.span,
  });
  logEvent('Workspace calibrated', 'calibration', {
    result: 'applied',
    spanX: Number(spanX.toFixed(4)),
    spanY: Number(spanY.toFixed(4)),
  });
  statusElement.textContent = 'Workspace calibrated · show six fingertips';
}

function normalizeImportedModel(root) {
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) throw new Error('The imported model has no visible geometry.');
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDimension) || maxDimension <= 0) {
    throw new Error('The imported model has invalid dimensions.');
  }
  const scale = 2 / maxDimension;
  root.scale.setScalar(scale);
  root.position.copy(center).multiplyScalar(-scale);
  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

async function loadModelFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  let root;
  if (extension === 'glb') {
    const buffer = await file.arrayBuffer();
    const result = await new Promise((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject);
    });
    root = result.scene;
  } else if (extension === 'obj') {
    root = new OBJLoader().parse(await file.text());
  } else {
    throw new Error('Choose a .glb or .obj file.');
  }

  normalizeImportedModel(root);
  const id = `model-${Date.now()}`;
  scene.add(root);
  root.visible = true;
  registerSceneObject(id, root, 'imported');
  boxGroup.visible = false;
  state.captured = true;
  state.captureFrames = 0;
  state.captureArmed = false;
  state.previewTransform = null;
  selectSceneObject(id, 'file-load');
  setCapturedStyle(false);
  logEvent(`Loaded model: ${file.name}`, 'model_load', {
    objectId: id,
    fileName: file.name,
    fileType: extension,
  });
  statusElement.textContent = 'Model loaded · select mode or choose zoom/rotation';
}

function selectObjectAtImagePoint(point, frame) {
  const ndcPoint = cameraPointToNdc(point, window.innerWidth, window.innerHeight, frame);
  const ndc = new THREE.Vector2(ndcPoint.x, ndcPoint.y);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const roots = Array.from(sceneObjects.values())
    .filter((record) => record.root.visible)
    .map((record) => record.root);
  const hit = raycaster.intersectObjects(roots, true)[0];
  if (!hit) {
    logEvent('Selection missed', 'object_selection', {
      result: 'miss',
      ndc: [Number(ndc.x.toFixed(4)), Number(ndc.y.toFixed(4))],
    });
    return false;
  }
  let node = hit.object;
  while (node && !node.userData.jarvisObjectId) node = node.parent;
  return node?.userData.jarvisObjectId
    ? selectSceneObject(node.userData.jarvisObjectId, 'hand-ray')
    : false;
}

function updateSelectionMode(right, frame) {
  const index = right.anchors?.index;
  if (!Array.isArray(index)) {
    selectionCursor.visible = false;
    state.rightMode = 'idle';
    return;
  }
  selectionCursor.position.copy(normalizedToScene(index));
  selectionCursor.visible = true;
  if (!state.rightHand) {
    state.rightHand = { selectionCandidateFrames: 0, selectionArmed: true };
    state.rightMode = 'selection-ready';
    return;
  }
  const control = state.rightHand;
  const rawRatio = Number(right.pinchRatio);
  const hasPinchRatio = Number.isFinite(rawRatio);
  const pinchEngaged = hasPinchRatio
    ? pinchRatioIsEngaged(rawRatio, SELECTION_PINCH_ENGAGE_RATIO)
    : Boolean(right.pinch);
  const pinchReleased = hasPinchRatio
    ? rawRatio > SELECTION_PINCH_RELEASE_RATIO
    : !right.pinch;
  if (!pinchEngaged) {
    control.selectionCandidateFrames = 0;
    if (pinchReleased) control.selectionArmed = true;
    state.rightMode = control.selectionArmed ? 'selection-ready' : 'selection-held';
    return;
  }
  if (!control.selectionArmed) {
    state.rightMode = 'selection-held';
    return;
  }
  control.selectionCandidateFrames += 1;
  state.rightMode = 'selection-candidate';
  if (control.selectionCandidateFrames >= PINCH_CONFIRM_FRAMES) {
    const selected = selectObjectAtImagePoint(index, frame);
    logEvent(selected ? 'Selection confirmed' : 'Selection missed · move index cursor onto object', 'object_selection', {
      result: selected ? 'hit' : 'miss',
      pinchRatio: hasPinchRatio ? rawRatio : null,
    });
    control.selectionArmed = false;
    state.rightHand = control;
    state.rightMode = 'selection-held';
  }
}

function updateMoveMode(right) {
  const root = getInteractionRoot();
  const wrist = right.wrist;
  if (!root?.visible || !Array.isArray(wrist)) {
    state.rightHand = null;
    state.rightMode = 'idle';
    return;
  }

  const trackedPosition = normalizedToScene(wrist);
  const rawRatio = Number(right.pinchRatio ?? 1);
  if (!state.rightHand) {
    state.rightHand = {
      moveActive: false,
      movePinchRatio: rawRatio,
      moveCandidateFrames: 0,
      moveHandAnchor: trackedPosition.clone(),
      moveObjectAnchor: root.position.clone(),
    };
    state.rightMode = 'ready';
    return;
  }

  const control = state.rightHand;
  control.movePinchRatio = THREE.MathUtils.lerp(
    control.movePinchRatio,
    rawRatio,
    PINCH_SMOOTHING,
  );
  const ratio = control.movePinchRatio;

  if (!control.moveActive) {
    if (ratio < MOVE_PINCH_ENGAGE_RATIO) {
      control.moveCandidateFrames += 1;
      state.rightMode = 'move-candidate';
      if (control.moveCandidateFrames >= PINCH_CONFIRM_FRAMES) {
        control.moveActive = true;
        control.moveHandAnchor.copy(trackedPosition);
        control.moveObjectAnchor.copy(root.position);
        logEvent('Move grab engaged');
      }
    } else {
      control.moveCandidateFrames = 0;
      state.rightMode = 'ready';
    }
    return;
  }

  if (right.fist || ratio > MOVE_PINCH_RELEASE_RATIO) {
    control.moveActive = false;
    control.moveCandidateFrames = 0;
    control.moveObjectAnchor.copy(root.position);
    logEvent(right.fist ? 'Move stopped by fist' : 'Move released');
    state.rightMode = 'move-released';
    return;
  }

  const targetPosition = control.moveObjectAnchor.clone().add(
    trackedPosition.clone().sub(control.moveHandAnchor),
  );
  applyTransform({
    position: targetPosition,
    quaternion: root.quaternion.clone(),
    scale: root.scale.clone(),
  }, 0.36);
  state.rightMode = 'move-grabbed';
}

function palmCenterFromHand(hand) {
  const landmarks = hand.landmarks || [];
  const palmIndices = [0, 5, 9, 13, 17];
  const points = palmIndices.map((index) => landmarks[index]);
  if (!points.every((point) => Array.isArray(point) && point.length === 3)) {
    return Array.isArray(hand.wrist) ? hand.wrist : null;
  }
  const center = points.reduce(
    (sum, point) => sum.add(new THREE.Vector3(point[0], point[1], point[2])),
    new THREE.Vector3(),
  ).multiplyScalar(1 / points.length);
  return [center.x, center.y, center.z];
}

function updateBallMode(right) {
  const root = getInteractionRoot();
  const physics = ballPhysics.get(state.selectedObjectId);
  if (!root?.visible || root.userData.jarvisObjectType !== 'ball' || !physics) {
    state.rightMode = 'idle';
    return;
  }

  const palmPoint = palmCenterFromHand(right);
  if (!palmPoint) {
    state.rightMode = 'idle';
    return;
  }
  const handPosition = normalizedToScene(palmPoint);
  const now = performance.now();
  if (!physics.lastHandPosition) {
    physics.lastHandPosition = handPosition;
    physics.lastHandTime = now;
    state.rightMode = 'ball-ready';
    return;
  }

  const deltaSeconds = THREE.MathUtils.clamp((now - physics.lastHandTime) / 1000, 0.001, 0.1);
  const handVelocity = handPosition.clone()
    .sub(physics.lastHandPosition)
    .multiplyScalar(1 / deltaSeconds);
  physics.lastHandPosition.copy(handPosition);
  physics.lastHandTime = now;

  const radius = BALL_RADIUS * root.scale.x;
  const contactDistance = radius + BALL_HAND_RADIUS;
  const distance = ballPalmPlanarDistance(
    [root.position.x, root.position.y, root.position.z],
    [handPosition.x, handPosition.y, handPosition.z],
  );
  const handSpeed = handVelocity.length();
  const separated = distance > contactDistance + 0.08;
  if (handSpeed < BALL_HAND_SETTLE_SPEED) physics.motionReset = true;
  if (separated) {
    physics.contacting = false;
    physics.motionReset = false;
  }

  const canImpact = ballImpactCanTrigger({
    contacting: physics.contacting,
    motionReset: physics.motionReset,
    separated,
    handSpeed,
    speedThreshold: BALL_TAP_SPEED_THRESHOLD,
  });
  if (distance <= contactDistance && now >= physics.contactCooldownUntil && canImpact) {
    if (!physics.contacting || physics.motionReset) {
      if (handSpeed >= BALL_TAP_SPEED_THRESHOLD) {
        const launchVelocity = handVelocity.clone();
        launchVelocity.y = Math.max(launchVelocity.y, 0.65);
        launchVelocity.z *= 0.4;
        physics.velocity.copy(
          launchVelocity.normalize().multiplyScalar(
            THREE.MathUtils.clamp(handSpeed * 1.45 + 1.5, 2.5, 6.8),
          ),
        );
        logEvent('Ball tapped · launched', 'ball_interaction', {
          objectId: state.selectedObjectId,
          handSpeed: Number(handSpeed.toFixed(3)),
        });
      } else {
        physics.velocity.set(handVelocity.x * 0.35, 2.8, handVelocity.z * 0.35);
        logEvent('Ball bounced from palm', 'ball_interaction', {
          objectId: state.selectedObjectId,
        });
      }
      physics.contactCooldownUntil = now + BALL_CONTACT_COOLDOWN_MS;
      physics.motionReset = false;
    }
    physics.contacting = true;
    state.rightMode = 'ball-contact';
    return;
  }

  state.rightMode = 'ball-ready';
}

function armBoxCreation() {
  state.selectedObjectId = 'box';
  state.selectedObjectType = 'primitive';
  state.captured = false;
  state.captureFrames = 0;
  state.captureArmed = true;
  state.previewTransform = null;
  state.baseScale = null;
  state.rightHand = null;
  state.rightMode = 'idle';
  state.rotationAnimation = null;
  boxGroup.visible = false;
  selectionHelper.visible = false;
  setCapturedStyle(false);
  clearRotationDirection();
  syncInteractionState('create-box-armed');
  logEvent('Create Box armed', 'scene_action', { action: 'create-box-armed' });
  statusElement.textContent = 'Create Box armed · show six fingertips, then hold both fists';
}

function capturePreviewBox() {
  const id = `box-${boxSequence}`;
  boxSequence += 1;
  const createdBox = clonePrimitiveBox();
  createdBox.visible = true;
  scene.add(createdBox);
  registerSceneObject(id, createdBox, 'primitive');
  setPrimitiveBoxStyle(createdBox, true);
  boxGroup.visible = false;
  state.captured = true;
  state.captureArmed = false;
  state.previewTransform = null;
  state.rightMode = 'idle';
  state.rotationAnimation = null;
  clearRotationDirection();
  selectSceneObject(id, 'box-capture');
  setCapturedStyle(false);
  logEvent(`Box captured: ${id}`, 'scene_action', {
    action: 'box-capture',
    objectId: id,
  });
  statusElement.textContent = `${id} created · choose Selection, Move, Zoom, or Rotation`;
}

function createBall() {
  const id = `ball-${ballSequence}`;
  ballSequence += 1;
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x38cfff,
    emissive: 0x064e72,
    emissiveIntensity: 1.25,
    metalness: 0.35,
    roughness: 0.18,
  });
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 24),
    material,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(BALL_RADIUS * 1.08, 0.012, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x9ceeff, transparent: true, opacity: 0.78 }),
  );
  halo.rotation.x = Math.PI / 2;
  root.add(halo);

  root.position.set(0, grid.position.y + BALL_RADIUS, 0);
  scene.add(root);
  registerSceneObject(id, root, 'ball');
  ballPhysics.set(id, {
    velocity: new THREE.Vector3(),
    lastHandPosition: null,
    lastHandTime: 0,
    contacting: false,
    motionReset: false,
    contactCooldownUntil: 0,
  });
  state.captured = true;
  state.captureArmed = false;
  state.previewTransform = null;
  state.baseScale = null;
  boxGroup.visible = false;
  selectSceneObject(id, 'ball-create');
  setInteractionMode('ball');
  logEvent(`Ball created: ${id}`, 'scene_action', {
    action: 'ball-create',
    objectId: id,
  });
  statusElement.textContent = `${id} created · use Ball Play to bounce or tap-launch it`;
}

function clearScene() {
  for (const [id, record] of sceneObjects) {
    if (id === 'box') continue;
    scene.remove(record.root);
    ballPhysics.delete(id);
    sceneObjects.delete(id);
  }
  state.selectedObjectId = 'box';
  state.selectedObjectType = 'primitive';
  state.captured = false;
  state.captureFrames = 0;
  state.captureArmed = true;
  state.previewTransform = null;
  state.baseScale = null;
  state.rightHand = null;
  state.rightMode = 'idle';
  state.rotationAnimation = null;
  selectionCursor.visible = false;
  selectionHelper.visible = false;
  boxGroup.visible = false;
  setCapturedStyle(false);
  clearRotationDirection();
  syncInteractionState('scene-cleared');
  logEvent('Scene cleared', 'scene_action', { action: 'clear' });
  statusElement.textContent = 'Cleared · show six fingertips to preview';
}

function transformFromAnchors(anchors) {
  const names = ['left_thumb', 'left_index', 'left_middle', 'right_thumb', 'right_index', 'right_middle'];
  if (!names.every((name) => Array.isArray(anchors[name]))) return null;

  temp.a.copy(normalizedToScene(anchors.left_thumb));
  temp.b.copy(normalizedToScene(anchors.left_index));
  temp.c.copy(normalizedToScene(anchors.left_middle));
  temp.d.copy(normalizedToScene(anchors.right_thumb));

  const rightIndex = normalizedToScene(anchors.right_index);
  const rightMiddle = normalizedToScene(anchors.right_middle);
  const leftWidth = temp.b.clone().sub(temp.a);
  const rightWidth = rightIndex.clone().sub(temp.d);
  const leftHeight = temp.c.clone().sub(temp.a);
  const rightHeight = rightMiddle.clone().sub(temp.d);
  const rawX = leftWidth.clone().add(rightWidth).multiplyScalar(0.5);
  const rawY = leftHeight.clone().add(rightHeight).multiplyScalar(0.5);
  const xAxis = rawX.normalize();
  const yAxis = rawY.clone().sub(xAxis.clone().multiplyScalar(rawY.dot(xAxis)));
  const height = Math.max((leftHeight.length() + rightHeight.length()) * 0.5, 0.15);
  yAxis.normalize();
  const zAxis = temp.zAxis.copy(xAxis).cross(yAxis).normalize();

  const depthVector = temp.d.clone().sub(temp.a)
    .add(rightIndex.clone().sub(temp.b))
    .add(rightMiddle.clone().sub(temp.c))
    .multiplyScalar(1 / 3);
  if (depthVector.dot(zAxis) < 0) zAxis.negate();
  const depth = THREE.MathUtils.clamp(Math.max(Math.abs(depthVector.dot(zAxis)), depthVector.length() * 0.18), 0.35, 2.4);
  const width = Math.max((Math.abs(leftWidth.dot(xAxis)) + Math.abs(rightWidth.dot(xAxis))) * 0.5, 0.25);

  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
  const center = temp.center.copy(temp.a)
    .add(temp.b).add(temp.c).add(temp.d).add(rightIndex).add(rightMiddle).multiplyScalar(1 / 6);

  return {
    position: center.clone(),
    quaternion,
    scale: new THREE.Vector3(Math.max(width, 0.25), height, depth),
  };
}

function applyTransform(transform, smoothing = 0.22) {
  if (!transform) return;
  const target = getInteractionRoot();
  if (!target.visible) {
    target.position.copy(transform.position);
    target.quaternion.copy(transform.quaternion);
    target.scale.copy(transform.scale);
  } else {
    target.position.lerp(transform.position, smoothing);
    target.quaternion.slerp(transform.quaternion, smoothing);
    target.scale.lerp(transform.scale, smoothing);
  }
  target.visible = true;
  updateSelectionVisual();
}

function setPrimitiveBoxStyle(root, captured) {
  root.traverse((node) => {
    if (!node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (material.color) {
        material.color.setHex(
          node.isLineSegments
            ? (captured ? 0x65ff9b : 0xff55e8)
            : node.geometry?.type === 'SphereGeometry'
              ? (captured ? 0xd0ffe0 : 0xffd3ff)
              : (captured ? 0x65ff9b : 0xff55e8),
        );
      }
      if (material.emissive) material.emissive.setHex(captured ? 0x0a6b45 : 0x6e0f75);
    });
  });
}

function setCapturedStyle(captured) {
  setPrimitiveBoxStyle(boxGroup, captured);
}

function clonePrimitiveBox() {
  const clone = boxGroup.clone(true);
  clone.traverse((node) => {
    if (!node.material) return;
    node.material = Array.isArray(node.material)
      ? node.material.map((material) => material.clone())
      : node.material.clone();
  });
  return clone;
}

function setInteractionMode(mode) {
  state.interactionMode = mode;
  state.rightHand = null;
  state.rightMode = 'idle';
  state.rotationAnimation = null;
  clearRotationDirection();
  zoomModeButton.classList.toggle('active', mode === 'zoom');
  rotationModeButton.classList.toggle('active', mode === 'rotation');
  selectionModeButton.classList.toggle('active', mode === 'selection');
  moveModeButton.classList.toggle('active', mode === 'move');
  ballModeButton.classList.toggle('active', mode === 'ball');
  logEvent(
    mode === 'zoom'
      ? 'Mode: Zoom / Dezoom'
      : mode === 'rotation'
        ? 'Mode: Rotation'
        : mode === 'selection'
          ? 'Mode: Selection'
          : mode === 'move'
            ? 'Mode: Move'
            : 'Mode: Ball Play',
  );
  syncInteractionState('mode-selected');
  if (state.captured) {
    statusElement.textContent = mode === 'zoom'
      ? 'Zoom mode · pinch with the right hand'
      : mode === 'rotation'
        ? 'Rotation mode · wave with the right hand'
        : mode === 'selection'
          ? 'Selection mode · pinch the right index cursor'
          : mode === 'move'
            ? 'Move mode · pinch and drag the selected model'
            : 'Ball Play · move your palm toward the ball';
  }
}

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const PINCH_ENGAGE_RATIO = 0.52;
const PINCH_RELEASE_RATIO = 0.78;
const SELECTION_PINCH_ENGAGE_RATIO = 0.58;
const SELECTION_PINCH_RELEASE_RATIO = 0.82;
const MOVE_PINCH_ENGAGE_RATIO = 0.58;
const MOVE_PINCH_RELEASE_RATIO = 0.82;
const PINCH_CONFIRM_FRAMES = 5;
const PINCH_SMOOTHING = 0.22;
const MIN_ZOOM_FACTOR = 0.35;
const MAX_ZOOM_FACTOR = 3.0;
const FINGERTIP_SWIPE_TRIGGER_DISTANCE = 0.48;
const FINGERTIP_SWIPE_RESET_DISTANCE = 0.16;
const FINGERTIP_POSITION_SMOOTHING = 0.28;
const ROTATION_COOLDOWN_MS = 1000;
const ROTATION_DURATION_MS = 360;
const BALL_RADIUS = 0.34;
const BALL_GRAVITY = 7.4;
const BALL_RESTITUTION = 0.72;
const BALL_HAND_RADIUS = 0.28;
const BALL_TAP_SPEED_THRESHOLD = 1.15;
const BALL_HAND_SETTLE_SPEED = 0.42;
const BALL_CONTACT_COOLDOWN_MS = 180;

function zoomBounds() {
  const base = state.baseScale || getInteractionRoot().scale;
  return {
    min: base.clone().multiplyScalar(MIN_ZOOM_FACTOR),
    max: base.clone().multiplyScalar(MAX_ZOOM_FACTOR),
  };
}

function clampScale(scale) {
  const bounds = zoomBounds();
  return new THREE.Vector3(
    THREE.MathUtils.clamp(scale.x, bounds.min.x, bounds.max.x),
    THREE.MathUtils.clamp(scale.y, bounds.min.y, bounds.max.y),
    THREE.MathUtils.clamp(scale.z, bounds.min.z, bounds.max.z),
  );
}

function startSmoothRotation(axis, direction) {
  const rotation = new THREE.Quaternion().setFromAxisAngle(axis, direction * Math.PI / 2);
  startSmoothRotationTo(getInteractionRoot().quaternion.clone().premultiply(rotation));
}

function startSmoothRotationTo(targetQuaternion) {
  const target = getInteractionRoot();
  state.rotationAnimation = {
    from: target.quaternion.clone(),
    target: targetQuaternion.clone(),
    startedAt: performance.now(),
  };
}

function updateCameraFrame(encodedFrame) {
  if (encodedFrame) {
    cameraFeedElement.src = `data:image/jpeg;base64,${encodedFrame}`;
  }
}

const FINGERTIP_INDICES = new Set([4, 8, 12, 16, 20]);

function resizeLandmarkCanvas() {
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  landmarkCanvas.width = Math.round(window.innerWidth * pixelRatio);
  landmarkCanvas.height = Math.round(window.innerHeight * pixelRatio);
  landmarkCanvas.style.width = `${window.innerWidth}px`;
  landmarkCanvas.style.height = `${window.innerHeight}px`;
  landmarkContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function cameraToViewport(point, frame) {
  const frameWidth = frame?.width || window.innerWidth;
  const frameHeight = frame?.height || window.innerHeight;
  const coverScale = Math.max(window.innerWidth / frameWidth, window.innerHeight / frameHeight);
  const drawnWidth = frameWidth * coverScale;
  const drawnHeight = frameHeight * coverScale;
  return {
    x: point[0] * drawnWidth + (window.innerWidth - drawnWidth) / 2,
    y: point[1] * drawnHeight + (window.innerHeight - drawnHeight) / 2,
  };
}

function drawLandmarks(message) {
  landmarkContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const connections = message.handConnections || [];
  const handEntries = Object.entries(message.hands || {});
  handEntries.forEach(([label, hand]) => {
    const points = hand.landmarks || [];
    if (points.length !== 21) return;
    const color = label === 'right' ? '#ffad70' : '#71e6ff';
    const viewportPoints = points.map((point) => cameraToViewport(point, message.frame));

    landmarkContext.strokeStyle = color;
    landmarkContext.globalAlpha = 0.72;
    landmarkContext.lineWidth = 1.5;
    connections.forEach(([start, end]) => {
      const first = viewportPoints[start];
      const second = viewportPoints[end];
      if (!first || !second) return;
      landmarkContext.beginPath();
      landmarkContext.moveTo(first.x, first.y);
      landmarkContext.lineTo(second.x, second.y);
      landmarkContext.stroke();
    });

    viewportPoints.forEach((point, index) => {
      const fingertip = FINGERTIP_INDICES.has(index);
      landmarkContext.globalAlpha = 1;
      landmarkContext.fillStyle = fingertip ? '#ffffff' : color;
      landmarkContext.beginPath();
      landmarkContext.arc(point.x, point.y, fingertip ? 5 : 2.5, 0, Math.PI * 2);
      landmarkContext.fill();
      if (fingertip) {
        landmarkContext.strokeStyle = color;
        landmarkContext.lineWidth = 1.5;
        landmarkContext.stroke();
      }
    });

    const wrist = viewportPoints[0];
    if (wrist) {
      landmarkContext.fillStyle = color;
      landmarkContext.font = '12px ui-monospace, monospace';
      landmarkContext.fillText(label.toUpperCase(), wrist.x + 8, wrist.y - 8);
    }
  });
  landmarkContext.globalAlpha = 1;
}

const ROTATION_FINGERTIPS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function fiveFingertipCentroid(hand) {
  const points = ROTATION_FINGERTIPS.map((name) => hand.fingertips?.[name]);
  if (!points.every((point) => Array.isArray(point) && point.length === 3)) return null;
  const average = points.reduce(
    (sum, point) => sum.add(new THREE.Vector3(point[0], point[1], point[2])),
    new THREE.Vector3(),
  ).multiplyScalar(1 / points.length);
  return normalizedToScene([average.x, average.y, average.z]);
}

function updateRightHand(message) {
  const right = message.hands?.right;
  if (!right?.wrist) {
    const physics = ballPhysics.get(state.selectedObjectId);
    if (physics) {
      physics.lastHandPosition = null;
      physics.lastHandTime = 0;
      physics.contacting = false;
      physics.motionReset = false;
    }
    state.rightHand = null;
    state.rightMode = 'idle';
    return;
  }

  if (state.interactionMode === 'selection') {
    updateSelectionMode(right, message.frame);
    return;
  }

  if (state.interactionMode === 'move') {
    updateMoveMode(right);
    return;
  }

  if (state.interactionMode === 'ball') {
    updateBallMode(right);
    return;
  }

  const trackedPosition = state.interactionMode === 'rotation'
    ? fiveFingertipCentroid(right)
    : normalizedToScene(right.wrist);
  if (!trackedPosition) {
    state.rightHand = null;
    state.rightMode = 'idle';
    return;
  }
  const rawRatio = Number(right.pinchRatio ?? 1);
  if (!state.rightHand) {
    state.rightHand = {
      zoomActive: false,
      zoomBlocked: false,
      pinchRatio: rawRatio,
      pinchCandidateFrames: 0,
      zoomRatio: rawRatio,
      zoomScale: getInteractionRoot().scale.clone(),
      lastZoomDirection: 0,
      zoomLimitLogged: null,
      wasZooming: false,
      gesturePosition: trackedPosition.clone(),
      gestureHome: trackedPosition.clone(),
      gestureNeedsReset: false,
      fistResetHandled: false,
      rotationCooldownUntil: 0,
    };
    state.rightMode = 'ready';
    return;
  }

  const control = state.rightHand;
  let position = trackedPosition;
  if (state.interactionMode === 'rotation') {
    control.gesturePosition.lerp(trackedPosition, FINGERTIP_POSITION_SMOOTHING);
    position = control.gesturePosition.clone();
  }
  control.pinchRatio = THREE.MathUtils.lerp(control.pinchRatio, rawRatio, PINCH_SMOOTHING);
  const ratio = control.pinchRatio;

  if (state.interactionMode === 'zoom') {
    if (right.fist) {
      if (!control.zoomBlocked) logEvent('Zoom stopped by fist');
      control.zoomActive = false;
      control.pinchCandidateFrames = 0;
      control.wasZooming = false;
      control.zoomBlocked = true;
      control.gestureHome.copy(position);
      control.gestureNeedsReset = false;
      state.rightMode = 'zoom-stopped';
      return;
    }
    if (control.zoomBlocked) {
      // Require the fist to open before accepting a new pinch.
      control.zoomBlocked = false;
      control.pinchCandidateFrames = 0;
      control.pinchRatio = rawRatio;
      state.rightMode = 'ready';
      return;
    }
    if (!control.zoomActive && ratio < PINCH_ENGAGE_RATIO) {
      control.pinchCandidateFrames += 1;
      if (control.pinchCandidateFrames >= PINCH_CONFIRM_FRAMES) {
        control.zoomActive = true;
        control.zoomRatio = ratio;
        control.zoomScale = clampScale(getInteractionRoot().scale);
        control.lastZoomDirection = 0;
        control.zoomLimitLogged = null;
        control.wasZooming = true;
        control.gestureHome.copy(position);
        control.gestureNeedsReset = false;
        logEvent('Zoom pinch engaged');
      }
    } else if (!control.zoomActive) {
      control.pinchCandidateFrames = 0;
    }
    if (control.zoomActive && ratio > PINCH_RELEASE_RATIO) {
      control.zoomActive = false;
      control.pinchCandidateFrames = 0;
      control.wasZooming = true;
    }

    if (control.zoomActive) {
      const scaleFactor = THREE.MathUtils.clamp(
        1 + (ratio - control.zoomRatio) * 2.4,
        0.45,
        2.8,
      );
      const targetScale = clampScale(control.zoomScale.clone().multiplyScalar(scaleFactor));
      const bounds = zoomBounds();
      const zoomLimit = targetScale.x <= bounds.min.x + 0.001
        ? 'min'
        : targetScale.x >= bounds.max.x - 0.001
          ? 'max'
          : null;
      const atLimit = Boolean(zoomLimit);
      const zoomDirection = Math.sign(ratio - control.zoomRatio);
      if (zoomDirection && zoomDirection !== control.lastZoomDirection) {
        logEvent(zoomDirection > 0 ? 'Zoomed in' : 'Dezoomed');
        control.lastZoomDirection = zoomDirection;
      }
      if (zoomLimit && zoomLimit !== control.zoomLimitLogged) {
        logEvent(zoomLimit === 'max' ? 'Zoom maximum reached' : 'Zoom minimum reached');
        control.zoomLimitLogged = zoomLimit;
      }
      if (!zoomLimit) control.zoomLimitLogged = null;
      applyTransform({
        position: getInteractionRoot().position.clone(),
        quaternion: getInteractionRoot().quaternion.clone(),
        scale: targetScale,
      }, atLimit ? 1 : 0.32);
      state.rightMode = zoomLimit === 'min'
      ? 'zoom-min'
        : zoomLimit === 'max'
          ? 'zoom-max'
          : 'zoom';
      return;
    }

    if (control.wasZooming) {
      control.wasZooming = false;
      control.gestureHome.copy(position);
      control.gestureNeedsReset = false;
      logEvent('Zoom pinch released');
      state.rightMode = 'ready';
      return;
    }

    // Zoom mode is exclusive: never fall through into rotation handling.
    state.rightMode = 'ready';
    return;
  } else {
    // Rotation mode deliberately ignores pinch recognition.
    control.zoomActive = false;
    control.pinchCandidateFrames = 0;
    control.wasZooming = false;
  }

  if (right.fist) {
    if (state.interactionMode === 'rotation') {
      if (!control.fistResetHandled) {
        control.fistResetHandled = true;
        state.rotationAnimation = null;
        clearRotationDirection();
        logEvent('Rotation stopped by fist');
      }
      control.gestureHome.copy(position);
      control.gestureNeedsReset = false;
      state.rightMode = 'rotation-stopped';
      return;
    }
    control.gestureHome.copy(position);
    control.gestureNeedsReset = false;
    state.rightMode = 'ready';
    return;
  }

  if (control.fistResetHandled) {
    control.fistResetHandled = false;
    control.gestureHome.copy(position);
    control.gestureNeedsReset = false;
    state.rightMode = 'ready';
    return;
  }

  if (performance.now() < control.rotationCooldownUntil) {
    state.rightMode = 'rotate-cooldown';
    return;
  }

  const swipeOffset = position.clone().sub(control.gestureHome);
  if (control.gestureNeedsReset) {
    if (position.distanceTo(control.gestureHome) < FINGERTIP_SWIPE_RESET_DISTANCE) {
      control.gestureNeedsReset = false;
      state.rightMode = 'ready';
    } else {
      state.rightMode = 'rotate-lock';
    }
    return;
  }

  if (Math.max(Math.abs(swipeOffset.x), Math.abs(swipeOffset.y)) >= FINGERTIP_SWIPE_TRIGGER_DISTANCE) {
    if (Math.abs(swipeOffset.x) >= Math.abs(swipeOffset.y)) {
      const direction = Math.sign(swipeOffset.x);
      startSmoothRotation(WORLD_Y, direction);
      showRotationDirection(direction > 0 ? 'right' : 'left');
      logEvent(direction > 0 ? 'Rotation right 90°' : 'Rotation left 90°');
    } else {
      const direction = Math.sign(swipeOffset.y);
      startSmoothRotation(WORLD_X, direction);
      showRotationDirection(direction > 0 ? 'up' : 'down');
      logEvent(direction > 0 ? 'Rotation up 90°' : 'Rotation down 90°');
    }
    control.gestureNeedsReset = true;
    control.rotationCooldownUntil = performance.now() + ROTATION_COOLDOWN_MS;
    state.rightMode = 'rotate';
  } else {
    state.rightMode = 'ready';
  }
}

function processVision(message) {
  state.lastMessage = message;
  const frameRecord = recordTelemetryFrame(message);
  updateCameraFrame(message.cameraFrame);
  drawLandmarks(message);
  const currentTransform = transformFromAnchors(message.anchors || {});
  const bothFists = Boolean(message.bothFists);

  if (!state.captured) {
    if (!bothFists && currentTransform) {
      state.previewTransform = currentTransform;
      applyTransform(currentTransform);
      setCapturedStyle(false);
    }
    if (bothFists && state.previewTransform) {
      state.captureFrames += 1;
      if (state.captureFrames >= 12 && state.captureArmed) {
        capturePreviewBox();
      }
    } else if (!bothFists) {
      state.captureFrames = 0;
      state.captureArmed = true;
    }
  } else {
    updateRightHand(message);
  }

  syncInteractionState('vision-frame');
  frameRecord.interactionMode = state.interactionMode;
  frameRecord.interactionState = state.interactionState;
  frameRecord.rightMode = state.rightMode;
  frameRecord.captured = state.captured;

  const handCount = Object.keys(message.hands || {}).length;
  if (!state.captured) {
    statusElement.textContent = bothFists
      ? `Hold fists to capture · ${state.captureFrames}/12`
      : `Preview · ${handCount}/2 hands · six anchors`;
  } else if (!message.hands?.right) {
    const selectedLabel = state.selectedObjectType === 'imported'
      ? 'Model selected'
      : state.selectedObjectType === 'ball'
        ? 'Ball selected'
        : 'Box captured';
    statusElement.textContent = `${selectedLabel} · show your right hand`;
  } else if (state.interactionMode === 'selection' && state.rightMode === 'selection-ready') {
    statusElement.textContent = 'Selection mode · move the right index cursor and pinch';
  } else if (state.interactionMode === 'selection' && state.rightMode === 'selection-candidate') {
    statusElement.textContent = 'Selection candidate · hold pinch';
  } else if (state.interactionMode === 'selection' && state.rightMode === 'selection-held') {
    statusElement.textContent = 'Selection held · release pinch to re-arm';
  } else if (state.interactionMode === 'move' && state.rightMode === 'move-candidate') {
    statusElement.textContent = 'Move candidate · hold pinch to grab';
  } else if (state.interactionMode === 'move' && state.rightMode === 'move-grabbed') {
    statusElement.textContent = 'Move grabbed · drag right hand, release pinch to drop';
  } else if (state.interactionMode === 'move' && state.rightMode === 'move-released') {
    statusElement.textContent = 'Move released · pinch again to grab';
  } else if (state.interactionMode === 'ball' && state.rightMode === 'ball-contact') {
    statusElement.textContent = 'Ball contact · bounce or tap to launch';
  } else if (state.interactionMode === 'ball' && state.rightMode === 'ball-ready') {
    statusElement.textContent = 'Ball Play · move your palm toward the ball';
  } else if (state.rightMode === 'zoom') {
    statusElement.textContent = 'Right pinch · move thumb and index to zoom';
  } else if (state.rightMode === 'zoom-min') {
    statusElement.textContent = 'Zoom minimum reached · open and re-pinch to continue';
  } else if (state.rightMode === 'zoom-max') {
    statusElement.textContent = 'Zoom maximum reached · open and re-pinch to continue';
  } else if (state.rightMode === 'zoom-stopped') {
    statusElement.textContent = 'Zoom stopped by fist · open hand, then pinch again';
  } else if (state.rightMode === 'rotate') {
    statusElement.textContent = 'Index swipe · rotating 90°';
  } else if (state.rightMode === 'rotation-stopped') {
    statusElement.textContent = 'Right fist · rotation stopped; open to continue';
  } else if (state.rightMode === 'rotate-cooldown') {
    statusElement.textContent = 'Rotation cooldown · return fingertips to neutral';
  } else if (state.rightMode === 'rotate-lock') {
    statusElement.textContent = 'Rotation complete · return index finger to neutral';
  } else {
    statusElement.textContent = state.interactionMode === 'zoom'
      ? 'Zoom mode · pinch with the right hand'
      : state.interactionMode === 'rotation'
        ? 'Rotation mode · wave with the right hand'
        : state.interactionMode === 'selection'
          ? 'Selection mode · pinch the right index cursor'
          : state.interactionMode === 'move'
            ? 'Move mode · pinch and drag the selected model'
            : 'Ball Play · move your palm toward the ball';
  }
}

function connectVision() {
  const socket = new WebSocket('ws://localhost:8765');
  socket.addEventListener('open', () => {
    statusElement.textContent = 'Vision connected · show both hands';
    logEvent('Vision stream connected', 'connection', { status: 'connected' });
  });
  socket.addEventListener('message', (event) => {
    try {
      processVision(JSON.parse(event.data));
    } catch (error) {
      console.error('Invalid vision message', error);
    }
  });
  socket.addEventListener('close', () => {
    statusElement.textContent = 'Vision disconnected · retrying…';
    recordTelemetryEvent('connection', { status: 'disconnected' });
    logEvent('Vision stream disconnected', 'connection', { status: 'disconnected' });
    window.setTimeout(connectVision, 1000);
  });
  socket.addEventListener('error', () => socket.close());
}

zoomModeButton.addEventListener('click', () => setInteractionMode('zoom'));
rotationModeButton.addEventListener('click', () => setInteractionMode('rotation'));
selectionModeButton.addEventListener('click', () => setInteractionMode('selection'));
moveModeButton.addEventListener('click', () => setInteractionMode('move'));
ballModeButton.addEventListener('click', () => setInteractionMode('ball'));
createBoxButton.addEventListener('click', armBoxCreation);
createBallButton.addEventListener('click', createBall);
calibrationButton.addEventListener('click', calibrateWorkspace);
modelFileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) return;
  try {
    await loadModelFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model could not be loaded.';
    recordTelemetryEvent('model_load', { result: 'error', message, fileName: file.name });
    logEvent(`Model load failed: ${message}`, 'model_load', { result: 'error', fileName: file.name });
    statusElement.textContent = 'Model load failed · choose a .glb or .obj file';
  } finally {
    modelFileInput.value = '';
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === '1') setInteractionMode('zoom');
  if (event.key === '2') setInteractionMode('rotation');
  if (event.key.toLowerCase() === 'k') calibrateWorkspace();
  if (event.key.toLowerCase() === 'c') {
    clearScene();
  }
  if (event.key.toLowerCase() === 'l') downloadTelemetry();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeLandmarkCanvas();
});

function updateBallPhysics(deltaSeconds) {
  for (const [id, physics] of ballPhysics) {
    const root = sceneObjects.get(id)?.root;
    if (!root?.visible) continue;
    const radius = BALL_RADIUS * root.scale.x;
    physics.velocity.y -= BALL_GRAVITY * deltaSeconds;
    root.position.addScaledVector(physics.velocity, deltaSeconds);

    const floorY = grid.position.y + radius;
    if (root.position.y < floorY) {
      root.position.y = floorY;
      if (Math.abs(physics.velocity.y) > 0.45) {
        physics.velocity.y = Math.abs(physics.velocity.y) * BALL_RESTITUTION;
      } else {
        physics.velocity.y = 0;
      }
      physics.velocity.x *= 0.84;
      physics.velocity.z *= 0.84;
    }

    const boundaryX = 3.35;
    const boundaryZ = 2.35;
    if (Math.abs(root.position.x) > boundaryX) {
      root.position.x = THREE.MathUtils.clamp(root.position.x, -boundaryX, boundaryX);
      physics.velocity.x *= -0.62;
    }
    if (Math.abs(root.position.z) > boundaryZ) {
      root.position.z = THREE.MathUtils.clamp(root.position.z, -boundaryZ, boundaryZ);
      physics.velocity.z *= -0.62;
    }

    const horizontalDamping = Math.pow(0.985, deltaSeconds * 60);
    physics.velocity.x *= horizontalDamping;
    physics.velocity.z *= horizontalDamping;
    root.rotation.x += physics.velocity.z * deltaSeconds * 0.8;
    root.rotation.z -= physics.velocity.x * deltaSeconds * 0.8;
  }
}

let lastRenderTime = performance.now();

function render() {
  requestAnimationFrame(render);
  const now = performance.now();
  const deltaSeconds = THREE.MathUtils.clamp((now - lastRenderTime) / 1000, 0, 0.05);
  lastRenderTime = now;
  updateBallPhysics(deltaSeconds);
  if (state.rotationDirection && performance.now() >= state.rotationDirectionUntil) {
    clearRotationDirection();
  }
  if (state.rotationAnimation) {
    const elapsed = performance.now() - state.rotationAnimation.startedAt;
    const progress = THREE.MathUtils.clamp(elapsed / ROTATION_DURATION_MS, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    getInteractionRoot().quaternion.copy(state.rotationAnimation.from).slerp(state.rotationAnimation.target, eased);
    if (progress >= 1) {
      getInteractionRoot().quaternion.copy(state.rotationAnimation.target);
      state.rotationAnimation = null;
    }
  }
  updateSelectionVisual();
  renderer.render(scene, camera);
}

setCapturedStyle(false);
setInteractionMode('zoom');
syncInteractionState('initialise');
resizeLandmarkCanvas();
connectVision();
render();
