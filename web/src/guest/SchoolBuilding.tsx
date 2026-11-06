import type { CSSProperties, ReactNode } from "react";
import { buildingStage } from "../lib/buildingStage";
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
type Pt = [number, number, number];

const BY_TITLE: Record<string, PartKey> = {
  Dach: "roof",
  Rohbau: "shell",
  Fenster: "windows",
  Möbel: "furniture",
  Sanitär: "washrooms",
  Elektro: "electrics",
};

function tradeFor(trades: BuildingTrade[], key: PartKey) {
  return trades.find((t) => t.copyKey === key || BY_TITLE[t.title] === key);
}

function unit(trade: BuildingTrade | undefined) {
  return Math.max(0, Math.min(100, trade?.percent ?? 0)) / 100;
}

/** Isometric, y down. Depth runs up-right so the right wall stays visible. */
function iso(x: number, y: number, z: number) {
  const X = (x + z) * 0.866 + 48;
  const Y = y + (x - z) * 0.5 + 4;
  return `${X.toFixed(1)},${Y.toFixed(1)}`;
}

function poly(pts: Pt[]) {
  return pts.map(([x, y, z]) => iso(x, y, z)).join(" ");
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
  const roofT = tradeFor(trades, "roof");
  const shellT = tradeFor(trades, "shell");
  const winT = tradeFor(trades, "windows");
  const furnT = tradeFor(trades, "furniture");
  const washT = tradeFor(trades, "washrooms");
  const powerT = tradeFor(trades, "electrics");
  const roof = unit(roofT);
  const shell = unit(shellT);
  const windows = unit(winT);
  const furniture = unit(furnT);
  const wash = unit(washT);
  const power = unit(powerT);
  const style = {
    "--roof": roof,
    "--shell": shell,
    "--windows": windows,
    "--furniture": furniture,
    "--wash": wash,
    "--power": power,
  } as CSSProperties;

  const front: Pt[] = [[0, 96, 0], [200, 96, 0], [200, 250, 0], [0, 250, 0]];
  const side: Pt[] = [[200, 96, 0], [200, 96, 120], [200, 250, 120], [200, 250, 0]];
  const gable: Pt[] = [[200, 96, -6], [200, 36, 60], [200, 96, 126]];
  const slopeFront: Pt[] = [[-18, 34, 60], [218, 34, 60], [218, 100, -16], [-18, 100, -16]];
  const slopeBack: Pt[] = [[-18, 34, 60], [218, 34, 60], [218, 100, 136], [-18, 100, 136]];
  const annexFront: Pt[] = [[-78, 150, 8], [-6, 150, 8], [-6, 250, 8], [-78, 250, 8]];
  const annexSide: Pt[] = [[-6, 150, 8], [-6, 150, 70], [-6, 250, 70], [-6, 250, 8]];
  const annexRoof: Pt[] = [[-88, 132, 39], [-2, 132, 39], [-2, 156, 4], [-88, 156, 4]];

  return (
    <figure className={`school-building is-${variant}`} style={style}>
      <div className="house-card">
        <svg className="house-iso" viewBox="30 70 430 340" role="img" aria-hidden="true">
          <defs>
            <linearGradient id="stucco" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fffaf3" />
              <stop offset="0.72" stopColor="#f3e6d2" />
              <stop offset="0.72" stopColor="#e2b15a" />
              <stop offset="1" stopColor="#b52a2e" />
            </linearGradient>
            <linearGradient id="stucco-side" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e7d7c2" />
              <stop offset="0.72" stopColor="#cbb89a" />
              <stop offset="0.72" stopColor="#a67c3d" />
              <stop offset="1" stopColor="#8e2228" />
            </linearGradient>
            <linearGradient id="tiles" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffd27a" />
              <stop offset="0.45" stopColor="#f6911f" />
              <stop offset="1" stopColor="#c45c12" />
            </linearGradient>
            <linearGradient id="tiles-back" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#e08a22" />
              <stop offset="1" stopColor="#9a4a10" />
            </linearGradient>
            <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f7fbff" />
              <stop offset="0.4" stopColor="#b9d4e4" />
              <stop offset="1" stopColor="#6f93a8" />
            </linearGradient>
            <pattern id="tile-lines" width="22" height="12" patternUnits="userSpaceOnUse">
              <path d="M0 12 H22 M11 0 V12" stroke="#231f20" strokeWidth="0.6" opacity="0.28" />
            </pattern>
            <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="10" stdDeviation="8" floodColor="#000" floodOpacity="0.35" />
            </filter>
          </defs>
          <rect width="640" height="420" fill="#1c191a" />
          <ellipse cx="230" cy="330" rx="150" ry="18" fill="#000" opacity="0.4" />

          <polygon points={poly(slopeBack)} fill="#cfc6ba" />
          <polygon points={poly(slopeBack)} fill="url(#tiles-back)" opacity={roof} />

          <polygon points={poly(side)} fill="#d9d1c4" />
          <polygon points={poly(side)} fill="url(#stucco-side)" opacity={shell} />
          <polygon points={poly(gable)} fill="#e4dccf" />
          <polygon points={poly(gable)} fill="#f1e2cc" opacity={shell} />

          <polygon points={poly(annexSide)} fill="#d4cdc2" />
          <polygon points={poly(annexSide)} fill="#d5e0e4" opacity={wash} />
          <polygon points={poly(annexFront)} fill="#e8e2d8" />
          <polygon points={poly(annexFront)} fill="#f4f7f8" opacity={wash} />
          <polygon points={poly(annexRoof)} fill="#cfc6ba" />
          <polygon points={poly(annexRoof)} fill="#b52a2e" opacity={wash} />

          <polygon points={poly(front)} fill="#efeae2" />
          <polygon points={poly(front)} fill="url(#stucco)" opacity={shell} />

          {[0, 1, 2].map((i) => (
            <SideWindow key={i} i={i} glass={windows} light={power} />
          ))}

          <polygon points={poly(slopeFront)} fill="#e7e0d4" />
          <polygon points={poly(slopeFront)} fill="url(#tiles)" opacity={roof} />
          <polygon points={poly(slopeFront)} fill="url(#tile-lines)" opacity={roof} />
          {roofT?.photoUrl && roof > 0.85 && (
            <image href={assetUrl(roofT.photoUrl)} x="150" y="40" width="280" height="90" preserveAspectRatio="xMidYMid slice" opacity="0.35" />
          )}

          {[0, 1, 2, 3].map((i) => (
            <FrontWindow key={i} i={i} glass={windows} furniture={furniture} light={power} />
          ))}
          <Door progress={shell} />
          <Chimney />
          {[0, 1, 2, 3, 4].map((i) => (
            <Lamp key={i} i={i} on={power} />
          ))}
        </svg>
      </div>
      <ul className="bldg-legend">
        {trades.map((trade) => (
          <li key={trade.id}>
            <button type="button" className={`is-${buildingStage(trade.percent)}`} onClick={() => onOpen?.(trade.id)}>
              <i aria-hidden="true" />
              <span>{nameOf(trade)}</span>
              <strong>{trade.percent}%</strong>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function FrontWindow({ i, glass, furniture, light }: { i: number; glass: number; furniture: number; light: number }) {
  const x = 16 + i * 44;
  const frame: Pt[] = [[x, 118, 1], [x + 34, 118, 1], [x + 34, 168, 1], [x, 168, 1]];
  const pane: Pt[] = [[x + 4, 124, 2], [x + 30, 124, 2], [x + 30, 164, 2], [x + 4, 164, 2]];
  const sill: Pt[] = [[x + 6, 154, 3], [x + 28, 154, 3], [x + 28, 160, 3], [x + 6, 160, 3]];
  return (
    <g>
      <polygon points={poly(frame)} fill="#231f20" />
      <polygon points={poly(pane)} fill="#3c4650" />
      <polygon points={poly(pane)} fill="url(#glass)" opacity={glass} />
      <polygon points={poly(sill)} fill="#f6911f" opacity={furniture} />
      <polygon points={poly(pane)} fill="#ffe1a3" opacity={light * 0.45} />
    </g>
  );
}

function SideWindow({ i, glass, light }: { i: number; glass: number; light: number }) {
  const z = 18 + i * 32;
  const frame: Pt[] = [[201, 124, z], [201, 124, z + 24], [201, 164, z + 24], [201, 164, z]];
  const pane: Pt[] = [[202, 130, z + 3], [202, 130, z + 21], [202, 158, z + 21], [202, 158, z + 3]];
  return (
    <g>
      <polygon points={poly(frame)} fill="#231f20" />
      <polygon points={poly(pane)} fill="#3c4650" />
      <polygon points={poly(pane)} fill="url(#glass)" opacity={glass} />
      <polygon points={poly(pane)} fill="#ffe1a3" opacity={light * 0.35} />
    </g>
  );
}

function Door({ progress }: { progress: number }) {
  const frame: Pt[] = [[84, 188, 2], [116, 188, 2], [116, 248, 2], [84, 248, 2]];
  return (
    <g>
      <polygon points={poly(frame)} fill="#231f20" />
      <polygon points={poly(frame)} fill="#b52a2e" opacity={progress} />
      <polygon points={poly([[108, 214, 3], [112, 214, 3], [112, 220, 3], [108, 220, 3]])} fill="#f6911f" opacity={0.4 + progress * 0.6} />
    </g>
  );
}

function Chimney() {
  const front: Pt[] = [[150, 8, 48], [172, 8, 48], [172, 40, 48], [150, 40, 48]];
  const side: Pt[] = [[172, 8, 48], [172, 8, 68], [172, 40, 68], [172, 40, 48]];
  return (
    <g opacity={0.35}>
      <polygon points={poly(side)} fill="#8e2228" />
      <polygon points={poly(front)} fill="#b52a2e" />
    </g>
  );
}

function Lamp({ i, on }: { i: number; on: number }) {
  const x = 24 + i * 38;
  const [X, Y] = iso(x, 104, -8).split(",").map(Number);
  return (
    <g>
      <circle cx={X} cy={Y} r="4" fill="#2a2628" />
      <circle cx={X} cy={Y} r="10" fill="#f6911f" opacity={on * 0.55} />
      <circle cx={X} cy={Y} r="3.5" fill="#fff4d2" opacity={on} />
    </g>
  );
}
