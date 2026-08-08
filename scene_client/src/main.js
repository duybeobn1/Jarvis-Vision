import * as THREE from 'three';
import './style.css';

const statusElement = document.querySelector('#status');
const cameraFeedElement = document.querySelector('#camera-feed');
const landmarkCanvas = document.querySelector('#landmark-overlay');
const landmarkContext = landmarkCanvas.getContext('2d');
const zoomModeButton = document.querySelector('#mode-zoom');
const rotationModeButton = document.querySelector('#mode-rotation');
const logLinesElement = document.querySelector('#log-lines');
const directionElements = {
  left: document.querySelector('#arrow-left'),
  right: document.querySelector('#arrow-right'),
  up: document.querySelector('#arrow-up'),
  down: document.querySelector('#arrow-down'),
};

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

const state = {
  captured: false,
  captureFrames: 0,
  captureArmed: true,
  previewTransform: null,
  baseScale: null,
  interactionMode: 'zoom',
  numberOneLatch: false,
  rightHand: null,
  rightMode: 'idle',
  rotationAnimation: null,
  rotationDirection: null,
  rotationDirectionUntil: 0,
  eventLog: [],
  lastMessage: null,
};

function logEvent(message) {
  const time = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  state.eventLog.unshift({ time, message });
  state.eventLog = state.eventLog.slice(0, 12);
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

function normalizedToScene(point) {
  return new THREE.Vector3(
    (point[0] - 0.5) * 5.6,
    (0.5 - point[1]) * 3.4,
    -point[2] * 4.0,
  );
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
  if (!boxGroup.visible) {
    boxGroup.position.copy(transform.position);
    boxGroup.quaternion.copy(transform.quaternion);
    boxGroup.scale.copy(transform.scale);
  } else {
    boxGroup.position.lerp(transform.position, smoothing);
    boxGroup.quaternion.slerp(transform.quaternion, smoothing);
    boxGroup.scale.lerp(transform.scale, smoothing);
  }
  boxGroup.visible = true;
}

function setCapturedStyle(captured) {
  boxMaterial.color.setHex(captured ? 0x65ff9b : 0xff55e8);
  boxMaterial.emissive.setHex(captured ? 0x0a6b45 : 0x6e0f75);
  edgeMaterial.color.setHex(captured ? 0x65ff9b : 0xff55e8);
  vertexMaterial.color.setHex(captured ? 0xd0ffe0 : 0xffd3ff);
}

function setInteractionMode(mode) {
  state.interactionMode = mode;
  state.rightHand = null;
  state.rightMode = 'idle';
  state.rotationAnimation = null;
  clearRotationDirection();
  zoomModeButton.classList.toggle('active', mode === 'zoom');
  rotationModeButton.classList.toggle('active', mode === 'rotation');
  logEvent(mode === 'zoom' ? 'Mode: Zoom / Dezoom' : 'Mode: Rotation');
  if (state.captured) {
    statusElement.textContent = mode === 'zoom'
      ? 'Zoom mode · pinch with the right hand'
      : 'Rotation mode · wave with the right hand';
  }
}

const WORLD_X = new THREE.Vector3(1, 0, 0);
const WORLD_Y = new THREE.Vector3(0, 1, 0);
const PINCH_ENGAGE_RATIO = 0.52;
const PINCH_RELEASE_RATIO = 0.78;
const PINCH_CONFIRM_FRAMES = 5;
const PINCH_SMOOTHING = 0.22;
const MIN_ZOOM_FACTOR = 0.35;
const MAX_ZOOM_FACTOR = 3.0;
const FINGERTIP_SWIPE_TRIGGER_DISTANCE = 0.48;
const FINGERTIP_SWIPE_RESET_DISTANCE = 0.16;
const FINGERTIP_POSITION_SMOOTHING = 0.28;
const ROTATION_COOLDOWN_MS = 1000;
const ROTATION_DURATION_MS = 360;

function zoomBounds() {
  const base = state.baseScale || boxGroup.scale;
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
  startSmoothRotationTo(boxGroup.quaternion.clone().premultiply(rotation));
}

function startSmoothRotationTo(targetQuaternion) {
  state.rotationAnimation = {
    from: boxGroup.quaternion.clone(),
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
    state.rightHand = null;
    state.rightMode = 'idle';
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
  if (right.numberOne) {
    if (!state.numberOneLatch) {
      state.numberOneLatch = true;
      const nextMode = state.interactionMode === 'zoom' ? 'rotation' : 'zoom';
      setInteractionMode(nextMode);
      logEvent(`Number one → ${nextMode === 'zoom' ? 'Zoom / Dezoom' : 'Rotation'}`);
    }
    state.rightMode = 'mode-switch';
    return;
  }
  state.numberOneLatch = false;
  if (!state.rightHand) {
    state.rightHand = {
      zoomActive: false,
      zoomBlocked: false,
      pinchRatio: rawRatio,
      pinchCandidateFrames: 0,
      zoomRatio: rawRatio,
      zoomScale: boxGroup.scale.clone(),
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
        control.zoomScale = clampScale(boxGroup.scale);
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
        position: boxGroup.position.clone(),
        quaternion: boxGroup.quaternion.clone(),
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
        state.captured = true;
        state.captureArmed = false;
        state.baseScale = boxGroup.scale.clone();
        state.rightHand = null;
        state.rightMode = 'idle';
        state.rotationAnimation = null;
        clearRotationDirection();
        setCapturedStyle(true);
        logEvent('Box captured');
        statusElement.textContent = 'Box captured · show your right hand';
      }
    } else if (!bothFists) {
      state.captureFrames = 0;
      state.captureArmed = true;
    }
  } else {
    updateRightHand(message);
  }

  const handCount = Object.keys(message.hands || {}).length;
  if (!state.captured) {
    statusElement.textContent = bothFists
      ? `Hold fists to capture · ${state.captureFrames}/12`
      : `Preview · ${handCount}/2 hands · six anchors`;
  } else if (!message.hands?.right) {
    statusElement.textContent = 'Box captured · show your right hand';
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
  } else if (state.rightMode === 'mode-switch') {
    statusElement.textContent = 'Number one detected · mode switched';
  } else if (state.rightMode === 'rotate-lock') {
    statusElement.textContent = 'Rotation complete · return index finger to neutral';
  } else {
    statusElement.textContent = state.interactionMode === 'zoom'
      ? 'Zoom mode · pinch with the right hand'
      : 'Rotation mode · wave with the right hand';
  }
}

function connectVision() {
  const socket = new WebSocket('ws://localhost:8765');
  socket.addEventListener('open', () => {
    statusElement.textContent = 'Vision connected · show both hands';
    logEvent('Vision stream connected');
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
    logEvent('Vision stream disconnected');
    window.setTimeout(connectVision, 1000);
  });
  socket.addEventListener('error', () => socket.close());
}

zoomModeButton.addEventListener('click', () => setInteractionMode('zoom'));
rotationModeButton.addEventListener('click', () => setInteractionMode('rotation'));

window.addEventListener('keydown', (event) => {
  if (event.key === '1') setInteractionMode('zoom');
  if (event.key === '2') setInteractionMode('rotation');
  if (event.key.toLowerCase() === 'c') {
    state.captured = false;
    state.captureFrames = 0;
    state.captureArmed = true;
    state.previewTransform = null;
    state.baseScale = null;
    state.numberOneLatch = false;
    state.rightHand = null;
    state.rightMode = 'idle';
    state.rotationAnimation = null;
    clearRotationDirection();
    boxGroup.visible = false;
    logEvent('Scene cleared');
    statusElement.textContent = 'Cleared · show six fingertips to preview';
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  resizeLandmarkCanvas();
});

function render() {
  requestAnimationFrame(render);
  if (state.rotationDirection && performance.now() >= state.rotationDirectionUntil) {
    clearRotationDirection();
  }
  if (state.rotationAnimation) {
    const elapsed = performance.now() - state.rotationAnimation.startedAt;
    const progress = THREE.MathUtils.clamp(elapsed / ROTATION_DURATION_MS, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    boxGroup.quaternion.copy(state.rotationAnimation.from).slerp(state.rotationAnimation.target, eased);
    if (progress >= 1) {
      boxGroup.quaternion.copy(state.rotationAnimation.target);
      state.rotationAnimation = null;
    }
  }
  renderer.render(scene, camera);
}

setCapturedStyle(false);
setInteractionMode('zoom');
resizeLandmarkCanvas();
connectVision();
render();
