import { produce, type Draft } from "immer";
import { assertDefined } from "./assert";
import { Tx2, Vec2 } from "./geom";
import { trackRegistry } from "./track_registry";
import type { Path, Port } from "./types";
import type {
  World,
  Track,
  Locomotive,
  RootTrack,
  RailedCarriage,
  DerailedCarriage,
} from "./world";
import m from "mithril";
import { uuid } from "./utils";

type FlatPort = Port & { readonly occupied: boolean };

export interface FlatTrackNode {
  readonly id: string;
  readonly tx: Tx2;
  readonly flipped: boolean;
  readonly isRoot: boolean;
  readonly ports: ReadonlyMap<string, FlatPort>; // Global transforms of all ports on this track, keyed by port name.
  readonly paths: ReadonlyMap<string, Path>; // Paths that produce global transforms
  readonly view: () => m.Children;
}

interface TrackWithParent {
  readonly node: RootTrack | Track;
  readonly parent?: TrackParent;
}

interface TrackParent {
  readonly node: Track;
  readonly port: string;
}

export type RotateDirection = "cw" | "ccw";

const cache = new WeakMap<World, FlatTrackNode[]>();

// Flattens the game state into a list of absolute track positions where each track node and each path is
export function flatten(world: World): FlatTrackNode[] {
  const cached = cache.get(world);
  if (cached) return cached;

  const flatTrackNodes: FlatTrackNode[] = [];
  for (const rootNode of world.tracks) {
    const addFlatNode = (node: Track, tx: Tx2, isRoot: boolean) => {
      // A flipped track mirrors its local Y axis. Tx2 has no scale component,
      // so we bake the mirror into each port's local coordinates before
      // composing with the track's world transform.
      const flipSign = node.flipped ? -1 : 1;
      const ports = new Map<string, FlatPort>();
      const trackDef = trackRegistry[node.kind];
      for (const [portName, port] of trackDef.ports) {
        const localPort: Tx2 = {
          p: { x: port.p.x, y: port.p.y * flipSign },
          r: port.r * flipSign,
        };
        ports.set(portName, {
          ...Tx2.multiply(tx, localPort),
          direction: port.direction,
          occupied: node.dockedNodes[portName] !== undefined,
        });
      }

      // Paths
      const paths = new Map<string, Path>();
      for (const [pathName, path] of trackDef.paths) {
        paths.set(pathName, {
          ...path,
          path: (t: number) => {
            // Translate the path into this reference frame
            const localPoint = path.path(t);
            const normPoint: Tx2 = {
              p: { x: localPoint.p.x, y: localPoint.p.y * flipSign },
              r: localPoint.r * flipSign,
            };
            return Tx2.multiply(tx, normPoint);
          },
        });
      }

      flatTrackNodes.push({
        id: node.id,
        ports: ports,
        paths: paths,
        view: trackDef.view,
        tx: tx,
        flipped: node.flipped,
        isRoot,
      });
      for (const [key, dockedNode] of Object.entries(node.dockedNodes)) {
        const dockedPort = ports.get(key);
        assertDefined(
          dockedPort,
          `Docked node ${dockedNode.id} is attached to non-existent port ${key} on track ${node.id}`,
        );
        addFlatNode(dockedNode, dockedPort, false);
      }
    };
    addFlatNode(rootNode, rootNode.tx, true);
  }
  cache.set(world, flatTrackNodes);
  return flatTrackNodes;
}

export function tick(world: World, draggedTrainId?: string): World {
  const flatNodes = flatten(world);
  return produce(world, (draft) => {
    draft.trains = draft.trains.map((train) => {
      if (train.id === draggedTrainId) {
        return train;
      } else {
        return runTrainTick(flatNodes, train);
      }
    });
  });
}

interface TrackPosition {
  readonly nodeId: string;
  readonly pathName: string;
  readonly t: number;
}

// Progress a train or carriage along a track by a given delta.
function moveAlongTrack(
  nodes: readonly FlatTrackNode[],
  pos: TrackPosition,
  delta: number,
): TrackPosition {
  let node = nodes.find((node) => node.id === pos.nodeId)!;
  let path = node.paths.get(pos.pathName)!;
  let newPos = {
    nodeId: pos.nodeId,
    pathName: pos.pathName,
    t: pos.t + delta,
  };

  // While newPos is off the end of this track piece, progress along the track
  // path until we find a valid position.
  while (newPos.t < 0 || newPos.t >= path.length) {
    if (newPos.t >= path.length) {
      // Find the end pose of the track piece we're currently on
      const endPose = path.path(path.length);
      const nearestPathEndpoint = findNearestPathEndpoint(
        endPose,
        nodes,
        node.id,
      );
      if (nearestPathEndpoint) {
        newPos = {
          nodeId: nearestPathEndpoint.node.id,
          pathName: nearestPathEndpoint.pathName,
          t: newPos.t - path.length,
        };
        node = nearestPathEndpoint.node;
        path = node.paths.get(nearestPathEndpoint.pathName)!;
      } else {
        return {
          ...newPos,
          t: path.length,
        };
      }
    } else if (newPos.t < 0) {
      // Find the start pose of the track piece we're currently on
      const startPose = path.path(0);
      const nearestPathEndpoint = findNearestPathEndpoint(
        startPose,
        nodes,
        node.id,
      );
      if (nearestPathEndpoint) {
        node = nearestPathEndpoint.node;
        path = node.paths.get(nearestPathEndpoint.pathName)!;
        newPos = {
          nodeId: node.id,
          pathName: nearestPathEndpoint.pathName,
          t: newPos.t + path.length,
        };
      } else {
        return {
          ...newPos,
          t: 0,
        };
      }
    }
  }

  return newPos;
}

function runTrainTick(
  nodes: readonly FlatTrackNode[],
  train: Locomotive,
): Locomotive {
  const TRAIN_SPEED_MAX = 2; // How much t changes per tick for a train moving at normal speed
  if (train.kind === "railed") {
    const delta = train.reverse ? -TRAIN_SPEED_MAX : TRAIN_SPEED_MAX;
    const newTrainPos = moveAlongTrack(
      nodes,
      { nodeId: train.trackId, pathName: train.pathName, t: train.t },
      delta,
    );

    function moveCarriage(
      carriage?: RailedCarriage,
    ): RailedCarriage | undefined {
      if (!carriage) return undefined;
      const carriagePos = moveAlongTrack(
        nodes,
        {
          nodeId: carriage.trackId,
          pathName: carriage.pathName,
          t: carriage.t,
        },
        delta,
      );

      return {
        ...carriage,
        trackId: carriagePos.nodeId,
        pathName: carriagePos.pathName,
        t: carriagePos.t,
        carriage: moveCarriage(carriage.carriage),
      };
    }

    return {
      ...train,
      trackId: newTrainPos.nodeId,
      pathName: newTrainPos.pathName,
      t: newTrainPos.t,
      carriage: moveCarriage(train.carriage),
    };
  } else {
    return train;
  }
}

function findNearestPathEndpoint(
  tx: Tx2,
  nodes: readonly FlatTrackNode[],
  avoidNodeId: string,
) {
  const EPSILON = 0.1;
  for (const node of nodes) {
    if (node.id === avoidNodeId) continue;
    for (const [pathName, { length, path }] of node.paths) {
      const startTx = path(0);
      if (
        Vec2.dist(startTx.p, tx.p) < EPSILON &&
        Tx2.angleBetween(startTx.r, tx.r) < 5
      ) {
        console.log(Tx2.angleBetween(startTx.r, tx.r));
        return { node, pathName, t: 0 };
      }
      const endTx = path(length);
      if (
        Vec2.dist(endTx.p, tx.p) < EPSILON &&
        Tx2.angleBetween(endTx.r, tx.r) < 5
      ) {
        console.log(Tx2.angleBetween(endTx.r, tx.r));
        return { node, pathName, t: length };
      }
    }
  }
}

export function findRailedPosition(
  flatNodes: readonly FlatTrackNode[],
  trackId: string,
  pathName: string,
  t: number,
) {
  const trackNode = flatNodes.find((node) => node.id === trackId)!;
  const path = trackNode.paths.get(pathName)!;
  return path.path(t);
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
          return !removedNodeIds.has(train.trackId);
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

export function addCarriage(world: World, at: Vec2): World {
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

/**
 * Converts a train to a railed train, and docks it to a given track node and
 * port. Any carriages attached to this train will also be converted to railed
 * carriages and placed at the correct positions on the track behind the
 * locomotive.
 */
export function dockTrainToTrack(
  world: World,
  trainId: string,
  nodeId: string,
  t: number,
  pathName: string,
  reverse: boolean,
) {
  return produce(world, (draft) => {
    draft.trains = draft.trains.map((train): Locomotive => {
      if (train.id === trainId) {
        console.log("Docking train", trainId, "to track", nodeId, "at t =", t);

        function dockCarriage(
          carriage?: DerailedCarriage | RailedCarriage,
          distanceFromLocomotive = 100,
        ): RailedCarriage | undefined {
          if (!carriage) return undefined;
          const carriageT = reverse
            ? t + distanceFromLocomotive
            : t - distanceFromLocomotive;
          return {
            id: carriage.id,
            trackId: nodeId,
            pathName,
            t: carriageT,
            carriage: dockCarriage(
              carriage.carriage,
              distanceFromLocomotive + 100,
            ),
          };
        }

        return {
          ...train,
          kind: "railed",
          trackId: nodeId,
          reverse: reverse,
          t,
          pathName,
          carriage: dockCarriage(train.carriage),
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
          ...t,
          kind: "derailed",
          tx: {
            ...tx,
            r: Math.round(tx.r / 45) * 45,
          },
          carriage: t.carriage
            ? {
                ...t.carriage,
                kind: "derailed",
              }
            : undefined,
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

export function findNearestTrackPath(
  flatTracks: readonly FlatTrackNode[],
  targetTx: Tx2,
) {
  const TRACK_CONSIDERATION_DIST = 200;
  const TRACK_DIST_LIMIT = 50;
  const candidateTracks = flatTracks
    .map((node) => {
      return { node, dist: Vec2.dist(node.tx.p, targetTx.p) };
    })
    .filter(({ dist }) => dist < TRACK_CONSIDERATION_DIST)
    .sort((a, b) => a.dist - b.dist);

  const pathPoints = candidateTracks
    .map(({ node }) => {
      return Array.from(node.paths.entries())
        .map(([pathName, path]) => ({ pathName, path }))
        .map(({ pathName, path }) => {
          const points: {
            node: FlatTrackNode;
            pathName: string;
            t: number;
            tx: Tx2;
          }[] = [];
          const PATH_POINT_SPACING = 1;
          for (let t = 0; t <= path.length; t += PATH_POINT_SPACING) {
            points.push({ node, pathName, t, tx: path.path(t) });
          }
          return points;
        })
        .flat();
    })
    .flat()
    .map(({ tx, ...rest }) => {
      const reverse = Tx2.angleBetween(tx.r, targetTx.r) > 90;
      return {
        ...rest,
        tx: reverse ? Tx2.rotate(tx, 180) : tx,
        dist: Vec2.dist(tx.p, targetTx.p),
        reverse: Tx2.angleBetween(tx.r, targetTx.r) > 90,
      };
    })
    .filter(({ dist }) => dist < TRACK_DIST_LIMIT)
    .sort((a, b) => a.dist - b.dist);

  return pathPoints[0];
}
