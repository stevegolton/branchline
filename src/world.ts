import { Tx2, Vec2 } from "./geom";
import { trackRegistry } from "./track_registry";

// This is the shape of the state that defines the tracks - this is what is
// undo/re-doable and defines the shape of the track precisely.
export interface World {
  readonly generation: number;
  readonly offset: Vec2;
  readonly tracks: readonly RootTrack[]; // Undo-able list of root track nodes.
  readonly trains: readonly Locomotive[]; // A list of trains that live inside this workspace.
  readonly selectedId: string | null; // The ID of the currently selected track or train, or null - transient - not persisted in any way.
}

export interface Track {
  readonly id: string; // A globally unique ID for this track - must be unique across sessions.
  readonly kind: keyof typeof trackRegistry; // The type of track this is, which determines its shape.
  readonly flipped: boolean; // Whether this track is flipped across the horizontal axis.
  readonly dockedNodes: Record<string, Track>; // A list of track nodes that are docked to this track, keyed by the ID of the port they are attached to.
}

export interface RootTrack extends Track {
  readonly tx: Tx2; // The absolute position of this track in the workspace.
}

export interface RailedLocomotive {
  readonly id: string;
  readonly kind: "railed";
  readonly trackId: string;
  readonly pathName: string;
  readonly t: number;
  readonly reverse: boolean;
  readonly carriage?: RailedCarriage;
}

export interface RailedCarriage {
  readonly id: string;
  readonly trackId: string;
  readonly pathName: string;
  readonly t: number;
  readonly carriage?: RailedCarriage;
}

export interface DerailedLocomotive {
  readonly id: string;
  readonly kind: "derailed";
  readonly tx: Tx2;
  readonly carriage?: DerailedCarriage;
}

export interface DerailedCarriage {
  readonly id: string;
  readonly carriage?: DerailedCarriage;
}

export type Locomotive = RailedLocomotive | DerailedLocomotive;

export const emptyWorld: World = {
  generation: 0,
  offset: Vec2.identity(),
  tracks: [],
  trains: [
    {
      id: "train1",
      kind: "derailed",
      tx: Tx2.identity(),
      carriage: {
        id: "carriage1",
        carriage: {
          id: "carriage2",
        },
      },
    },
  ],
  selectedId: null,
};
