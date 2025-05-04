import { describe, expect, it } from "@jest/globals";
import { Tx2, Vec2 } from "./geom.ts";

describe("Vec2", () => {
  it("adds two vectors", () => {
    expect(Vec2.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  });

  it("handles negative components when adding", () => {
    expect(Vec2.add({ x: -1, y: 5 }, { x: 4, y: -2 })).toEqual({ x: 3, y: 3 });
  });

  it("computes the delta from a to b", () => {
    expect(Vec2.delta({ x: 1, y: 2 }, { x: 4, y: 6 })).toEqual({ x: 3, y: 4 });
  });

  it("returns a zero delta for identical points", () => {
    expect(Vec2.delta({ x: 7, y: -3 }, { x: 7, y: -3 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("computes hypot for a 3-4-5 triangle", () => {
    expect(Vec2.hypot({ x: 3, y: 4 })).toBe(5);
  });

  it("computes distance between two points", () => {
    expect(Vec2.dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(Vec2.dist({ x: 1, y: 1 }, { x: 4, y: 5 })).toBe(5);
  });

  it("returns 0 distance between identical points", () => {
    expect(Vec2.dist({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it("formats a CSS translate string", () => {
    expect(Vec2.css({ x: 10, y: -5 })).toBe("translate(10px, -5px)");
  });

  it("returns the identity vector", () => {
    expect(Vec2.identity()).toEqual({ x: 0, y: 0 });
  });
});

describe("Tx2", () => {
  const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

  it("returns the identity transform", () => {
    expect(Tx2.identity()).toEqual({ p: { x: 0, y: 0 }, r: 0 });
  });

  describe("multiply", () => {
    it("is identity when both operands are identity", () => {
      expect(Tx2.multiply(Tx2.identity(), Tx2.identity())).toEqual({
        p: { x: 0, y: 0 },
        r: 0,
      });
    });

    it("translates without rotation when a.r is 0", () => {
      const result = Tx2.multiply(
        { p: { x: 1, y: 2 }, r: 0 },
        { p: { x: 3, y: 4 }, r: 0 },
      );
      expect(result).toEqual({ p: { x: 4, y: 6 }, r: 0 });
    });

    it("rotates b by a.r before translating", () => {
      const result = Tx2.multiply(
        { p: { x: 0, y: 0 }, r: 90 },
        { p: { x: 1, y: 0 }, r: 0 },
      );
      expect(close(result.p.x, 0)).toBe(true);
      expect(close(result.p.y, 1)).toBe(true);
      expect(result.r).toBe(90);
    });

    it("sums rotations and normalizes them into [0, 360)", () => {
      const result = Tx2.multiply(
        { p: { x: 0, y: 0 }, r: 270 },
        { p: { x: 0, y: 0 }, r: 180 },
      );
      expect(result.r).toBe(90);
    });
  });

  describe("angleBetween", () => {
    it("returns the signed shortest angle", () => {
      expect(Tx2.angleBetween(10, 30)).toBe(20);
      expect(Tx2.angleBetween(30, 10)).toBe(-20);
    });

    it("wraps across the 0/360 boundary", () => {
      expect(Tx2.angleBetween(350, 10)).toBe(20);
      expect(Tx2.angleBetween(10, 350)).toBe(-20);
    });

    it("returns 0 for equal angles", () => {
      expect(Tx2.angleBetween(45, 45)).toBe(0);
    });

    it("handles 180 as a positive half-turn", () => {
      expect(Tx2.angleBetween(0, 180)).toBe(180);
    });
  });

  it("formats a CSS string with translate and rotate", () => {
    expect(Tx2.css({ p: { x: 10, y: 20 }, r: 45 })).toBe(
      "translate(10px, 20px) rotate(45deg)",
    );
  });

  describe("translate", () => {
    it("shifts position and preserves rotation", () => {
      expect(
        Tx2.translate({ p: { x: 1, y: 2 }, r: 30 }, { x: 4, y: 5 }),
      ).toEqual({ p: { x: 5, y: 7 }, r: 30 });
    });
  });

  describe("rotate", () => {
    it("adds to rotation and preserves position", () => {
      expect(Tx2.rotate({ p: { x: 1, y: 2 }, r: 30 }, 45)).toEqual({
        p: { x: 1, y: 2 },
        r: 75,
      });
    });

    it("normalizes rotation past 360", () => {
      expect(Tx2.rotate({ p: { x: 0, y: 0 }, r: 350 }, 30).r).toBe(20);
    });

    it("normalizes negative rotation into [0, 360)", () => {
      expect(Tx2.rotate({ p: { x: 0, y: 0 }, r: 10 }, -30).r).toBe(340);
    });
  });

  describe("dist", () => {
    it("measures distance between transform positions, ignoring rotation", () => {
      expect(
        Tx2.dist({ p: { x: 0, y: 0 }, r: 90 }, { p: { x: 3, y: 4 }, r: 270 }),
      ).toBe(5);
    });
  });
});
