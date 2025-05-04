import { produce, type Draft } from "immer";
import { Tx2, Vec2 } from "./geom";
import { trackRegistry } from "./track_registry";
import { uuid } from "./utils";

// This is the shape of the state that defines the tracks - this is what is
// undo/re-doable and defines the shape of the track precisely.
export interface World {
  readonly generation: number;
  readonly offset: Vec2;
  readonly tracks: readonly RootTrack[]; // Undo-able list of root track nodes.
  readonly trains: readonly Train[]; // A list of trains that live inside this workspace.
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

export type Train = DerailedTrain | RailedTrain;

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

export type RotateDirection = "cw" | "ccw";

interface TrackWithParent {
  readonly node: RootTrack | Track;
  readonly parent?: TrackParent;
}

interface TrackParent {
  readonly node: Track;
  readonly port: string;
}

export const emptyWorld: World = {
  generation: 0,
  offset: Vec2.identity(),
  tracks: [],
  trains: [],
  selectedId: null,
};

function findTrackById(
  state: Draft<World>,
  id: string,
): Draft<TrackWithParent> | undefined {
  for (const node of state.tracks) {
    if (node.id === id) {
      return { node };
    }
    for (const [portKey, dockedNode] of Object.entries(node.dockedNodes)) {
      const found = findTrackByIdRecursive(dockedNode, id, {
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

function findTrackByIdRecursive(
  node: Draft<Track>,
  id: string,
  parent: Draft<TrackParent>,
): Draft<TrackWithParent> | undefined {
  if (node.id === id) {
    return { node, parent };
  }
  for (const [key, dockedNode] of Object.entries(node.dockedNodes)) {
    const found = findTrackByIdRecursive(dockedNode, id, {
      node,
      port: key,
    });
    if (found) {
      return found;
    }
  }
  return undefined;
}

export function addRootTrack(
  world: World,
  kind: keyof typeof trackRegistry,
  at: Vec2,
): World {
  return produce(world, (draft) => {
    const id = uuid();
    draft.tracks.push({
      id: id,
      kind,
      flipped: false,
      dockedNodes: {},
      tx: { p: at, r: 0 },
    });
    draft.selectedId = id;
  });
}

function removeTrack(world: World, trackId: string): World {
  return produce(world, (draft) => {
    // Remove the track node
    const foundNode = findTrackById(draft, trackId);
    if (foundNode) {
      const removedNodeIds = new Set<string>();
      const addNodeAndChildrenToSet = (node: Track) => {
        removedNodeIds.add(node.id);
        Object.values(node.dockedNodes).forEach(addNodeAndChildrenToSet);
      };
      addNodeAndChildrenToSet(foundNode.node);

      // Remove any trains that were on the removed node or its children
      draft.trains = draft.trains.filter((train) => {
        if (train.kind === "derailed") {
          return true; // Derailed trains can stay, since they aren't attached to a track
        } else {
          return !removedNodeIds.has(train.trackNodeId);
        }
      });

      // Finally remove the node from its parent or from the root track list.
      if (foundNode.parent) {
        delete foundNode.parent.node.dockedNodes[foundNode.parent.port];
      } else {
        draft.tracks = draft.tracks.filter((n) => n.id !== foundNode.node.id);
      }
    }
  });
}

export function moveRootTrack(world: World, trackId: string, to: Vec2): World {
  return produce(world, (draft) => {
    const foundNode = draft.tracks.find((node) => trackId === node.id);
    if (foundNode) {
      foundNode.tx.p = to;
    }
  });
}

export function dockTrack(
  world: World,
  trackId: string,
  targetNodeId: string,
  targetPortName: string,
): World {
  return produce(world, (draft) => {
    const trackNode = findTrackById(draft, trackId);
    const targetNode = findTrackById(draft, targetNodeId);
    if (!trackNode || !targetNode) return;
    // Attach the track node to the target node at the target port
    targetNode.node.dockedNodes[targetPortName] = trackNode.node;
    // Remove the track node from the root nodes if it's there
    draft.tracks = draft.tracks.filter((n) => n.id !== trackNode.node.id);
  });
}

function flipTrack(world: World, trackId: string): World {
  return produce(world, (draft) => {
    const foundTrack = findTrackById(draft, trackId);
    if (foundTrack) {
      foundTrack.node.flipped = !foundTrack.node.flipped;
    }
  });
}

function rotateTrack(
  world: World,
  trackId: string,
  direction: RotateDirection,
): World {
  return produce(world, (draft) => {
    // Only rotate root nodes
    draft.tracks.forEach((track) => {
      if (track.id === trackId) {
        const angle = direction === "cw" ? 45 : -45;
        track.tx = Tx2.rotate(track.tx, angle);
      }
    });
  });
}

export function undockTrack(world: World, trackId: string, moveTo: Tx2): World {
  return produce(world, (draft) => {
    const foundNode = findTrackById(draft, trackId);
    if (foundNode && foundNode.parent) {
      // Remove the track from its parent
      delete foundNode.parent.node.dockedNodes[foundNode.parent.port];
      // Add the track back to the root nodes with the new position
      draft.tracks.push({
        ...foundNode.node,
        tx: moveTo,
      });
    }
  });
}

function flipTrain(world: World, trainId: string): World {
  return produce(world, (draft) => {
    const foundTrain = draft.trains.find((t) => t.id === trainId);
    if (foundTrain && foundTrain.kind === "railed") {
      foundTrain.reverse = !foundTrain.reverse;
      foundTrain.velocity = 0; // Stop the train when flipping, to avoid weirdness with flipped controls
    }
  });
}

export function addTrain(world: World, at: Vec2): World {
  const id = uuid();
  return produce(world, (draft) => {
    draft.trains.push({
      id,
      kind: "derailed",
      tx: { p: at, r: 0 },
    });
    draft.selectedId = id;
  });
}

function removeTrain(world: World, trainId: string): World {
  return produce(world, (draft) => {
    draft.trains = draft.trains.filter((t) => t.id !== trainId);
  });
}

function rotateTrain(
  world: World,
  trainId: string,
  direction: RotateDirection,
): World {
  return produce(world, (draft) => {
    draft.trains.forEach((train) => {
      if (train.id === trainId && train.kind === "derailed") {
        const angle = direction === "cw" ? 45 : -45;
        train.tx = Tx2.rotate(train.tx, angle);
      }
    });
  });
}

export function moveTrain(world: World, id: string, pos: Vec2): World {
  return produce(world, (draft) => {
    const draftTrain = draft.trains.find((t) => t.id === id);
    if (!draftTrain || draftTrain.kind !== "derailed") return;
    draftTrain.tx.p = pos;
  });
}

export function dockTrainToTrack(
  world: World,
  trainId: string,
  nodeId: string,
  t: number,
  pathName: string,
  reverse: boolean,
) {
  return produce(world, (draft) => {
    draft.trains = draft.trains.map((train): Train => {
      if (train.id === trainId) {
        console.log("Docking train", trainId, "to track", nodeId, "at t =", t);
        return {
          id: train.id,
          kind: "railed",
          trackNodeId: nodeId,
          reverse: reverse,
          velocity: 0,
          t,
          pathName,
        };
      } else {
        return train;
      }
    });
  });
}

export function derailTrain(world: World, trainId: string, tx: Tx2) {
  return produce(world, (draft) => {
    draft.trains = draft.trains.map((t) => {
      if (t.id === trainId && t.kind === "railed") {
        return {
          id: t.id,
          kind: "derailed",
          tx: {
            ...tx,
            r: Math.round(tx.r / 45) * 45,
          },
        };
      } else {
        return t;
      }
    });
  });
}

export function selectEntity(world: World, id: string): World {
  return produce(world, (draft) => {
    draft.selectedId = id;
  });
}

export function deselect(world: World): World {
  return produce(world, (draft) => {
    draft.selectedId = null;
  });
}

export function rotateSelected(
  world: World,
  direction: RotateDirection,
): World {
  const selectedId = world.selectedId;
  if (!selectedId) return world;

  let newWorld = rotateTrack(world, selectedId, direction);
  newWorld = rotateTrain(newWorld, selectedId, direction);
  return newWorld;
}

export function flipSelected(world: World): World {
  const selectedId = world.selectedId;
  if (!selectedId) return world;

  let newWorld = flipTrack(world, selectedId);
  newWorld = flipTrain(newWorld, selectedId);
  return newWorld;
}

// Remove a given track node or any of its children, as well as any trains that
// were on the node or any of its children.
export function removeSelected(world: World): World {
  const selectedId = world.selectedId;
  if (!selectedId) return world;

  let newWorld = removeTrack(world, selectedId);
  newWorld = removeTrain(newWorld, selectedId);
  newWorld = deselect(newWorld);
  return newWorld;
}

// Duplicate the currently selected track node, attaching the new node to the
// first port of the selected one. If there are no empty ports, the new node
// will be placed at @at.
export function duplicateSelected(world: World, at: Vec2): World {
  const selectedId = world.selectedId;
  if (!selectedId) return world;

  return produce(world, (draft) => {
    const foundNode = findTrackById(draft, selectedId);
    if (!foundNode) return;

    // Find the first empty port on the selected node
    const manifest = trackRegistry[foundNode.node.kind];
    let emptyPortName: string | undefined;
    for (const [portName] of manifest.ports) {
      if (!foundNode.node.dockedNodes[portName]) {
        // This port is empty - we'll dock the new node here
        emptyPortName = portName;
      }
    }

    const node = foundNode.node;
    const newId = uuid();
    const newNode: Track = {
      id: newId,
      kind: node.kind,
      flipped: node.flipped,
      dockedNodes: {},
    };

    if (!emptyPortName) {
      console.warn(
        "Unable to duplicate node, putting the new node under the mouse instead",
      );
      draft.tracks.push({
        ...newNode,
        tx: { p: at, r: 0 },
      });
    } else {
      foundNode.node.dockedNodes[emptyPortName] = newNode;
    }

    draft.selectedId = newId;
  });
}

export function panWorld(world: World, offset: Vec2): World {
  return produce(world, (draft) => {
    draft.offset = offset;
  });
}
