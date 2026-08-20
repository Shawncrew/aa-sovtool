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

// Workforce Mecha-Tooling, Power Monitoring Division, Exploration Detector,
// and Exotic Stability Generator now use their real (ESI-verified) type
// IDs, which resolve to official EVE icons — no local override needed.
// Electric/Gamma/Plasma Stability Generator IDs below are still the
// unverified placeholder IDs from the original bundled catalog (no live
// hub with those installed has been observed yet to confirm the real
// ones), so they keep local artwork until we can confirm real IDs.
const UPGRADE_ICON_OVERRIDES: Record<number, string> = {
  92011: `${ICON_BASE}stability-electric-v2.png`,
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


