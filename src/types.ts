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
  // Parametric path from the input port to output port 0, in local coords.
  // t ∈ [0,1]. Rotation is in degrees. Optional — pieces without a path
  // are skipped by the simulator.
  readonly path?: (t: number) => { position: Vec2; rotation: number };
}
