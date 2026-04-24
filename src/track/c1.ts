import m from "mithril";
import type { TrackPiece } from "../types";
import {
  BODY_H,
  CURVE_ANGLE,
  CURVE_R,
  FILL_COLOR,
  KNOB_R,
  STALK_L,
  STALK_VISIBLE,
  STALK_W,
  STROKE_WIDTH,
} from "./common";

const R_INNER = CURVE_R - BODY_H / 2;
const R_OUTER = CURVE_R + BODY_H / 2;
const R_STALK_INNER = CURVE_R - STALK_W / 2;
const R_STALK_OUTER = CURVE_R + STALK_W / 2;

// ─── Geometry ───────────────────────────────────────────────────────
// Curve centre at (0, -CURVE_R). Female end at θ=0, male at θ=CURVE_ANGLE.
const CY = -CURVE_R;

const pt = (r: number, theta: number) => ({
  x: r * Math.sin(theta),
  y: CY + r * Math.cos(theta),
});

const fmt = (p: { x: number; y: number }) =>
  `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

// `stalkDir`: +1 = stalk extends outward from body (male, knob bulges out);
//             -1 is unused — female socket also uses +1, but the stalks
//             extend INTO the body, which we handle by flipping the tangent
//             sign at the call site.
//
// Simpler: `outward` means "direction stalk walls run from the end edge".
// Male: outward = away from piece (+1 at male θ).
// Female: outward = into piece (which at θ=0 is +x, same as male tangent).
const endGeom = (theta: number, stalkDirSign: 1 | -1) => {
  // Tangent along centreline, direction controlled by stalkDirSign
  const tx = stalkDirSign * Math.cos(theta);
  const ty = stalkDirSign * -Math.sin(theta);
  // Radial direction (outward from curve centre)
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

// Male: stalk extends away from body (+1 means along increasing-θ direction,
// which past the male end is outward from the piece).
const male = endGeom(CURVE_ANGLE, +1);
// Female: stalk extends INTO the body. At θ=0 the +tangent direction is +x,
// which points into the body — so +1 here also gives us the right direction.
const female = endGeom(0, +1);

// ─── Path ───────────────────────────────────────────────────────────
const d = [
  `M ${fmt(female.outerCorner)}`,
  // Outer arc female→male
  `A ${R_OUTER} ${R_OUTER} 0 0 0 ${fmt(male.outerCorner)}`,

  // Male end edge + knob (bulges outward)
  `L ${fmt(male.stalkOuter)}`,
  `L ${fmt(male.junctionOuter)}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 0 ${fmt(male.junctionInner)}`,
  `L ${fmt(male.stalkInner)}`,
  `L ${fmt(male.innerCorner)}`,

  // Inner arc male→female
  `A ${R_INNER} ${R_INNER} 0 0 1 ${fmt(female.innerCorner)}`,

  // Female end edge + socket (cuts inward)
  `L ${fmt(female.stalkInner)}`,
  `L ${fmt(female.junctionInner)}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 1 ${fmt(female.junctionOuter)}`,
  `L ${fmt(female.stalkOuter)}`,

  `Z`,
].join(" ");

// ─── Viewport ───────────────────────────────────────────────────────
const femaleKnobCentre = { x: STALK_L, y: 0 };
const maleKnobCentre = {
  x: CURVE_R * Math.sin(CURVE_ANGLE) + STALK_L * Math.cos(CURVE_ANGLE),
  y: CY + CURVE_R * Math.cos(CURVE_ANGLE) - STALK_L * Math.sin(CURVE_ANGLE),
};

// Socket/plug *openings* at the body edge (centreline points).
// These are where mating pieces actually meet visually.
const femaleOpening = { x: 0, y: 0 };
const maleOpening = {
  x: CURVE_R * Math.sin(CURVE_ANGLE),
  y: CY + CURVE_R * Math.cos(CURVE_ANGLE),
};

const extentPts = [
  female.outerCorner,
  female.innerCorner,
  female.junctionOuter,
  female.junctionInner,
  male.outerCorner,
  male.innerCorner,
  male.junctionOuter,
  male.junctionInner,
  femaleKnobCentre,
  maleKnobCentre,
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

// ─── Component ──────────────────────────────────────────────────────
const piece: TrackPiece = {
  view: () =>
    m(
      "svg",
      {
        viewBox: `${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}`,
        width: VIEW_W,
        height: VIEW_H,
        xmlns: "http://www.w3.org/2000/svg",
        transform: `translate(${-(femaleOpening.x - VIEW_X)}, ${-(femaleOpening.y - VIEW_Y)})`,
      },
      m("path", {
        d,
        fill: FILL_COLOR,
        stroke: "currentColor",
        "stroke-width": STROKE_WIDTH,
        "stroke-linejoin": "round",
      }),
    ),
  ports: [
    {
      rotation: 0,
      direction: "in",
      offset: {
        x: 0,
        y: 0,
      },
    },
    {
      offset: { x: maleOpening.x, y: maleOpening.y },
      rotation: 360 - 45,
      direction: "out",
    },
  ],
  path: (t) => {
    const theta = CURVE_ANGLE * t;
    return {
      position: {
        x: CURVE_R * Math.sin(theta),
        y: CURVE_R * (Math.cos(theta) - 1),
      },
      rotation: (-(theta * 180) / Math.PI + 360) % 360,
    };
  },
};

export default piece;
