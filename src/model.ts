import type { Draft } from "immer";
import type { Tx2 } from "./geom";
import type { trackRegistry } from "./track_registry";

// This is the shape of the state that defines the tracks - this is what is
// undo/re-doable and defines the shape of the track precisely.
export interface GameState {
  readonly rootTrackNodes: readonly RootTrackNode[]; // Undo-able list of root track nodes.
  readonly trains: readonly (RailedTrain | DerailedTrain)[]; // A list of trains that live inside this workspace.
  readonly selectedId: string | null; // The ID of the currently selected track or train, or null - transient - not persisted in any way.
}

export interface TrackNode {
  readonly id: string; // A globally unique ID for this track - must be unique across sessions.
  readonly kind: keyof typeof trackRegistry; // The type of track this is, which determines its shape.
  readonly flipped: boolean; // Whether this track is flipped across the horizontal axis.
  readonly dockedNodes: Record<string, TrackNode>; // A list of track nodes that are docked to this track, keyed by the ID of the port they are attached to.
}

export interface RootTrackNode extends TrackNode {
  readonly tx: Tx2; // The absolute position of this track in the workspace.
}

export interface DerailedTrain {
  readonly kind: "derailed";
  readonly id: string; // Unique ID for this train.
  readonly tx: Tx2; // The absolute position of this train in the workspace.
}

export interface RailedTrain {
  readonly kind: "railed";
  readonly id: string; // A unique id for this train.
  readonly trackNodeId: string; // The ID of the track node that this train is currently on.
  readonly pathName: string; // The ID of the path that this train is currently on (which determines how it moves along the track).
  readonly t: number; // The progress through this piece's path.
  readonly reverse: boolean; // Whether the train is facing forwards of backwards on the track node.
  readonly velocity: number;
}

export type Train = DerailedTrain | RailedTrain;

export function uuid(): string {
  return crypto.randomUUID();
}

export function createEmptyState(): GameState {
  return {
    rootTrackNodes: [],
    trains: [],
    selectedId: null,
  };
}

export function findTrackNodeById(
  state: GameState,
  id: string,
):
  | {
      node: Draft<RootTrackNode | TrackNode>;
      parent?: { node: TrackNode; port: string };
    }
  | undefined {
  for (const node of state.rootTrackNodes) {
    if (node.id === id) {
      return { node };
    }
    for (const [portKey, dockedNode] of Object.entries(node.dockedNodes)) {
      const found = findTrackNodeByIdRecursive(dockedNode, id, {
        node,
        port: portKey,
      });
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

function findTrackNodeByIdRecursive(
  node: TrackNode,
  id: string,
  parent: { node: TrackNode; port: string },
):
  | {
      node: Draft<RootTrackNode | TrackNode>;
      parent: { node: TrackNode; port: string };
    }
  | undefined {
  if (node.id === id) {
    return { node, parent };
  }
  for (const [key, dockedNode] of Object.entries(node.dockedNodes)) {
    const found = findTrackNodeByIdRecursive(dockedNode, id, {
      node,
      port: key,
    });
    if (found) {
      return found;
    }
  }
  return undefined;
}
