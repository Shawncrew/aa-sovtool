import type { NodePosition, SystemNode } from "./types";

const CANVAS_PADDING = 240;
const MIN_CANVAS_DIMENSION = 5200;
const CARD_WIDTH = 210;
const CARD_HEIGHT = 125;
const COLLISION_PADDING_X = 160;
const COLLISION_PADDING_Y = 180;
const COLLISION_ITERATIONS = 16;

function computeCoordinateLayout(systems: SystemNode[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (systems.length === 0) {
    return positions;
  }

  const systemsWithCoords = systems.filter(
    (system) =>
      Number.isFinite(system.coordX) &&
      (Number.isFinite(system.coordZ) || Number.isFinite(system.coordY)),
  );
  const reference = systemsWithCoords.length > 0 ? systemsWithCoords : systems;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  reference.forEach((system, index) => {
    const rawX = Number.isFinite(system.coordX) ? system.coordX : index;
    const rawY = Number.isFinite(system.coordZ)
      ? system.coordZ
      : Number.isFinite(system.coordY)
      ? system.coordY
      : index;

    if (rawX < minX) minX = rawX;
    if (rawX > maxX) maxX = rawX;
    if (rawY < minY) minY = rawY;
    if (rawY > maxY) maxY = rawY;
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    maxX = reference.length;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    minY = 0;
    maxY = reference.length;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const estimatedCols = Math.ceil(Math.sqrt(reference.length));
  const estimatedRows = Math.ceil(reference.length / estimatedCols);
  const targetWidth = Math.max(
    MIN_CANVAS_DIMENSION,
    estimatedCols * (CARD_WIDTH + COLLISION_PADDING_X),
  );
  const targetHeight = Math.max(
    MIN_CANVAS_DIMENSION,
    estimatedRows * (CARD_HEIGHT + COLLISION_PADDING_Y),
  );

  const scaleX = targetWidth / rangeX;
  const scaleY = targetHeight / rangeY;
  const scale = Math.min(scaleX, scaleY) * 0.95;

  systems.forEach((system, index) => {
    const rawX = Number.isFinite(system.coordX) ? system.coordX : index;
    const rawY = Number.isFinite(system.coordZ)
      ? system.coordZ
      : Number.isFinite(system.coordY)
      ? system.coordY
      : index;

    const x = (rawX - minX) * scale + CANVAS_PADDING;
    const y = (maxY - rawY) * scale + CANVAS_PADDING;
    positions.set(system.systemName, { x, y });
  });

  const entries = Array.from(positions.entries());
  const requiredX = CARD_WIDTH + COLLISION_PADDING_X;
  const requiredY = CARD_HEIGHT + COLLISION_PADDING_Y;

  for (let iter = 0; iter < COLLISION_ITERATIONS; iter += 1) {
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const posA = positions.get(entries[i][0]);
        const posB = positions.get(entries[j][0]);
        if (!posA || !posB) continue;

        const dx = posB.x - posA.x;
        const dy = posB.y - posA.y;

        const overlapX = requiredX - Math.abs(dx);
        const overlapY = requiredY - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          const pushX = overlapX / 2;
          const pushY = overlapY / 2;

          if (Math.abs(dx) >= Math.abs(dy)) {
            const direction = Math.sign(dx) || (i % 2 === 0 ? 1 : -1);
            posA.x -= direction * pushX;
            posB.x += direction * pushX;
            posA.y -= Math.sign(dy || (j % 2 === 0 ? 1 : -1)) * pushY * 0.25;
            posB.y += Math.sign(dy || (j % 2 === 0 ? 1 : -1)) * pushY * 0.25;
          } else {
            const direction = Math.sign(dy) || (i % 2 === 0 ? 1 : -1);
            posA.y -= direction * pushY;
            posB.y += direction * pushY;
            posA.x -= Math.sign(dx || (j % 2 === 0 ? 1 : -1)) * pushX * 0.25;
            posB.x += Math.sign(dx || (j % 2 === 0 ? 1 : -1)) * pushX * 0.25;
          }
        }
      }
    }
  }

  let maxPositionX = Number.NEGATIVE_INFINITY;
  let maxPositionY = Number.NEGATIVE_INFINITY;
  positions.forEach((pos) => {
    if (pos.x > maxPositionX) maxPositionX = pos.x;
    if (pos.y > maxPositionY) maxPositionY = pos.y;
  });

  const canvasWidth = Math.max(maxPositionX + CANVAS_PADDING, targetWidth + CANVAS_PADDING * 2);
  const canvasHeight = Math.max(
    maxPositionY + CANVAS_PADDING,
    targetHeight + CANVAS_PADDING * 2,
  );

  positions.forEach((pos, key) => {
    positions.set(key, {
      x: Math.max(CANVAS_PADDING, Math.min(canvasWidth - CANVAS_PADDING, pos.x)),
      y: Math.max(CANVAS_PADDING, Math.min(canvasHeight - CANVAS_PADDING, pos.y)),
    });
  });

  return positions;
}

export function ensureNodePositions(systems: SystemNode[]): SystemNode[] {
  const defaults = computeCoordinateLayout(systems);
  return systems.map((system) => {
    if (system.position) {
      return system;
    }
    const fallback = defaults.get(system.systemName) ?? { x: 0, y: 0 };
    return {
      ...system,
      position: fallback,
    };
  });
}

export function computeResolvedPositions(systems: SystemNode[]): Map<string, NodePosition> {
  const defaults = computeCoordinateLayout(systems);
  systems.forEach((system) => {
    if (system.position) {
      defaults.set(system.systemName, system.position);
    }
  });
  return defaults;
}

