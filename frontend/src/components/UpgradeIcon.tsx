import { useMemo, useState } from "react";

interface UpgradeIconProps {
  typeId: number;
  size?: number;
  className?: string;
  alt?: string;
}

const UPGRADE_ICON_OVERRIDES: Record<number, string> = {
  91001: "/icons/workforce-mecha-tooling.svg",
  91002: "/icons/workforce-mecha-tooling.svg",
  91003: "/icons/workforce-mecha-tooling.svg",
  91004: "/icons/power-monitoring-division.svg",
  91005: "/icons/power-monitoring-division.svg",
  91006: "/icons/power-monitoring-division.svg",
  92011: "/icons/stability-electric-v2.png",
  92012: "/icons/stability-exotic-v2.png",
  92013: "/icons/stability-gamma-v2.png",
  92014: "/icons/stability-plasma-v2.png",
  35834: "/icons/keepstar.png",
  35825: "/icons/indypark.png",
};

function buildSourceList(typeId: number, size: number): string[] {
  const sources: string[] = [];
  const override = UPGRADE_ICON_OVERRIDES[typeId];
  if (override) {
    sources.push(override);
  }
  sources.push(`https://images.evetech.net/types/${typeId}/icon?size=${size}`);
  sources.push(`https://imageserver.eveonline.com/Type/${typeId}_${size}.png`);
  return Array.from(new Set(sources));
}

export function UpgradeIcon({ typeId, size = 64, className, alt }: UpgradeIconProps) {
  const sources = useMemo(() => buildSourceList(typeId, size), [typeId, size]);
  const [index, setIndex] = useState(0);

  if (sources.length === 0) {
    return null;
  }

  const handleError = () => {
    setIndex((prev) => (prev + 1 < sources.length ? prev + 1 : prev));
  };

  return (
    <img
      src={sources[Math.min(index, sources.length - 1)]}
      onError={handleError}
      alt={alt ?? "Upgrade icon"}
      className={className}
      loading="lazy"
    />
  );
}


