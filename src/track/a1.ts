import m from "mithril";
import type { TrackPiece } from "../types";
import {
  BODY_H,
  FILL_COLOR,
  KNOB_OVERLAP,
  KNOB_R,
  MID_Y,
  STALK_L,
  STALK_W,
  STRAIGHT_BODY_W as BODY_W,
  STROKE_WIDTH,
} from "./common";
import { Tx2 } from "../geom";

const STALK_TOP = MID_Y - STALK_W / 2;
const STALK_BOTTOM = MID_Y + STALK_W / 2;
const KNOB_CENTRE_X = BODY_W + STALK_L;
const KNOB_MAX_X = KNOB_CENTRE_X + KNOB_R;

// Build the outline clockwise from top-left of the body.
// Female end on the left (cut in), male end on the right (bulge out).
const d = [
  `M 0,0`,
  `H ${BODY_W}`,

  // Male connector on the right
  `V ${STALK_TOP}`,
  `H ${KNOB_CENTRE_X - KNOB_OVERLAP}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 1 ${KNOB_CENTRE_X - KNOB_OVERLAP},${STALK_BOTTOM}`,
  `H ${BODY_W}`,
  `V ${BODY_H}`,

  `H 0`,

  // Female connector on the left (traced bottom-up, CCW)
  `V ${STALK_BOTTOM}`,
  `H ${STALK_L - KNOB_OVERLAP}`,
  `A ${KNOB_R} ${KNOB_R} 0 1 0 ${STALK_L - KNOB_OVERLAP},${STALK_TOP}`,
  `H 0`,
  `Z`,
].join(" ");

// Viewport
const PAD = 2;
const VIEW_W = KNOB_MAX_X + 2 * PAD;
const VIEW_H = BODY_H + 2 * PAD;

const piece: TrackPiece = {
  view: () =>
    m(
      "svg",
      {
        viewBox: `${-PAD} ${-PAD} ${VIEW_W} ${VIEW_H}`,
        width: VIEW_W,
        height: VIEW_H,
        xmlns: "http://www.w3.org/2000/svg",
        transform: `translate(${-PAD}, ${-(MID_Y + PAD)})`,
      },
      m("path", {
        d,
        fill: FILL_COLOR,
        stroke: "currentColor",
        "stroke-width": STROKE_WIDTH,
        "stroke-linejoin": "round",
      }),
    ),
  ports: new Map([
    [
      "out",
      {
        p: { x: BODY_W, y: 0 },
        r: 0,
        direction: "out",
      },
    ],
  ]),
  paths: new Map([
    [
      "out",
      {
        length: BODY_W,
        path: (t: number): Tx2 => {
          return {
            r: 0,
            p: { x: t, y: 0 },
          };
        },
      },
    ],
  ]),
};

export default piece;
