// Shared dimensions for all track pieces. All real-world measurements are
// in mm; on screen we render at PX_PER_MM pixels per mm.

export const PX_PER_MM = 2;

// Visual styling shared across pieces.
export const FILL_COLOR = "white";

// Body (common across all pieces)
export const BODY_H = 32 * PX_PER_MM;
export const MID_Y = BODY_H / 2;

// Lollipop connector: stalk is the neck, knob is the overhanging circle.
export const STALK_W = 10; // neck opening width
export const STALK_L = 20; // stalk length from body to knob centre
export const KNOB_R = 11; // knob radius (must exceed STALK_W / 2 to overhang)
export const KNOB_OVERLAP = Math.sqrt(KNOB_R ** 2 - (STALK_W / 2) ** 2);
export const STALK_VISIBLE = STALK_L - KNOB_OVERLAP;

// Curved body: 45° arc with its centreline arc length equal to STRAIGHT_BODY_W.
export const CURVE_BODY_W = 80 * PX_PER_MM;
export const CURVE_ANGLE = Math.PI / 4;
export const CURVE_R = CURVE_BODY_W / CURVE_ANGLE;

// Straight body length: chosen so that two c1 curves + one a1 straight
// form a right triangle (L = R · tan(90°/2) = R).
export const STRAIGHT_BODY_W = CURVE_R;

export const STROKE_WIDTH = 2;
