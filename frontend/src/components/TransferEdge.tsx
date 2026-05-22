import { memo, useMemo } from "react";
import type { EdgeProps } from "reactflow";

interface TransferEdgeData {
  sourceOffset: { x: number; y: number };
  targetOffset: { x: number; y: number };
  directionX: number;
  directionY: number;
  distance: number;
}

export const TransferEdge = memo(function TransferEdge(props: EdgeProps<TransferEdgeData>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    markerEnd,
    markerStart,
    data,
  } = props;

  const sourceOffset = data?.sourceOffset ?? { x: 0, y: 0 };
  const targetOffset = data?.targetOffset ?? { x: 0, y: 0 };
  const directionX = data?.directionX ?? 0;
  const directionY = data?.directionY ?? 0;
  const distance = data?.distance ?? 0;
  const markerId = useMemo(() => `transfer-arrow-${id}`, [id]);

  const path = useMemo(() => {
    const offsetStartX = sourceX + sourceOffset.x;
    const offsetStartY = sourceY + sourceOffset.y;
    const offsetEndX = targetX + targetOffset.x;
    const offsetEndY = targetY + targetOffset.y;
    const dx = offsetEndX - offsetStartX;
    const dy = offsetEndY - offsetStartY;
    const computedDistance = Math.hypot(dx, dy) || 1;
    const controlMagnitude = Math.min(160, computedDistance * 0.35);
    const controlX1 = offsetStartX + directionX * controlMagnitude;
    const controlY1 = offsetStartY + directionY * controlMagnitude;
    const controlX2 = offsetEndX - directionX * controlMagnitude;
    const controlY2 = offsetEndY - directionY * controlMagnitude;

    return [
      `M ${sourceX},${sourceY}`,
      `L ${offsetStartX},${offsetStartY}`,
      `C ${controlX1},${controlY1} ${controlX2},${controlY2} ${offsetEndX},${offsetEndY}`,
      `L ${targetX},${targetY}`,
    ].join(" ");
  }, [
    directionX,
    directionY,
    distance,
    sourceOffset.x,
    sourceOffset.y,
    targetOffset.x,
    targetOffset.y,
    sourceX,
    sourceY,
    targetX,
    targetY,
  ]);

  return (
    <g className="transfer-edge" data-edgeid={id}>
      <defs>
        <marker
          id={markerId}
          markerWidth="10"
          markerHeight="10"
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" opacity={0.9} />
        </marker>
      </defs>
      <path
        d={path}
        className="transfer-edge-base"
        fill="none"
        pointerEvents="none"
        markerEnd={markerEnd ?? `url(#${markerId})`}
        markerStart={markerStart}
      />
      <path
        d={path}
        className="transfer-edge-overlay"
        fill="none"
        pointerEvents="none"
        markerEnd={markerEnd ?? `url(#${markerId})`}
        markerStart={markerStart}
      />
    </g>
  );
});


