import { useMemo, useState } from "react";

interface UpgradeIconProps {
  typeId: number;
  size?: number;
  className?: string;
  alt?: string;
}

// Paths are rooted at the built static bundle (vite `base:
// "/static/aasovtool/"`) — NOT the site root — since these files ship
// from frontend/public/icons and are collected there by collectstatic.
const ICON_BASE = "/static/aasovtool/icons/";

const UPGRADE_ICON_OVERRIDES: Record<number, string> = {
  91001: `${ICON_BASE}workforce-mecha-tooling.svg`,
  91002: `${ICON_BASE}workforce-mecha-tooling.svg`,
  91003: `${ICON_BASE}workforce-mecha-tooling.svg`,
  91004: `${ICON_BASE}power-monitoring-division.svg`,
  91005: `${ICON_BASE}power-monitoring-division.svg`,
  91006: `${ICON_BASE}power-monitoring-division.svg`,
  92011: `${ICON_BASE}stability-electric-v2.png`,
  92012: `${ICON_BASE}stability-exotic-v2.png`,
  92013: `${ICON_BASE}stability-gamma-v2.png`,
  92014: `${ICON_BASE}stability-plasma-v2.png`,
  35834: `${ICON_BASE}keepstar.png`,
  35825: `${ICON_BASE}indypark.png`,
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


