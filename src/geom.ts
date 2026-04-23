export type Orientation =
  | "north"
  | "north-east"
  | "east"
  | "south-east"
  | "south"
  | "south-west"
  | "west"
  | "north-west";

export function orientationToDegrees(orientation: Orientation): number {
  switch (orientation) {
    case "north":
      return 0;
    case "north-east":
      return 45;
    case "east":
      return 90;
    case "south-east":
      return 135;
    case "south":
      return 180;
    case "south-west":
      return 225;
    case "west":
      return 270;
    case "north-west":
      return 315;
  }
}

export const rotateCWMap: Record<Orientation, Orientation> = {
  north: "north-east",
  "north-east": "east",
  east: "south-east",
  "south-east": "south",
  south: "south-west",
  "south-west": "west",
  west: "north-west",
  "north-west": "north",
};

export const rotateCCWMap: Record<Orientation, Orientation> = {
  north: "north-west",
  "north-west": "west",
  west: "south-west",
  "south-west": "south",
  south: "south-east",
  "south-east": "east",
  east: "north-east",
  "north-east": "north",
};

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

const ORIENTATIONS: readonly Orientation[] = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
];

export function rotateOrientation(
  orientation: Orientation,
  by: Orientation,
): Orientation {
  const a = ORIENTATIONS.indexOf(orientation);
  const b = ORIENTATIONS.indexOf(by);
  return ORIENTATIONS[(a + b) % 8];
}

export function oppositeOrientation(orientation: Orientation): Orientation {
  const i = ORIENTATIONS.indexOf(orientation);
  return ORIENTATIONS[(i + 4) % 8];
}

export function rotateVec2(v: Vec2, orientation: Orientation): Vec2 {
  const rad = (orientationToDegrees(orientation) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
  };
}
