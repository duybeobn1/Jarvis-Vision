import assert from 'node:assert/strict';
import {
  ballImpactCanTrigger,
  ballPalmPlanarDistance,
  cameraPointToNdc,
  pinchRatioIsEngaged,
} from '../src/selectionMath.js';

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

assert.equal(ballImpactCanTrigger({
  contacting: true,
  motionReset: false,
  separated: false,
  handSpeed: 2,
  speedThreshold: 1.15,
}), false, 'a held palm must not retrigger every frame');
assert.equal(ballImpactCanTrigger({
  contacting: true,
  motionReset: true,
  separated: false,
  handSpeed: 2,
  speedThreshold: 1.15,
}), true, 'a new tap after the hand settles must retrigger');
assert.equal(ballImpactCanTrigger({
  contacting: true,
  motionReset: false,
  separated: true,
  handSpeed: 0,
  speedThreshold: 1.15,
}), true, 'leaving and re-entering contact must rearm the ball');
assert.ok(
  ballPalmPlanarDistance([0, 0, 3], [0.2, 0.2, -3]) < 0.3,
  'depth noise must not block a screen-overlapping palm contact',
);

console.log('selection math regression tests passed');
