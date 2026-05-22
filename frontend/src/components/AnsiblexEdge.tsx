import { memo } from "react";
import type { EdgeProps } from "reactflow";
import type { NodePosition } from "../types";

interface AnsiblexEdgeData {
  start: { x: number; y: number };
  end: { x: number; y: number };
  nodePositions?: Record<string, NodePosition>;
}

const CARD_WIDTH = 250;
const CARD_HEIGHT = 220;
const CARD_PADDING = 20; // Extra padding around cards to avoid

// Check if a point on a quadratic curve intersects with a rectangle
function pointOnQuadraticCurve(
  t: number,
  startX: number,
  startY: number,
  controlX: number,
  controlY: number,
  endX: number,
  endY: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * startX + 2 * mt * t * controlX + t * t * endX,
    y: mt * mt * startY + 2 * mt * t * controlY + t * t * endY,
  };
}

// Check if a quadratic curve intersects with a rectangle
function curveIntersectsRect(
  startX: number,
  startY: number,
  controlX: number,
  controlY: number,
  endX: number,
  endY: number,
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
): boolean {
  // Quick bounding box check first - if curve's bounding box doesn't overlap with rect, no collision
  const minX = Math.min(startX, controlX, endX);
  const maxX = Math.max(startX, controlX, endX);
  const minY = Math.min(startY, controlY, endY);
  const maxY = Math.max(startY, controlY, endY);
  
  const expandedRectX = rectX - CARD_PADDING;
  const expandedRectY = rectY - CARD_PADDING;
  const expandedRectWidth = rectWidth + 2 * CARD_PADDING;
  const expandedRectHeight = rectHeight + 2 * CARD_PADDING;
  
  // Early exit if bounding boxes don't overlap
  if (
    maxX < expandedRectX ||
    minX > expandedRectX + expandedRectWidth ||
    maxY < expandedRectY ||
    minY > expandedRectY + expandedRectHeight
  ) {
    return false;
  }
  
  // Sample points along the curve (reduced samples for performance)
  const samples = 12; // Reduced from 20
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point = pointOnQuadraticCurve(t, startX, startY, controlX, controlY, endX, endY);
    if (
      point.x >= expandedRectX &&
      point.x <= expandedRectX + expandedRectWidth &&
      point.y >= expandedRectY &&
      point.y <= expandedRectY + expandedRectHeight
    ) {
      return true;
    }
  }
  return false;
}

export const AnsiblexEdge = memo(function AnsiblexEdge(
  props: EdgeProps<AnsiblexEdgeData>,
) {
  const { id, data } = props;
  const start = data?.start;
  const end = data?.end;
  const nodePositions = data?.nodePositions;
  if (!start || !end) {
    return null;
  }
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  let baseCurvature = Math.min(350, distance * 0.45);
  
  // Determine if the line is primarily vertical or horizontal
  const isVertical = Math.abs(dx) < Math.abs(dy) * 0.1; // Mostly vertical
  const isHorizontal = Math.abs(dy) < Math.abs(dx) * 0.1; // Mostly horizontal
  
  // Try different curvature values and directions to avoid collisions
  let controlX: number;
  let controlY: number;
  let bestControlX: number;
  let bestControlY: number;
  let minCollisions = Infinity;
  
  // Try multiple curvature values and directions
  const curvatureMultipliers = [1.0, 1.5, 2.0, 2.5, 3.0];
  const directions = isVertical || isHorizontal ? [1, -1] : [1, -1];
  
  for (const multiplier of curvatureMultipliers) {
    for (const direction of directions) {
      const curvature = baseCurvature * multiplier;
      
      if (isVertical) {
        controlX = midX + curvature * direction;
        controlY = midY;
      } else if (isHorizontal) {
        controlX = midX;
        controlY = midY + curvature * direction;
      } else {
        // For diagonal lines, use perpendicular offset
        const perpX = -dy / distance;
        const perpY = dx / distance;
        controlX = midX + perpX * curvature * direction;
        controlY = midY + perpY * curvature * direction;
      }
      
      // Check for collisions with other cards
      let collisions = 0;
      if (nodePositions) {
        for (const [systemName, pos] of Object.entries(nodePositions)) {
          if (
            curveIntersectsRect(
              start.x,
              start.y,
              controlX,
              controlY,
              end.x,
              end.y,
              pos.x,
              pos.y,
              CARD_WIDTH,
              CARD_HEIGHT,
            )
          ) {
            collisions++;
          }
        }
      }
      
      // Prefer paths with fewer collisions, and among those, prefer smaller curvature
      if (collisions < minCollisions || (collisions === minCollisions && multiplier === 1.0)) {
        minCollisions = collisions;
        bestControlX = controlX;
        bestControlY = controlY;
        if (collisions === 0) {
          break; // Found a collision-free path
        }
      }
    }
    if (minCollisions === 0) {
      break; // Found a collision-free path
    }
  }
  
  controlX = bestControlX!;
  controlY = bestControlY!;
  
  const path = `M ${start.x},${start.y} Q ${controlX},${controlY} ${end.x},${end.y}`;

  return (
    <g
      className="ansiblex-edge"
      data-edgeid={id}
      style={{ pointerEvents: "none" }}
    >
      <path
        d={path}
        stroke="#22d3ee"
        strokeWidth={36}
        strokeLinecap="round"
        fill="none"
        opacity={0.35}
      />
      <path
        d={path}
        stroke={`url(#ansiblexGradientForward-${id})`}
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
        className="ansiblex-flow ansiblex-flow-forward"
      />
      <path
        d={path}
        stroke={`url(#ansiblexGradientReverse-${id})`}
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
        className="ansiblex-flow ansiblex-flow-reverse"
      />
      <defs>
        <linearGradient id={`ansiblexGradientForward-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id={`ansiblexGradientReverse-${id}`} x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.85" />
          <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.85" />
        </linearGradient>
      </defs>
    </g>
  );
});


