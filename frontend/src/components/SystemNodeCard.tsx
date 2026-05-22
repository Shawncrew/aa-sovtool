import { memo, type CSSProperties } from "react";
import type { NodeProps } from "reactflow";
import { Handle, Position } from "reactflow";

import type { SystemNode, SystemRole } from "../types";
import { UpgradeIcon } from "./UpgradeIcon";
import { useI18n } from "../i18n/context";

interface HandleDescriptor {
  neighbor: string;
  position: Position;
  offset: number;
  role: SystemRole | null;
}

interface SystemNodeData {
  system: SystemNode;
  handles: Record<Position, HandleDescriptor[]>;
  isSelected: boolean;
  stats?:
    | {
        powerUsed: number;
        powerCapacity: number;
        workforceUsed: number;
        workforceCapacity: number;
        upgradeWorkforceUsed: number;
        exportWorkforceUsed: number;
      }
    | undefined;
  systemColorMode?: string;
  colorModeRanges?: {
    trueSec: { min: number; max: number };
    workforce: { min: number; max: number };
    power: { min: number; max: number };
    superionicIce: { min: number; max: number };
    magmaticGas: { min: number; max: number };
  };
}

function computeHandleStyle(offset: number, position: Position): CSSProperties {
  const percentage = offset * 100;
  if (position === Position.Top || position === Position.Bottom) {
    return { left: `${percentage}%` };
  }
  return { top: `${percentage}%` };
}

interface IconProps {
  className?: string;
}

const IceIcon = ({ className = "h-3.5 w-3.5" }: IconProps) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    className={`text-sky-200 ${className}`}
    fill="none"
  >
    <path
      d="M3.8 4.6 8 2l4.2 2.6v4.8L8 12l-4.2-2.6V4.6Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
    <path
      d="M8 4.2V12"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

const FlameIcon = ({ className = "h-3.5 w-3.5" }: IconProps) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    className={`text-amber-300 ${className}`}
    fill="none"
  >
    <path
      d="M8.4 2.5c1.2 1.8 2.6 2.4 3.2 4.5.3 1 .3 2.1-.1 3a3.7 3.7 0 0 1-3.5 2.2A3.7 3.7 0 0 1 4.5 10c-.4-.9-.4-2-.2-3 1.2-4.1 2.5-3.2 4.1-4.5Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6.2 8.2c0 .6.3 1.2.7 1.7.5.6 1.2.9 1.7.6.4-.2.6-.8.6-1.4-.1-1-.5-1.4-1.2-2.1-.5.7-1.8.6-1.8 1.2Z"
      fill="currentColor"
      opacity="0.75"
    />
  </svg>
);

function calculateGradientColor(
  value: number,
  min: number,
  max: number,
  invertScale = false,
): string {
  // Normalize value from min-max range to 0.0 to 1.0
  const range = max - min;
  let normalized = range > 0 ? Math.max(0, Math.min(1, (value - min) / range)) : 0.5;
  
  // Invert the scale if requested (for workforce, power, etc. where highest should be reddest)
  if (invertScale) {
    normalized = 1 - normalized;
  }
  
  // Interpolate between red (lowest normalized) and slate-900 (highest normalized)
  // slate-900 is #0f172a, red is #ef4444 (red-500) - a better, more vibrant red
  const redR = 239; // #ef4444
  const redG = 68;
  const redB = 68;
  const slateR = 15; // #0f172a
  const slateG = 23;
  const slateB = 42;
  
  // Lower normalized values are reddest
  const r = Math.round(slateR + (redR - slateR) * (1 - normalized));
  const g = Math.round(slateG + (redG - slateG) * (1 - normalized));
  const b = Math.round(slateB + (redB - slateB) * (1 - normalized));
  
  return `rgb(${r}, ${g}, ${b})`;
}

function SystemNodeCardInner({ data }: NodeProps<SystemNodeData>) {
  const { t } = useI18n();
  const { system, handles, isSelected, stats, systemColorMode = "none", colorModeRanges } = data;
  const isNpcSystem = typeof system.factionId === "number" && system.factionId > 0;
  
  let baseAppearance: string;
  let gradientColor: string | undefined;
  
  if (isNpcSystem) {
    baseAppearance = "border-amber-500/70 bg-[#2b1d11]";
  } else if (systemColorMode !== "none" && colorModeRanges) {
    let value = 0;
    let min = 0;
    let max = 1;
    
    let invertScale = false;
    switch (systemColorMode) {
      case "trueSec":
        value = system.security;
        min = colorModeRanges.trueSec.min;
        max = colorModeRanges.trueSec.max;
        invertScale = false; // Keep true sec as is (lowest = reddest)
        break;
      case "workforce":
        value = stats?.workforceCapacity ?? system.workforce;
        min = colorModeRanges.workforce.min;
        max = colorModeRanges.workforce.max;
        invertScale = true; // Invert: highest = reddest
        break;
      case "power":
        value = stats?.powerCapacity ?? system.totalPower;
        min = colorModeRanges.power.min;
        max = colorModeRanges.power.max;
        invertScale = true; // Invert: highest = reddest
        break;
      case "superionicIce":
        value = system.baseSuperionicIcePerHour ?? 0;
        min = colorModeRanges.superionicIce.min;
        max = colorModeRanges.superionicIce.max;
        invertScale = true; // Invert: highest = reddest
        break;
      case "magmaticGas":
        value = system.baseMagmaticGasPerHour ?? 0;
        min = colorModeRanges.magmaticGas.min;
        max = colorModeRanges.magmaticGas.max;
        invertScale = true; // Invert: highest = reddest
        break;
    }
    
    gradientColor = calculateGradientColor(value, min, max, invertScale);
    baseAppearance = "border-slate-700";
  } else {
    baseAppearance = "border-slate-700 bg-slate-900";
  }
  
  const selectedAppearance = isSelected
    ? "border-sov-orange bg-slate-800 ring-2 ring-sov-orange/50"
    : baseAppearance;
  const powerUsed = stats?.powerUsed ?? 0;
  const powerCapacity = stats?.powerCapacity ?? system.totalPower;
  const workforceUsed = stats?.workforceUsed ?? 0;
  const workforceCapacity = stats?.workforceCapacity ?? system.workforce;
  const upgradeWorkforceUsed = stats?.upgradeWorkforceUsed ?? 0;
  const exportWorkforceUsed = stats?.exportWorkforceUsed ?? 0;
  const upgradeWorkforcePercent =
    workforceCapacity > 0 ? Math.min(100, (upgradeWorkforceUsed / workforceCapacity) * 100) : 0;
  const totalWorkforcePercent =
    workforceCapacity > 0
      ? Math.min(
          100,
          ((upgradeWorkforceUsed + exportWorkforceUsed) / workforceCapacity) * 100,
        )
      : 0;
  const exportWorkforcePercent = Math.max(0, totalWorkforcePercent - upgradeWorkforcePercent);
  const planetSuperionicIce = system.baseSuperionicIcePerHour ?? 0;
  const planetMagmaticGas = system.baseMagmaticGasPerHour ?? 0;

  const isDeklein = system.regionName.toLowerCase() === "deklein";
  
  const cardStyle: CSSProperties = {
    height: 220,
    position: "relative",
    zIndex: isNpcSystem ? 5 : isDeklein ? 20 : undefined,
  };
  
  if (gradientColor && !isNpcSystem && !isSelected) {
    cardStyle.backgroundColor = gradientColor;
  }

  return (
    <div
      className={`min-w-[250px] max-w-[250px] rounded-lg border px-4 py-3 text-left shadow-lg transition-all ${selectedAppearance}`}
      style={cardStyle}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[32px] font-semibold leading-tight text-sov-blue">
          {system.systemName}
        </p>
        <span
          className={[
            "rounded px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
            system.role === "export"
              ? "bg-rose-900/40 text-rose-200"
              : system.role === "import"
              ? "bg-emerald-900/40 text-emerald-200"
              : "bg-slate-800 text-slate-300",
          ].join(" ")}
        >
          {system.role === "export" ? t.export : system.role === "import" ? t.import : t.transit}
        </span>
      </div>
      <div className="mt-1 flex items-center text-sm text-slate-300">
        <span className="truncate font-medium">{system.constellationName ?? "Unknown"}</span>
        <div className="ml-auto flex items-center gap-2 text-[16px] text-slate-200 pl-2">
          <span className="flex items-center" title="Superionic Ice per hour">
            <span className="flex items-center font-semibold text-sky-100">
              <IceIcon className="h-6 w-6" />
              <span className="ml-[1px] min-w-[0.5rem] text-right">
                {planetSuperionicIce.toLocaleString()}
              </span>
              <span className="text-[16px] font-normal text-sky-200/80">/hr</span>
            </span>
          </span>
          <span className="flex items-center" title="Magmatic Gas per hour">
            <span className="flex items-center font-semibold text-amber-200">
              <FlameIcon className="h-6 w-6" />
              <span className="ml-[1px] min-w-[0.5rem] text-right">
                {planetMagmaticGas.toLocaleString()}
              </span>
              <span className="text-[16px] font-normal text-amber-200/80">/hr</span>
            </span>
          </span>
        </div>
      </div>
      {system.sovereignty && (
        <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-slate-300">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">
              {system.sovereignty.structureTypeName || "Sov Hub"}
              {system.sovereignty.allianceId
                ? ` · A:${system.sovereignty.allianceId}`
                : system.sovereignty.corporationId
                ? ` · C:${system.sovereignty.corporationId}`
                : ""}
            </span>
            <span className="flex items-center gap-1">
              {typeof system.sovereignty.activityDefenseMultiplier === "number" && (
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                  ADM {system.sovereignty.activityDefenseMultiplier.toFixed(1)}
                </span>
              )}
              {system.sovereignty.isRaidable && (
                <span className="rounded bg-rose-900/60 px-1.5 py-0.5 font-semibold uppercase text-[10px] text-rose-200">
                  Raidable
                </span>
              )}
            </span>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2 text-[14px] text-slate-200">
        <div>
          <div className="flex justify-between text-[14px] uppercase tracking-wide text-slate-300 font-semibold">
            <span>{t.power}</span>
            <span className="font-bold text-slate-100">
              {powerUsed.toLocaleString()} / {powerCapacity.toLocaleString()}
            </span>
          </div>
          <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-800">
            <div
              className={`absolute left-0 top-0 h-full ${
                powerUsed > powerCapacity ? "bg-red-500" : "bg-sov-blue"
              }`}
              style={{ width: `${Math.min(100, (powerCapacity > 0 ? (powerUsed / powerCapacity) * 100 : 0))}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[14px] uppercase tracking-wide text-slate-300 font-semibold">
            <span>{t.workforce}</span>
            <span className="font-bold text-slate-100">
              {workforceUsed.toLocaleString()} / {workforceCapacity.toLocaleString()}
            </span>
          </div>
          <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-800">
            <div
              className={`absolute left-0 top-0 h-full ${
                workforceUsed > workforceCapacity ? "bg-red-500" : "bg-sov-blue"
              }`}
              style={{ width: `${upgradeWorkforcePercent}%` }}
            />
            <div
              className={`absolute top-0 h-full ${
                workforceUsed > workforceCapacity ? "bg-red-500" : "bg-emerald-500"
              }`}
              style={{ left: `${upgradeWorkforcePercent}%`, width: `${exportWorkforcePercent}%` }}
            />
          </div>
        </div>
      </div>

      {Object.entries(handles).map(([positionKey, descriptors]) =>
        descriptors.map((descriptor) => (
          <Handle
            key={`${system.systemName}-${positionKey}-${descriptor.neighbor}`}
            type="source"
            position={descriptor.position}
            id={`${system.systemName}__neighbor__${descriptor.neighbor}`}
            style={computeHandleStyle(descriptor.offset, descriptor.position)}
            className={[
              "!h-2 !w-2",
              descriptor.role === "export"
                ? "!bg-rose-400"
                : descriptor.role === "import"
                ? "!bg-emerald-400"
                : "!bg-sov-blue",
            ].join(" ")}
          />
        )),
      )}
      {Object.entries(handles).map(([positionKey, descriptors]) =>
        descriptors.map((descriptor) => (
          <Handle
            key={`${system.systemName}-${positionKey}-${descriptor.neighbor}-target`}
            type="target"
            position={descriptor.position}
            id={`${descriptor.neighbor}__neighbor__${system.systemName}`}
            style={computeHandleStyle(descriptor.offset, descriptor.position)}
            className={[
              "!h-2 !w-2",
              descriptor.role === "export"
                ? "!bg-rose-400"
                : descriptor.role === "import"
                ? "!bg-emerald-400"
                : "!bg-slate-400",
            ].join(" ")}
          />
        )),
      )}
      {system.upgrades && system.upgrades.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {system.upgrades
            .filter((upgrade) => upgrade.isOnline ?? true)
            .slice(0, 6)
            .map((upgrade) => (
              <UpgradeIcon
                key={`${system.systemName}-${upgrade.typeId}`}
                typeId={upgrade.typeId}
                size={32}
                alt={`${upgrade.upgradeName} icon`}
                className="h-8 w-8 rounded border border-slate-700 bg-slate-800 object-contain p-0.5"
              />
            ))}
        </div>
      )}
      {isNpcSystem && (
        <div className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-200">
          {t.npc}
        </div>
      )}
      <div className="absolute bottom-2 right-4 text-[11px] font-mono text-slate-400">
        {system.security.toFixed(2)}
      </div>
    </div>
  );
}

export const SystemNodeCard = memo(SystemNodeCardInner, (prevProps, nextProps) => {
  // Custom comparison function for better performance
  const prevData = prevProps.data;
  const nextData = nextProps.data;
  
  // Check if system data changed
  if (prevData.system !== nextData.system) {
    return false; // Re-render if system changed
  }
  
  // Check if selection changed
  if (prevData.isSelected !== nextData.isSelected) {
    return false; // Re-render if selection changed
  }
  
  // Check if stats changed
  if (prevData.stats !== nextData.stats) {
    return false; // Re-render if stats changed
  }
  
  // Check if color mode changed
  if (prevData.systemColorMode !== nextData.systemColorMode) {
    return false; // Re-render if color mode changed
  }
  
  // Check if color mode ranges changed
  if (prevData.colorModeRanges !== nextData.colorModeRanges) {
    return false; // Re-render if ranges changed
  }
  
  // Check if handles changed (shallow comparison should be fine since handles are recalculated)
  if (prevData.handles !== nextData.handles) {
    return false; // Re-render if handles changed
  }
  
  return true; // Skip re-render if nothing relevant changed
});

