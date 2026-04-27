export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const Vec2 = {
  add(a: Vec2, b: Vec2): Vec2 {
    return {
      x: a.x + b.x,
      y: a.y + b.y,
    };
  },
  delta(a: Vec2, b: Vec2): Vec2 {
    return {
      x: b.x - a.x,
      y: b.y - a.y,
    };
  },
  hypot(v: Vec2): number {
    return Math.hypot(v.x, v.y);
  },
  distance(a: Vec2, b: Vec2): number {
    return this.hypot(this.delta(a, b));
  },
};
