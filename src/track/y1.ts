import m from "mithril";
import type { TrackPiece } from "../types";

// A fork piece: one female input on the left, one straight male output
// ahead, and one curved male output branching off at +45°. This is the
// geometric union of an a1 straight and a c1 45° curve that share the
// same female end — we draw both outlines overlaid rather than trying
// to fuse them into a single shape.

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
} from "./common";

const STRAIGHT_STALK_TOP = MID_Y - STALK_W / 2;
const STRAIGHT_STALK_BOTTOM = MID_Y + STALK_W / 2;
const STRAIGHT_KNOB_CENTRE_X = STRAIGHT_BODY_W + STALK_L;

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

// ─── Curve body (c1) ────────────────────────────────────────────────
// Same geometry as c1.ts. Curve bends upward so the centreline starts
// at (0, MID_Y) heading +x and ends at 45° up-right.
const R_INNER = CURVE_R - BODY_H / 2;
const R_OUTER = CURVE_R + BODY_H / 2;
const R_STALK_INNER = CURVE_R - STALK_W / 2;
const R_STALK_OUTER = CURVE_R + STALK_W / 2;
// Curve centre sits below the input line so an angle θ=0 lands on the
// female opening. We align it with the straight body's centreline, so
// the curve shares the female end with the straight.
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

const curveMale = endGeom(CURVE_ANGLE, +1);
const curveFemale = endGeom(0, +1);

const curveD = [
  `M ${fmt(curveFemale.outerCorner)}`,
  `A ${R_OUTER} ${R_OUTER} 0 0 0 ${fmt(curveMale.outerCorner)}`,
  `L ${fmt(curveMale.stalkOuter)}`,
  `L ${fmt(curveMale.junctionOuter)}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 0 ${fmt(curveMale.junctionInner)}`,
  `L ${fmt(curveMale.stalkInner)}`,
  `L ${fmt(curveMale.innerCorner)}`,
  `A ${R_INNER} ${R_INNER} 0 0 1 ${fmt(curveFemale.innerCorner)}`,
  `L ${fmt(curveFemale.stalkInner)}`,
  `L ${fmt(curveFemale.junctionInner)}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 1 ${fmt(curveFemale.junctionOuter)}`,
  `L ${fmt(curveFemale.stalkOuter)}`,
  `Z`,
].join(" ");

// ─── Port positions (in local frame, input at origin) ───────────────
// The piece's local origin is the female opening centre — same convention
// as c1. Straight body in this file is drawn with (0,0) at its top-left,
// so we translate both paths up by MID_Y so the female opening sits at
// y=0. The curve body uses CY = MID_Y - CURVE_R, which puts θ=0 at
// (0, MID_Y); after the same upward shift, the curve's female opening
// also sits at (0, 0). Good.

// Straight output port
const straightOutX = STRAIGHT_BODY_W;
const straightOutY = 0;

// Curved output port: centreline endpoint of the curve at θ=CURVE_ANGLE.
const curveOutX = CURVE_R * Math.sin(CURVE_ANGLE);
const curveOutY_beforeShift = CY + CURVE_R * Math.cos(CURVE_ANGLE);
const curveOutY = curveOutY_beforeShift - MID_Y;

// ─── Viewport ───────────────────────────────────────────────────────
// Gather all extreme points from both shapes (shifted up by MID_Y).
const shift = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - MID_Y });

const extentPts = [
  // Straight corners + stalk extents
  shift({ x: 0, y: 0 }),
  shift({ x: STRAIGHT_BODY_W, y: 0 }),
  shift({ x: STRAIGHT_BODY_W, y: BODY_H }),
  shift({ x: 0, y: BODY_H }),
  shift({ x: STRAIGHT_KNOB_CENTRE_X + KNOB_R, y: MID_Y }),
  shift({ x: -KNOB_R + (STALK_L - KNOB_OVERLAP), y: MID_Y }),
  // Curve extents
  shift(curveFemale.outerCorner),
  shift(curveFemale.innerCorner),
  shift(curveMale.outerCorner),
  shift(curveMale.innerCorner),
  shift(curveMale.junctionOuter),
  shift(curveMale.junctionInner),
  // Knob bounds for curve male end
  shift({
    x: CURVE_R * Math.sin(CURVE_ANGLE) + STALK_L * Math.cos(CURVE_ANGLE),
    y: CY + CURVE_R * Math.cos(CURVE_ANGLE) - STALK_L * Math.sin(CURVE_ANGLE),
  }),
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
      m("g", { transform: `translate(0, ${-MID_Y})` }, [
        m("path", {
          d: straightD,
          fill: FILL_COLOR,
          stroke: "currentColor",
          "stroke-width": 1.25,
          "stroke-linejoin": "round",
        }),
        m("path", {
          d: curveD,
          fill: FILL_COLOR,
          stroke: "currentColor",
          "stroke-width": 1.25,
          "stroke-linejoin": "round",
        }),
      ]),
    ),
  ports: [
    {
      offset: { x: 0, y: 0 },
      rotation: 0,
      direction: "in",
    },
    {
      offset: { x: straightOutX, y: straightOutY },
      rotation: 0,
      direction: "out",
    },
    {
      offset: { x: curveOutX, y: curveOutY },
      rotation: 360 - 45,
      direction: "out",
    },
  ],
};

export default piece;
