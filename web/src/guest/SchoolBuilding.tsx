import { useId, type ReactNode } from "react";
import { buildingStage, type BuildStage } from "../lib/buildingStage";
import { assetUrl } from "../lib/api";
import "./schoolBuilding.css";

export type BuildingTrade = {
  id: string;
  title: string;
  copyKey?: string | null;
  percent: number;
  photoUrl?: string | null;
};

const PARTS = ["roof", "shell", "windows", "furniture", "washrooms", "electrics"] as const;
type PartKey = (typeof PARTS)[number];

const BY_TITLE: Record<string, PartKey> = {
  Dach: "roof",
  Rohbau: "shell",
  Fenster: "windows",
  Möbel: "furniture",
  Sanitär: "washrooms",
  Elektro: "electrics",
};

type Box = { x: number; y: number; w: number; h: number };

function tradeFor(trades: BuildingTrade[], key: PartKey) {
  return trades.find((t) => t.copyKey === key || BY_TITLE[t.title] === key);
}

function Fill({ id, box, percent, children }: { id: string; box: Box; percent: number; children: ReactNode }) {
  const p = Math.max(0, Math.min(100, percent)) / 100;
  if (p <= 0) return null;
  const y = box.y + box.h * (1 - p);
  const h = Math.max(0.01, box.h * p);
  return (
    <>
      <clipPath id={id}>
        <rect x={box.x} y={y} width={box.w} height={h} />
      </clipPath>
      <g clipPath={`url(#${id})`}>{children}</g>
    </>
  );
}

export function SchoolBuilding({
  trades,
  nameOf,
  onOpen,
  variant = "phone",
}: {
  trades: BuildingTrade[];
  nameOf: (trade: BuildingTrade) => ReactNode;
  onOpen?: (id: string) => void;
  variant?: "phone" | "room";
}) {
  const uid = useId().replace(/:/g, "");
  const part = (key: PartKey) => {
    const trade = tradeFor(trades, key);
    const percent = trade?.percent ?? 0;
    return { trade, percent, stage: buildingStage(percent) as BuildStage };
  };
  const roof = part("roof");
  const shell = part("shell");
  const windows = part("windows");
  const furniture = part("furniture");
  const wash = part("washrooms");
  const power = part("electrics");

  return (
    <figure className={`school-building is-${variant}`}>
      <svg viewBox="0 0 640 400" role="img" aria-hidden="true">
        <defs>
          <pattern id={`${uid}-hatch`} width="8" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 8 L8 0" stroke="#f6911f" strokeWidth="1.2" />
          </pattern>
          <pattern id={`${uid}-tiles`} width="18" height="10" patternUnits="userSpaceOnUse">
            <path d="M0 10 H18 M9 0 V10" stroke="#231f20" strokeWidth="0.8" opacity="0.35" />
          </pattern>
          <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff6e8" />
            <stop offset="1" stopColor="#f6911f" />
          </linearGradient>
          <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#fff4d2" />
            <stop offset="0.45" stopColor="#f6911f" />
            <stop offset="1" stopColor="#f6911f" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width="640" height="400" fill="#2a2627" />
        <ellipse cx="320" cy="362" rx="270" ry="16" fill="#231f20" />

        <g className={`bldg-part is-${wash.stage}`}>
          <rect className="bldg-ghost" x="46" y="214" width="96" height="136" rx="4" />
          <Fill id={`${uid}-wash`} box={{ x: 46, y: 214, w: 96, h: 136 }} percent={wash.percent}>
            <rect x="46" y="214" width="96" height="136" rx="4" fill={wash.stage === "sketch" ? `url(#${uid}-hatch)` : "#b52a2e"} />
            <rect x="78" y="286" width="28" height="64" fill="#231f20" />
            <circle cx="94" cy="252" r="10" fill="#f6911f" />
            {wash.trade?.photoUrl && wash.percent >= 100 && (
              <image href={assetUrl(wash.trade.photoUrl)} x="46" y="214" width="96" height="136" preserveAspectRatio="xMidYMid slice" opacity="0.85" />
            )}
          </Fill>
        </g>

        <g className={`bldg-part is-${shell.stage}`}>
          <rect className="bldg-ghost" x="140" y="168" width="360" height="184" />
          <Fill id={`${uid}-shell`} box={{ x: 140, y: 168, w: 360, h: 184 }} percent={shell.percent}>
            <rect x="140" y="168" width="360" height="184" fill={shell.stage === "sketch" ? `url(#${uid}-hatch)` : "#393536"} />
            <rect x="470" y="168" width="30" height="184" fill="#535051" />
            <rect x="292" y="270" width="56" height="82" fill="#231f20" />
            {shell.trade?.photoUrl && (
              <image href={assetUrl(shell.trade.photoUrl)} x="140" y="168" width="360" height="184" preserveAspectRatio="xMidYMid slice" opacity={shell.percent >= 100 ? 0.8 : 0.35} />
            )}
          </Fill>
        </g>

        <g className={`bldg-part is-${furniture.stage}`}>
          <g className="bldg-ghost">
            <rect x="176" y="286" width="70" height="36" />
            <rect x="286" y="286" width="70" height="36" />
            <rect x="396" y="286" width="70" height="36" />
          </g>
          <Fill id={`${uid}-furn`} box={{ x: 168, y: 270, w: 310, h: 70 }} percent={furniture.percent}>
            {furniture.stage === "sketch" ? (
              <rect x="168" y="270" width="310" height="70" fill={`url(#${uid}-hatch)`} />
            ) : (
              <>
                <rect x="176" y="286" width="70" height="28" rx="2" fill="#f6911f" />
                <rect x="286" y="286" width="70" height="28" rx="2" fill="#f6911f" />
                <rect x="396" y="286" width="70" height="28" rx="2" fill="#c2272d" />
                <rect x="198" y="314" width="8" height="16" fill="#231f20" />
                <rect x="308" y="314" width="8" height="16" fill="#231f20" />
                <rect x="418" y="314" width="8" height="16" fill="#231f20" />
              </>
            )}
            {furniture.trade?.photoUrl && furniture.percent >= 100 && (
              <image href={assetUrl(furniture.trade.photoUrl)} x="168" y="270" width="310" height="70" preserveAspectRatio="xMidYMid slice" opacity="0.75" />
            )}
          </Fill>
        </g>

        <g className={`bldg-part is-${windows.stage}`}>
          {[168, 248, 328, 408].map((x) => (
            <rect key={x} className="bldg-ghost" x={x} y="196" width="52" height="62" />
          ))}
          <Fill id={`${uid}-win`} box={{ x: 160, y: 190, w: 310, h: 76 }} percent={windows.percent}>
            {[168, 248, 328, 408].map((x) => (
              <g key={x}>
                <rect x={x} y="196" width="52" height="62" fill={windows.stage === "sketch" ? `url(#${uid}-hatch)` : `url(#${uid}-glass)`} />
                <path d={`M${x + 26} 196 V258 M${x} 227 H${x + 52}`} stroke="#231f20" strokeWidth="2" />
              </g>
            ))}
            {windows.trade?.photoUrl && windows.percent >= 100 &&
              [168, 248, 328, 408].map((x) => (
                <image key={x} href={assetUrl(windows.trade?.photoUrl)} x={x} y="196" width="52" height="62" preserveAspectRatio="xMidYMid slice" opacity="0.8" />
              ))}
          </Fill>
        </g>

        <g className={`bldg-part is-${roof.stage}`}>
          <path className="bldg-ghost" d="M118 176 L320 46 L522 176 Z" />
          <Fill id={`${uid}-roof`} box={{ x: 110, y: 40, w: 420, h: 140 }} percent={roof.percent}>
            <path d="M118 176 L320 46 L522 176 Z" fill={roof.stage === "sketch" ? `url(#${uid}-hatch)` : "#f6911f"} />
            {roof.stage !== "sketch" && <path d="M118 176 L320 46 L522 176 Z" fill={`url(#${uid}-tiles)`} />}
            {roof.trade?.photoUrl && (
              <image href={assetUrl(roof.trade.photoUrl)} x="118" y="46" width="404" height="130" preserveAspectRatio="xMidYMid slice" opacity={roof.percent >= 100 ? 0.9 : 0.4} />
            )}
          </Fill>
          <circle cx="320" cy="46" r="6" fill={roof.percent > 0 ? "#f6911f" : "none"} stroke="#c1c1c1" />
        </g>

        <g className={`bldg-part is-${power.stage}`}>
          {[180, 250, 320, 390, 460].map((x) => (
            <circle key={x} className="bldg-ghost" cx={x} cy="168" r="7" />
          ))}
          <Fill id={`${uid}-power`} box={{ x: 160, y: 140, w: 420, h: 50 }} percent={power.percent}>
            <path d="M170 168 H480" stroke="#f6911f" strokeWidth="2" />
            {[180, 250, 320, 390, 460].map((x) => (
              <g key={x}>
                <circle cx={x} cy="168" r="16" fill={`url(#${uid}-glow)`} />
                <circle cx={x} cy="168" r="5" fill="#fff6e8" />
              </g>
            ))}
            {power.trade?.photoUrl && power.percent >= 100 && (
              <image href={assetUrl(power.trade.photoUrl)} x="160" y="148" width="320" height="36" preserveAspectRatio="xMidYMid slice" opacity="0.55" />
            )}
          </Fill>
        </g>
      </svg>
      <ul className="bldg-legend">
        {trades.map((trade) => {
          const stage = buildingStage(trade.percent);
          return (
            <li key={trade.id}>
              <button type="button" className={`is-${stage}`} onClick={() => onOpen?.(trade.id)}>
                <i aria-hidden="true" />
                <span>{nameOf(trade)}</span>
                <strong>{trade.percent}%</strong>
              </button>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
