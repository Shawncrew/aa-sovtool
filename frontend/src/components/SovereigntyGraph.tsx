import { useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node,
  Position,
  type NodeProps,
} from "reactflow";

import { SystemNodeCard } from "./SystemNodeCard";
import { TransferEdge } from "./TransferEdge";
import { AnsiblexEdge } from "./AnsiblexEdge";
import type { NodePosition, SystemNode, SystemRole } from "../types";
import { computeResolvedPositions } from "../layout";

import "reactflow/dist/style.css";

const CARD_WIDTH = 250;
const CARD_HEIGHT = 220;
const REGION_PADDING = 80;

const NODE_TYPES = {
  system: SystemNodeCard,
} as const;

const EDGE_TYPES = {
  transfer: TransferEdge,
  ansiblex: AnsiblexEdge,
} as const;

type HandleGroups = Record<
  Position,
  Array<{ neighbor: string; position: Position; offset: number; role: SystemRole | null }>
>;

interface SovereigntyGraphProps {
  systems: SystemNode[];
  systemStats: Map<
    string,
    {
      powerUsed: number;
      powerCapacity: number;
      workforceUsed: number;
      workforceCapacity: number;
      upgradeWorkforceUsed: number;
      exportWorkforceUsed: number;
    }
  >;
  selectedSystemName?: string | null;
  onSelectSystem?: (systemName: string) => void;
  onPositionChange?: (systemName: string, position: NodePosition) => void;
  isEditable?: boolean;
  systemColorMode?: string;
  colorModeRanges?: {
    trueSec: { min: number; max: number };
    workforce: { min: number; max: number };
    power: { min: number; max: number };
    superionicIce: { min: number; max: number };
    magmaticGas: { min: number; max: number };
  };
  viewMode?: "compact" | "detailed";
}

export function SovereigntyGraph({
  systems,
  systemStats,
  selectedSystemName,
  onSelectSystem,
  onPositionChange,
  isEditable = true,
  systemColorMode = "none",
  colorModeRanges,
  viewMode = "compact",
}: SovereigntyGraphProps) {
  const positions = useMemo(
    () => computeResolvedPositions(systems),
    [systems],
  );
  const systemsByName = useMemo(
    () => new Map(systems.map((system) => [system.systemName, system])),
    [systems],
  );
  const systemNameSet = useMemo(
    () => new Set(systems.map((system) => system.systemName)),
    [systems],
  );
  const neighborMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    systems.forEach((system) => {
      map.set(
        system.systemName,
        new Set(system.neighbors.filter((neighbor) => systemNameSet.has(neighbor))),
      );
    });
    return map;
  }, [systemNameSet, systems]);

  const nodes = useMemo<Node[]>(() => {
    const systemNodes = systems.map((system) => {
      const position = positions.get(system.systemName) ?? { x: 0, y: 0 };
      const visibleNeighbors = Array.from(
        neighborMap.get(system.systemName) ?? new Set<string>(),
      );
      const handleGroups: HandleGroups = {
        [Position.Top]: [],
        [Position.Right]: [],
        [Position.Bottom]: [],
        [Position.Left]: [],
      };

      visibleNeighbors.forEach((neighbor) => {
        const neighborPos = positions.get(neighbor);
        const neighborSystem = systemsByName.get(neighbor);
        if (!neighborPos) {
          return;
        }
        const dx = neighborPos.x - position.x;
        const dy = neighborPos.y - position.y;

        let targetPosition: Position;
        let sortingValue: number;
        if (Math.abs(dx) >= Math.abs(dy)) {
          targetPosition = dx >= 0 ? Position.Right : Position.Left;
          sortingValue = neighborPos.y;
        } else {
          targetPosition = dy >= 0 ? Position.Bottom : Position.Top;
          sortingValue = neighborPos.x;
        }

        handleGroups[targetPosition].push({
          neighbor,
          position: targetPosition,
          offset: sortingValue,
          role: neighborSystem?.role ?? null,
        });
      });

      (Object.keys(handleGroups) as Array<Position>).forEach((positionKey) => {
        const handles = handleGroups[positionKey];
        handles
          .sort((a, b) => a.offset - b.offset)
          .forEach((handle, index) => {
            handle.offset = (index + 1) / (handles.length + 1);
          });
      });

      const stats = systemStats.get(system.systemName);
      const isDeklein = system.regionName.toLowerCase() === "deklein";

      return {
        id: system.systemName,
        type: "system",
        data: {
          system,
          handles: handleGroups,
          isSelected: system.systemName === selectedSystemName,
          stats,
          systemColorMode,
          colorModeRanges,
          viewMode,
        },
        position,
        zIndex: isDeklein ? 20 : 10,
      };
    });

    return systemNodes;
  }, [
    neighborMap,
    positions,
    selectedSystemName,
    systemStats,
    systems,
    systemColorMode,
    colorModeRanges,
    viewMode,
  ]);

  const edges = useMemo<Edge[]>(() => {
    function computeBoundaryPoint(
      from: NodePosition,
      to: NodePosition,
    ): { x: number; y: number } {
      const fromCenter = {
        x: from.x + CARD_WIDTH / 2,
        y: from.y + CARD_HEIGHT / 2,
      };
      const toCenter = {
        x: to.x + CARD_WIDTH / 2,
        y: to.y + CARD_HEIGHT / 2,
      };
      const dx = toCenter.x - fromCenter.x;
      const dy = toCenter.y - fromCenter.y;
      const length = Math.hypot(dx, dy) || 1;
      const nx = dx / length;
      const ny = dy / length;
      const halfWidth = CARD_WIDTH / 2 - 8;
      const halfHeight = CARD_HEIGHT / 2 - 8;
      const scaleX = nx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(nx);
      const scaleY = ny === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(ny);
      const scale = Math.min(scaleX, scaleY);
      return {
        x: fromCenter.x + nx * scale,
        y: fromCenter.y + ny * scale,
      };
    }

    const adjacencyKeys = new Set<string>();
    const edgesList: Edge[] = [];

    systems.forEach((system) => {
      const neighbors = neighborMap.get(system.systemName);
      if (!neighbors) {
        return;
      }
      neighbors.forEach((neighbor) => {
        const key =
          system.systemName < neighbor
            ? `${system.systemName}--${neighbor}`
            : `${neighbor}--${system.systemName}`;
        if (adjacencyKeys.has(key)) {
          return;
        }
        adjacencyKeys.add(key);
        const targetSystem = systems.find(
          (item) => item.systemName === neighbor,
        );
        const edgeColor =
          targetSystem?.regionName !== system.regionName
            ? "#3b82f6"
            : targetSystem?.constellationName !== system.constellationName
            ? "#ef4444"
            : "#ffffff";

        edgesList.push({
          id: `adj-${key}`,
          source: system.systemName,
          target: neighbor,
          sourceHandle: `${system.systemName}__neighbor__${neighbor}`,
          targetHandle: `${system.systemName}__neighbor__${neighbor}`,
          style: {
            stroke: edgeColor,
            strokeWidth: 1.5,
          },
          data: {
            hasTransfer: false,
          },
        });
      });
    });

    systems.forEach((system) => {
      system.transfers.forEach((transfer) => {
        if (transfer.sourceSystemId !== system.systemName) {
          return;
        }
        if (transfer.isOnline === false || transfer.amount <= 0) {
          return;
        }
        const pathNodes = [
          transfer.sourceSystemId,
          ...(transfer.viaSystems ?? []),
          transfer.targetSystemId,
        ];
        if (pathNodes.length < 2) {
          return;
        }

        const offsetMagnitude = 5;

        for (let index = 0; index < pathNodes.length - 1; index += 1) {
          const from = pathNodes[index];
          const to = pathNodes[index + 1];
          const fromPos = positions.get(from);
          const toPos = positions.get(to);
          if (!fromPos || !toPos) {
            return;
          }
          const dx = toPos.x - fromPos.x;
          const dy = toPos.y - fromPos.y;
          const length = Math.hypot(dx, dy) || 1;
          const directionX = dx / length;
          const directionY = dy / length;
          const perpX = -directionY * offsetMagnitude;
          const perpY = directionX * offsetMagnitude;
          const sourceOffset = { x: perpX, y: perpY };
          const targetOffset = { x: perpX, y: perpY };
          const handleId = neighborMap.get(from)?.has(to) ? `${from}__neighbor__${to}` : undefined;

          edgesList.push({
            id: `transfer-${transfer.sourceSystemId}->${transfer.targetSystemId}-leg-${index}`,
            source: from,
            target: to,
            type: "transfer",
            animated: false,
            className: "transfer-edge",
            sourceHandle: handleId,
            targetHandle: handleId,
            data: {
              sourceOffset,
              targetOffset,
              directionX,
              directionY,
              distance: length,
            },
          });
        }
      });
    });

    systems.forEach((system) => {
      const partnerName = system.ansiblexPartner;
      if (!partnerName) {
        return;
      }
      if (system.systemName > partnerName) {
        return;
      }
      const partner = systemsByName.get(partnerName);
      if (!partner) {
        return;
      }
      if (partner.ansiblexPartner !== system.systemName) {
        return;
      }
      const fromPos = positions.get(system.systemName);
      const toPos = positions.get(partnerName);
      if (!fromPos || !toPos) {
        return;
      }
      const start = computeBoundaryPoint(fromPos, toPos);
      const end = computeBoundaryPoint(toPos, fromPos);
      // Pass all node positions for collision detection
      const nodePositions: Record<string, NodePosition> = {};
      systems.forEach((s) => {
        const pos = positions.get(s.systemName);
        if (pos && s.systemName !== system.systemName && s.systemName !== partnerName) {
          nodePositions[s.systemName] = pos;
        }
      });
      edgesList.push({
        id: `ansiblex-${system.systemName}-${partnerName}`,
        source: system.systemName,
        target: partnerName,
        type: "ansiblex",
        data: { start, end, nodePositions },
        interactionWidth: 0,
        className: "ansiblex-edge",
        zIndex: -5,
      });
    });

    return edgesList;
  }, [neighborMap, positions, systems, systemsByName]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      fitView
      minZoom={0.1}
      maxZoom={2.5}
      snapToGrid
      snapGrid={[40, 40]}
      className="bg-slate-950 text-slate-100"
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      nodesDraggable={isEditable}
      elementsSelectable={isEditable}
      nodesConnectable={false}
      deleteKeyCode={null}
      multiSelectionKeyCode={null}
      onNodeClick={(_, node) => onSelectSystem?.(node.id)}
      onNodeDrag={(_, node) => {
        if (!isEditable) {
          return;
        }
        onPositionChange?.(node.id, {
          x: node.position.x,
          y: node.position.y,
        });
      }}
      onNodeDragStop={(_, node) => {
        if (!isEditable) {
          return;
        }
        onPositionChange?.(node.id, {
          x: node.position.x,
          y: node.position.y,
        });
      }}
    >
      <MiniMap
        nodeStrokeColor="#6cb2ff"
        nodeColor="#0f172a"
        maskColor="rgba(15, 23, 42, 0.75)"
      />
      <Controls className="!border-slate-800 !bg-slate-900 !text-slate-100" />
      <Background gap={24} color="#1e293b" />
    </ReactFlow>
  );
}


