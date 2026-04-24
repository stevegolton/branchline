import m from "mithril";
import type { TrackPiece } from "../types";

// Inverse fork (merge): y1 mirrored left-to-right. The shared female
// opening (y1's input) becomes y2's shared male output on the right;
// the straight's male output becomes y2's input on the left; the curve
// branch now sweeps up-left instead of up-right.
//
// We achieve this by drawing the y1 geometry unchanged and wrapping the
// whole thing in a scale(-1, 1) that mirrors across the local origin
// (which we place at the straight's right-hand male-knob end so that
// after mirroring it lands at the final input position on the left).

import {
  BODY_H,
  CURVE_ANGLE,
  CURVE_R,
  FILL_COLOR,
  KNOB_OVERLAP,
  KNOB_R,
  MID_Y,
  STALK_L,
  STALK_VISIBLE,
  STALK_W,
  STRAIGHT_BODY_W,
  STROKE_WIDTH,
} from "./common";

const STRAIGHT_STALK_TOP = MID_Y - STALK_W / 2;
const STRAIGHT_STALK_BOTTOM = MID_Y + STALK_W / 2;
const STRAIGHT_KNOB_CENTRE_X = STRAIGHT_BODY_W + STALK_L;

// y1 straight: female-left, male-right.
const straightD = [
  `M 0,0`,
  `H ${STRAIGHT_BODY_W}`,
  `V ${STRAIGHT_STALK_TOP}`,
  `H ${STRAIGHT_KNOB_CENTRE_X - KNOB_OVERLAP}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 1 ${STRAIGHT_KNOB_CENTRE_X - KNOB_OVERLAP},${STRAIGHT_STALK_BOTTOM}`,
  `H ${STRAIGHT_BODY_W}`,
  `V ${BODY_H}`,
  `H 0`,
  `V ${STRAIGHT_STALK_BOTTOM}`,
  `H ${STALK_L - KNOB_OVERLAP}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 0 ${STALK_L - KNOB_OVERLAP},${STRAIGHT_STALK_TOP}`,
  `H 0`,
  `Z`,
].join(" ");

// ─── Curve body (identical to y1) ───────────────────────────────────
const R_INNER = CURVE_R - BODY_H / 2;
const R_OUTER = CURVE_R + BODY_H / 2;
const R_STALK_INNER = CURVE_R - STALK_W / 2;
const R_STALK_OUTER = CURVE_R + STALK_W / 2;
const CY = MID_Y - CURVE_R;

const pt = (r: number, theta: number) => ({
  x: r * Math.sin(theta),
  y: CY + r * Math.cos(theta),
});

const fmt = (p: { x: number; y: number }) =>
  `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

const endGeom = (theta: number, stalkDirSign: 1 | -1) => {
  const tx = stalkDirSign * Math.cos(theta);
  const ty = stalkDirSign * -Math.sin(theta);
  const rx = Math.sin(theta);
  const ry = Math.cos(theta);
  const centreOnEdge = {
    x: CURVE_R * Math.sin(theta),
    y: CY + CURVE_R * Math.cos(theta),
  };
  const junctionCentre = {
    x: centreOnEdge.x + STALK_VISIBLE * tx,
    y: centreOnEdge.y + STALK_VISIBLE * ty,
  };
  return {
    stalkOuter: pt(R_STALK_OUTER, theta),
    stalkInner: pt(R_STALK_INNER, theta),
    junctionOuter: {
      x: junctionCentre.x + (STALK_W / 2) * rx,
      y: junctionCentre.y + (STALK_W / 2) * ry,
    },
    junctionInner: {
      x: junctionCentre.x - (STALK_W / 2) * rx,
      y: junctionCentre.y - (STALK_W / 2) * ry,
    },
    outerCorner: pt(R_OUTER, theta),
    innerCorner: pt(R_INNER, theta),
  };
};

// Far end (θ=CURVE_ANGLE): female socket. stalkDirSign=-1 so the stalk
// extends INTO the curve body rather than out of it.
const curveFar = endGeom(CURVE_ANGLE, -1);
// Base (θ=0): plain flat edge where the curve merges into the straight.
// We only need the outer/inner corner points at θ=0 — no stalk geometry.
const curveBaseOuter = pt(R_OUTER, 0);
const curveBaseInner = pt(R_INNER, 0);

const curveD = [
  // Start at the base outer corner.
  `M ${fmt(curveBaseOuter)}`,
  // Outer arc: base → far end outer corner.
  `A ${R_OUTER} ${R_OUTER} 0 0 0 ${fmt(curveFar.outerCorner)}`,
  // Far-end edge + female socket (cuts inward).
  `L ${fmt(curveFar.stalkOuter)}`,
  `L ${fmt(curveFar.junctionOuter)}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 1 ${fmt(curveFar.junctionInner)}`,
  `L ${fmt(curveFar.stalkInner)}`,
  `L ${fmt(curveFar.innerCorner)}`,
  // Inner arc back to base.
  `A ${R_INNER} ${R_INNER} 0 0 1 ${fmt(curveBaseInner)}`,
  // Close across the base (flat edge — no connector).
  `Z`,
].join(" ");

// ─── Port positions ─────────────────────────────────────────────────
// Straight keeps y1's orientation (female-left at x=0, male-right at
// x=STRAIGHT_BODY_W) — our local origin is at the female opening.
// Only the curve branch is mirrored so it runs up-left from the straight's
// male end rather than up-right from the female end.

const inX = 0;
const inY = 0;

const junctionOutX = STRAIGHT_BODY_W;
const junctionOutY = 0;

// Curve's far end in y1 is at (CURVE_R·sin(a), CY + CURVE_R·cos(a)).
// In y2 we attach the curve's base at the straight's male end
// (STRAIGHT_BODY_W, MID_Y) and run it up-left. So we mirror the curve
// x-coords around x = STRAIGHT_BODY_W / 2 ... no, around the junction
// point: curve pre-mirror base is at x=0, we want it at x=STRAIGHT_BODY_W.
// Translate-then-mirror: x' = STRAIGHT_BODY_W - x. The y stays the same
// (post-shift).
const curveFarRaw = {
  x: CURVE_R * Math.sin(CURVE_ANGLE),
  y: CY + CURVE_R * Math.cos(CURVE_ANGLE),
};
const curveInX = STRAIGHT_BODY_W - curveFarRaw.x;
const curveInY = curveFarRaw.y - MID_Y;

// ─── Viewport ───────────────────────────────────────────────────────
const shift = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - MID_Y });
const mirrorCurve = (p: { x: number; y: number }) => ({
  x: STRAIGHT_BODY_W - p.x,
  y: p.y - MID_Y,
});

const extentPts = [
  // Straight body corners and knob/socket bounds (not mirrored).
  shift({ x: 0, y: 0 }),
  shift({ x: STRAIGHT_BODY_W, y: 0 }),
  shift({ x: STRAIGHT_BODY_W, y: BODY_H }),
  shift({ x: 0, y: BODY_H }),
  shift({ x: STRAIGHT_KNOB_CENTRE_X + KNOB_R, y: MID_Y }),
  shift({ x: -KNOB_R + (STALK_L - KNOB_OVERLAP), y: MID_Y }),
  // Curve extents (mirrored).
  mirrorCurve(curveBaseOuter),
  mirrorCurve(curveBaseInner),
  mirrorCurve(curveFar.outerCorner),
  mirrorCurve(curveFar.innerCorner),
  mirrorCurve(curveFar.junctionOuter),
  mirrorCurve(curveFar.junctionInner),
];

const extents = extentPts.reduce(
  (acc, p) => ({
    minX: Math.min(acc.minX, p.x - KNOB_R),
    maxX: Math.max(acc.maxX, p.x + KNOB_R),
    minY: Math.min(acc.minY, p.y - KNOB_R),
    maxY: Math.max(acc.maxY, p.y + KNOB_R),
  }),
  { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
);

const PAD = 2;
const VIEW_X = extents.minX - PAD;
const VIEW_Y = extents.minY - PAD;
const VIEW_W = extents.maxX - extents.minX + 2 * PAD;
const VIEW_H = extents.maxY - extents.minY + 2 * PAD;

// Straight group: just shift up by MID_Y so centreline lands on y=0.
const straightTransform = `translate(0, ${-MID_Y})`;
// Curve group: mirror horizontally around x=STRAIGHT_BODY_W/2 so the
// branch goes up-left from the straight's male end, then shift up by
// MID_Y. Right-to-left composition: on an input point p, SVG applies
// `translate(STRAIGHT_BODY_W, -MID_Y)` last, `scale(-1, 1)` first.
// scale(-1,1) of (x,y) = (-x, y); translate(+STRAIGHT_BODY_W, -MID_Y)
// gives (STRAIGHT_BODY_W - x, y - MID_Y). ✓
const curveTransform = `translate(${STRAIGHT_BODY_W}, ${-MID_Y}) scale(-1, 1)`;

const piece: TrackPiece = {
  view: () =>
    m(
      "svg",
      {
        viewBox: `${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`,
        width: VIEW_W,
        height: VIEW_H,
        xmlns: "http://www.w3.org/2000/svg",
        transform: `translate(${VIEW_X}, ${VIEW_Y})`,
      },
      m("g", { transform: straightTransform }, [
        m("path", {
          d: straightD,
          fill: FILL_COLOR,
          stroke: "currentColor",
          "stroke-width": STROKE_WIDTH,
          "stroke-linejoin": "round",
        }),
      ]),
      m("g", { transform: curveTransform }, [
        m("path", {
          d: curveD,
          fill: FILL_COLOR,
          stroke: "currentColor",
          "stroke-width": STROKE_WIDTH,
          "stroke-linejoin": "round",
        }),
      ]),
    ),
  ports: [
    // Female input on the left.
    { offset: { x: inX, y: inY }, rotation: 0, direction: "in" },
    // Male output at the shared junction on the right.
    {
      offset: { x: junctionOutX, y: junctionOutY },
      rotation: 0,
      direction: "out",
    },
    // Female input at the curve's far end (up-left, 225°).
    {
      offset: { x: curveInX, y: curveInY },
      rotation: 225,
      direction: "in",
    },
  ],
};

export default piece;
