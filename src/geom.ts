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
  dist(a: Vec2, b: Vec2): number {
    return this.hypot(this.delta(a, b));
  },
  css(v: Vec2): string {
    return `translate(${v.x}px, ${v.y}px)`;
  },
  ident() {
    return { x: 0, y: 0 };
  },
};

export interface Tx2 {
  readonly p: Vec2;
  readonly r: number; // Degrees
}

export const Tx2 = {
  multiply(a: Tx2, b: Tx2): Tx2 {
    const rad = (a.r * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const p = {
      x: a.p.x + b.p.x * cos - b.p.y * sin,
      y: a.p.y + b.p.x * sin + b.p.y * cos,
    };
    const r = normalizeRotation(a.r + b.r);
    return { p, r };
  },
  angleBetween(a: number, b: number): number {
    const diff = normalizeRotation(b - a);
    return diff > 180 ? diff - 360 : diff;
  },
  css(t: Tx2): string {
    return Vec2.css(t.p) + ` rotate(${t.r}deg)`;
  },
  translate(tx: Tx2, delta: Vec2): Tx2 {
    return { p: Vec2.add(tx.p, delta), r: tx.r };
  },
  ident() {
    return {
      p: Vec2.ident(),
      r: 0,
    };
  },
  rotate(tx: Tx2, delta: number): Tx2 {
    return { p: tx.p, r: normalizeRotation(tx.r + delta) };
  },
  dist(a: Tx2, b: Tx2): number {
    return Vec2.dist(a.p, b.p);
  },
};

function normalizeRotation(r: number): number {
  let normalized = r % 360;
  if (normalized < 0) {
    normalized += 360;
  }
  return normalized;
}
