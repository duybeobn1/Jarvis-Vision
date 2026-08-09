export function cameraPointToNdc(point, viewportWidth, viewportHeight, frame) {
  const frameWidth = frame?.width || viewportWidth;
  const frameHeight = frame?.height || viewportHeight;
  const coverScale = Math.max(viewportWidth / frameWidth, viewportHeight / frameHeight);
  const drawnWidth = frameWidth * coverScale;
  const drawnHeight = frameHeight * coverScale;
  const viewportX = point[0] * drawnWidth + (viewportWidth - drawnWidth) / 2;
  const viewportY = point[1] * drawnHeight + (viewportHeight - drawnHeight) / 2;

  return {
    x: (viewportX / viewportWidth) * 2 - 1,
    y: 1 - (viewportY / viewportHeight) * 2,
  };
}

export function pinchRatioIsEngaged(ratio, threshold) {
  const numericRatio = Number(ratio);
  return Number.isFinite(numericRatio) && numericRatio < threshold;
}
