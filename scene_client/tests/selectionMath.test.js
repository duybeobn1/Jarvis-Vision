import assert from 'node:assert/strict';
import { cameraPointToNdc, pinchRatioIsEngaged } from '../src/selectionMath.js';

const centered = cameraPointToNdc(
  [0.5, 0.5],
  1440,
  900,
  { width: 1280, height: 720 },
);
assert.equal(centered.x, 0);
assert.equal(centered.y, 0);

const croppedLeft = cameraPointToNdc(
  [0, 0.5],
  1440,
  900,
  { width: 1280, height: 720 },
);
assert.ok(croppedLeft.x < -1, 'camera crop must be included in the ray projection');

assert.equal(pinchRatioIsEngaged(0.5, 0.58), true);
assert.equal(pinchRatioIsEngaged(0.7, 0.58), false);
assert.equal(pinchRatioIsEngaged('not-a-number', 0.58), false);

console.log('selection math regression tests passed');
