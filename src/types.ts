import m from "mithril";
import type { Tx2 } from "./geom";

export interface Port extends Tx2 {
  readonly direction: "in" | "out";
}

export interface Path {
  path(t: number): Tx2;
  readonly length: number;
}

export interface TrackPiece {
  readonly view: () => m.Children;
  readonly ports: ReadonlyMap<string, Port>;
  // Parametric path from the input port to output port 0, in local coords.
  // t ∈ [0,1]. Rotation is in degrees.
  readonly paths: ReadonlyMap<string, Path>;
}
