import m from "mithril";
import type { Vec2 } from "./geom";

export interface Port {
  readonly offset: Vec2;
  readonly rotation: number;
  readonly direction: "in" | "out";
}

export interface TrackPiece {
  readonly view: () => m.Children;
  readonly ports: readonly Port[];
}
