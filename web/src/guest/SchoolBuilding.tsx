import type { ReactNode } from "react";
import { buildingStage } from "../lib/buildingStage";
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
type Quad = [Pt, Pt, Pt, Pt];

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
function iso(x: number, y: number, z: number): [number, number] {
  return [(x + z) * 0.866 + 48, y + (x - z) * 0.5 + 4];
}

function poly(pts: Pt[]) {
  return pts.map(([x, y, z]) => iso(x, y, z).map((n) => n.toFixed(1)).join(",")).join(" ");
}

function mix(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
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
  const roof = unit(tradeFor(trades, "roof"));
  const shell = unit(tradeFor(trades, "shell"));
  const windows = unit(tradeFor(trades, "windows"));
  const furniture = unit(tradeFor(trades, "furniture"));
  const wash = unit(tradeFor(trades, "washrooms"));
  const power = unit(tradeFor(trades, "electrics"));

  const front: Quad = [[0, 96, 0], [200, 96, 0], [200, 250, 0], [0, 250, 0]];
  const side: Quad = [[200, 96, 0], [200, 96, 120], [200, 250, 120], [200, 250, 0]];
  const gable: Pt[] = [[200, 96, -6], [200, 36, 60], [200, 96, 126]];
  const slopeFront: Quad = [[-18, 36, 60], [218, 36, 60], [218, 96, -16], [-18, 96, -16]];
  const slopeBack: Quad = [[-18, 36, 60], [218, 36, 60], [218, 96, 136], [-18, 96, 136]];
  const annexFront: Quad = [[-78, 150, 8], [-6, 150, 8], [-6, 250, 8], [-78, 250, 8]];
  const annexSide: Quad = [[-6, 150, 8], [-6, 150, 70], [-6, 250, 70], [-6, 250, 8]];
  const annexRoof: Quad = [[-88, 128, 39], [-2, 128, 39], [-2, 154, 4], [-88, 154, 4]];

  return (
    <figure className={`school-building is-${variant}`}>
      <div className="house-card">
        <svg className="house-iso" viewBox="30 70 430 340" role="img" aria-hidden="true">
          <rect width="640" height="420" fill="#1c191a" />
          <Mesh quad={slopeBack} progress={roof} fill="#c45c12" />
          <Mesh quad={side} progress={shell} fill="#e7d3b0" />
          <Mesh pts={gable} progress={shell} fill="#f3e6d0" />
          <Mesh quad={annexSide} progress={wash} fill="#d5e0e4" />
          <Mesh quad={annexFront} progress={wash} fill="#f4f7f8" />
          <Mesh quad={annexRoof} progress={wash} fill="#b52a2e" />
          <Mesh quad={front} progress={shell} fill="#f7f1e6" />
          <Mesh quad={slopeFront} progress={roof} fill="#f6911f" />
          {[0, 1, 2].map((i) => (
            <Pane key={`s${i}`} quad={sidePane(i)} progress={windows} fill="#9ec3d6" />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <Pane key={`f${i}`} quad={frontPane(i)} progress={windows} fill="#c5e4f2" desk={furniture} />
          ))}
          <Mesh quad={[[84, 188, 2], [116, 188, 2], [116, 248, 2], [84, 248, 2]]} progress={shell} fill="#b52a2e" grid={2} />
          <Mesh quad={[[150, 18, 48], [172, 18, 48], [172, 42, 48], [150, 42, 48]]} progress={roof} fill="#b52a2e" grid={2} />
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

function frontPane(i: number): Quad {
  const x = 16 + i * 44;
  return [[x, 118, 1.5], [x + 34, 118, 1.5], [x + 34, 168, 1.5], [x, 168, 1.5]];
}

function sidePane(i: number): Quad {
  const z = 18 + i * 32;
  return [[201, 124, z], [201, 124, z + 24], [201, 164, z + 24], [201, 164, z]];
}

/** Lower portion of a quad. 0 is empty, 1 is the whole face. Grows from the base toward the top. */
function grownQuad(quad: Quad, progress: number): Quad | null {
  if (progress <= 0) return null;
  const [a, b, c, d] = quad;
  const p = Math.min(1, progress);
  return [mix(d, a, p), mix(c, b, p), c, d];
}

function grownTri(pts: Pt[], progress: number): Pt[] | null {
  if (progress <= 0) return null;
  const [baseL, peak, baseR] = pts;
  const p = Math.min(1, progress);
  return [baseL, mix(baseL, peak, p), mix(baseR, peak, p), baseR];
}

function Mesh({ quad, pts, progress, fill, grid = 4 }: { quad?: Quad; pts?: Pt[]; progress: number; fill: string; grid?: number }) {
  const shape = quad ?? (pts as Pt[]);
  const solid = quad ? grownQuad(quad, progress) : grownTri(shape, progress);
  return (
    <g>
      {solid && <polygon points={poly(solid)} fill={fill} />}
      <polygon points={poly(shape)} fill="none" stroke="#f6911f" strokeWidth="1.35" />
      {quad && <Lattice quad={quad} lines={grid} fade={progress} />}
    </g>
  );
}

function Lattice({ quad, lines, fade }: { quad: Quad; lines: number; fade: number }) {
  const [a, b, c, d] = quad;
  const opacity = 0.85 * (1 - fade * 0.72);
  const segs: Array<[Pt, Pt]> = [];
  for (let i = 1; i < lines; i++) {
    const t = i / lines;
    segs.push([mix(a, d, t), mix(b, c, t)]);
    segs.push([mix(a, b, t), mix(d, c, t)]);
  }
  return (
    <g stroke="#f6b14a" strokeWidth="0.8" opacity={opacity}>
      {segs.map(([p, q], i) => {
        const [x1, y1] = iso(p[0], p[1], p[2]);
        const [x2, y2] = iso(q[0], q[1], q[2]);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </g>
  );
}

function Pane({ quad, progress, fill, desk = 0 }: { quad: Quad; progress: number; fill: string; desk?: number }) {
  const [a, b, c, d] = quad;
  const inset = (p: Pt, q: Pt, r: Pt) => mix(mix(p, q, 0.14), r, 0.08);
  const inner: Quad = [inset(a, b, d), inset(b, a, c), inset(c, d, b), inset(d, c, a)];
  const glass = grownQuad(inner, progress);
  const sill: Quad = [mix(a, d, 0.72), mix(b, c, 0.72), mix(b, c, 0.9), mix(a, d, 0.9)];
  return (
    <g>
      <polygon points={poly(quad)} fill="none" stroke="#f6911f" strokeWidth="1.2" />
      {glass && <polygon points={poly(glass)} fill={fill} />}
      {desk > 0 && <Mesh quad={sill} progress={desk} fill="#f6911f" grid={1} />}
    </g>
  );
}

function Lamp({ i, on }: { i: number; on: number }) {
  const [x, y] = iso(28 + i * 36, 100, -10);
  return (
    <g>
      <circle cx={x} cy={y} r="4.5" fill="none" stroke="#f6911f" strokeWidth="1.1" />
      <circle cx={x} cy={y} r="3.2" fill="#fff1c9" opacity={on} />
      <circle cx={x} cy={y} r="9" fill="#f6911f" opacity={on * 0.45} />
    </g>
  );
}
