import { produce } from "immer";
import m from "mithril";
import { startDrag } from "./dom";
import { Tx2, Vec2 } from "./geom";
import {
  createEmptyState,
  findTrackNodeById,
  uuid,
  type GameState,
  type TrackNode,
  type Train,
} from "./model";
import { createProjectStore } from "./project_store";
import "./styles.css";
import { trackRegistry } from "./track_registry";
import type { Path, Port } from "./types";
import { ProjectRow } from "./views/project_row";
import { Toolbar } from "./views/toolbar";
import { TrackView } from "./views/track";
import { TrainView } from "./views/train";
import { Workspace } from "./views/workspace";
import { createWorkspace } from "./workspace";
import { assertDefined } from "./assert";
import { Toolbox, ToolboxItem } from "./views/toolbox";
import a1 from "./track/a1";
import c1 from "./track/e1";
import y1 from "./track/y1";
import y2 from "./track/y2";

function getCurrentHash(): string | null {
  const match = location.hash.match(/^#\/project\/([0-9a-fA-F-]+)$/);
  return match ? match[1]! : null;
}

let state = produce(createEmptyState(), (x) => x);

type FlatPort = Port & { readonly occupied: boolean };

interface FlatTrackNode {
  readonly id: string;
  readonly tx: Tx2;
  readonly flipped: boolean;
  readonly isRoot: boolean;
  readonly ports: ReadonlyMap<string, FlatPort>; // Global transforms of all ports on this track, keyed by port name.
  readonly paths: ReadonlyMap<string, Path>; // Paths that produce global transforms
  readonly view: () => m.Children;
}

// Flattens the game state into a list of absolute track positions where each track node and each path is
function flatten(state: GameState) {
  const flatTrackNodes: FlatTrackNode[] = [];
  for (const rootNode of state.rootTrackNodes) {
    const addFlatNode = (node: TrackNode, tx: Tx2, isRoot: boolean) => {
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
  return flatTrackNodes;
}

let mousePos: Vec2 = { x: 0, y: 0 };

export function AppV2(): m.Component {
  let previousUuid: string | null = null;
  let workspaceOffset: Vec2 = { x: 0, y: 0 };
  let workspace = createWorkspace({ tracks: [] });
  const store = createProjectStore();
  let ghostTrain: Tx2 | undefined;
  let ghostTrackNode: FlatTrackNode | undefined;

  function saveProject() {
    const uuid = getCurrentHash();
    if (uuid) {
      store.saveProject(uuid, workspace.state);
    } else {
      const uuid = crypto.randomUUID();
      store.saveProject(uuid, workspace.state);
      location.hash = `#/project/${uuid}`;
    }
  }

  function maybeLoadWorkspace(currentHash: string | null): boolean {
    if (currentHash !== previousUuid) {
      if (currentHash) {
        previousUuid = currentHash;
        const project = store.getProject(currentHash);
        if (project) {
          workspace = createWorkspace(project.workspace);
        } else {
          return false;
        }
      } else {
        workspace = createWorkspace({ tracks: [] });
        previousUuid = null;
      }
    }
    return true;
  }

  return {
    oncreate({ dom }: m.VnodeDOM) {
      // Focus the main element so that it can receive keyboard events
      (dom as HTMLElement).focus();
      requestAnimationFrame(tick);
    },
    view() {
      const currentHash = getCurrentHash();
      const hasWorkspace = maybeLoadWorkspace(currentHash);

      // If the URL references a workspace that doesn't exist, show an error
      // instead of the editor UI.
      if (!hasWorkspace) {
        return m(
          "",
          'No such workspace: "' + currentHash + '"',
          m(
            "button",
            {
              onclick: () => {
                location.hash = "";
                workspace = createWorkspace({ tracks: [] });
              },
            },
            "Back to safety",
          ),
        );
      }

      const flatNodes = flatten(state);
      const trackNodes = flatNodes.map((node) => {
        return m(
          TrackView,
          {
            key: node.id,
            tx: node.tx,
            flipped: node.flipped,
            selected: node.id === state.selectedId,
            isRoot: node.isRoot,
            onpointerdown(e: PointerEvent) {
              state = produce(state, (draft) => {
                draft.selectedId = node.id;
              });
              e.stopPropagation();
              let dragPos = node.tx;
              startDrag(e, e.currentTarget as HTMLElement, 4, {
                onDragStart: () => {
                  // Undock this node - noop if it's a root node
                  undockNode(node.id, node.tx);
                  return {
                    onDrag(deltaX, deltaY) {
                      dragPos = Tx2.translate(dragPos, {
                        x: deltaX,
                        y: deltaY,
                      });
                      moveNode(node.id, dragPos.p);
                      const trackPort = findDockTarget(
                        flatNodes,
                        dragPos,
                        node.id,
                      );
                      if (trackPort) {
                        ghostTrackNode = {
                          ...node,
                          tx: trackPort.node.ports.get(trackPort.portName)!,
                        };
                      } else {
                        ghostTrackNode = undefined;
                      }
                    },
                    onDragEnd() {
                      const trackPort = findDockTarget(
                        flatNodes,
                        dragPos,
                        node.id,
                      );
                      if (trackPort) {
                        dockTrack(
                          node.id,
                          trackPort.node.id,
                          trackPort.portName,
                        );
                      }
                      ghostTrackNode = undefined;
                    },
                  };
                },
              });
            },
          },
          node.view(),
        );
      });

      const trainNodes = state.trains.map((train) => {
        function findTrainTx() {
          if (train.kind === "derailed") {
            return train.tx;
          } else {
            // Find the railed position
            const tx = findRailedPosition(
              flatNodes,
              train.trackNodeId,
              train.pathName,
              train.t,
            )!;
            return train.reverse ? Tx2.rotate(tx, 180) : tx;
          }
        }
        const trainTx = findTrainTx();
        return m(TrainView, {
          key: train.id,
          tx: trainTx,
          selected: train.id === state.selectedId,
          onpointerdown(e: PointerEvent) {
            selectTrain(train.id);
            e.stopPropagation();
            let dragPos = trainTx;
            startDrag(e, e.currentTarget as HTMLElement, 4, {
              onDragStart: () => {
                derailTrain(train.id, dragPos);
                return {
                  onDrag(deltaX, deltaY) {
                    dragPos = Tx2.translate(dragPos, {
                      x: deltaX,
                      y: deltaY,
                    });
                    moveTrain(train.id, dragPos.p);
                    const trackPath = findNearestTrackPath(flatNodes, dragPos);
                    ghostTrain = trackPath?.tx;
                  },
                  onDragEnd() {
                    console.log(
                      "Drag ended, finding nearest track for train",
                      train.id,
                    );
                    const trackPath = findNearestTrackPath(flatNodes, dragPos);
                    if (trackPath) {
                      dockTrainToTrack(
                        train.id,
                        trackPath.node.id,
                        trackPath.t,
                        trackPath.pathName,
                        trackPath.reverse,
                      );
                    }
                    ghostTrain = undefined;
                  },
                };
              },
              onDragFailed: () => selectTrain(train.id),
            });
          },
        });
      });

      return m(
        "main",
        {
          tabIndex: -1,
          onkeydown(e: KeyboardEvent) {
            keyMap.get(e.key)?.();
          },
          onpointermove(e: PointerEvent) {
            mousePos = { x: e.clientX, y: e.clientY };
          },
        },
        m(
          Toolbar,
          {
            canUndo: workspace.canUndo,
            canRedo: workspace.canRedo,
            onNewWorkspace: () => {
              location.hash = "";
              workspace = createWorkspace({ tracks: [] });
            },
            onUndo: () => {
              workspace.undo();
              saveProject();
            },
            onRedo: () => {
              workspace.redo();
              saveProject();
            },
          },
          store.listProjects().map(([key, project]) =>
            m(ProjectRow, {
              key,
              id: key,
              created: project.created,
              modified: project.modified,
              active: getCurrentHash() === key,
              onLoad: () => {
                location.hash = `#/project/${key}`;
              },
              onDelete: () => {
                store.deleteProject(key);
                if (getCurrentHash() === key) {
                  location.hash = "";
                  workspace = createWorkspace({ tracks: [] });
                }
              },
            }),
          ),
          m(
            Toolbox,
            m(
              ToolboxItem,
              {
                onclick: () => addNewNode("a1"),
              },
              a1.view(),
            ),
            m(
              ToolboxItem,
              {
                onclick: () => addNewNode("e1"),
              },
              c1.view(),
            ),
            m(
              ToolboxItem,
              {
                onclick: () => addNewNode("y1"),
              },
              y1.view(),
            ),
            m(
              ToolboxItem,
              {
                onclick: () => addNewNode("y2"),
              },
              y2.view(),
            ),
          ),
        ),
        m(
          Workspace,
          {
            offset: workspaceOffset,
            onpan(offset) {
              workspaceOffset = offset;
            },
            onclick() {
              state = produce(state, (draft) => {
                draft.selectedId = null;
              });
            },
          },
          ghostTrackNode &&
            m(
              TrackView,
              {
                tx: ghostTrackNode.tx,
                flipped: ghostTrackNode.flipped,
                className: "ghost",
              },
              ghostTrackNode.view(),
            ),
          m(".tracks", trackNodes),
          ghostTrain &&
            m(TrainView, {
              tx: ghostTrain,
              className: "ghost",
            }),
          m(".trains", trainNodes),
        ),
      );
    },
  };
}

// Duplicate the currently selected track node, attaching the new node to the
// first port of the selected one.
function duplicateSelected() {
  const selectedId = state.selectedId;
  if (!selectedId) return;
  state = produce(state, (draft) => {
    const foundNode = findTrackNodeById(draft, selectedId);
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
    const newNode: TrackNode = {
      id: newId,
      kind: node.kind,
      flipped: node.flipped,
      dockedNodes: {},
    };

    if (!emptyPortName) {
      console.warn(
        "Unable to duplicate node, putting the new node under the mouse instead",
      );
      draft.rootTrackNodes.push({
        ...newNode,
        tx: { p: mousePos, r: 0 },
      });
    } else {
      foundNode.node.dockedNodes[emptyPortName] = newNode;
    }

    draft.selectedId = newId;
  });
}

function addNewNode(kind: keyof typeof trackRegistry, at: Vec2 = mousePos) {
  state = produce(state, (draft) => {
    const id = uuid();
    draft.rootTrackNodes.push({
      id: id,
      kind,
      flipped: false,
      dockedNodes: {},
      tx: { p: at, r: 0 },
    });
    draft.selectedId = id;
  });
}

function findDockTarget(
  nodes: readonly FlatTrackNode[],
  targetTx: Tx2,
  avoidNodeId: string,
) {
  const DOCKING_DIST = 40;
  const nearbyPorts = nodes
    .filter((node) => node.id !== avoidNodeId)
    .map((node) => {
      return Array.from(node.ports.entries())
        .filter(([_, port]) => !port.occupied) // Only consider unoccupied ports
        .map(([portName, port]) => {
          const dist = Tx2.dist(port, targetTx);
          return { node, portName, dist };
        });
    })
    .flat()
    .filter(({ dist }) => dist < DOCKING_DIST)
    .sort((a, b) => a.dist - b.dist);
  return nearbyPorts[0];
}

function tick() {
  m.redraw();
  const flatNodes = flatten(state);
  state = produce(state, (draft) => {
    draft.trains = draft.trains.map((train) => {
      return runTrainTick(flatNodes, train);
    });
  });
  requestAnimationFrame(tick);
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
      if (Vec2.dist(startTx.p, tx.p) < EPSILON) {
        return { node, pathName, t: 0 };
      }
      const endTx = path(length);
      if (Vec2.dist(endTx.p, tx.p) < EPSILON) {
        return { node, pathName, t: length };
      }
    }
  }
}

function runTrainTick(nodes: readonly FlatTrackNode[], train: Train): Train {
  const TRAIN_SPEED_MAX = 3; // How much t changes per tick for a train moving at normal speed
  if (train.kind === "railed") {
    const trainVelocity =
      train.velocity + (TRAIN_SPEED_MAX - train.velocity) * 0.05; // Accelerate towards max speed, with some drag
    const t = train.t + (train.reverse ? -trainVelocity : trainVelocity);
    const node = nodes.find((node) => node.id === train.trackNodeId)!;
    const pathName = train.pathName;
    const path = node.paths.get(pathName)!;
    if (t >= path.length) {
      // Off the end of the track - find the position at t=1 for this track
      const endTrackTx = findRailedPosition(
        nodes,
        train.trackNodeId,
        train.pathName,
        path.length,
      )!;
      const nearestPathEndpoint = findNearestPathEndpoint(
        endTrackTx,
        nodes,
        train.trackNodeId,
      );
      if (nearestPathEndpoint) {
        console.log(
          "Moving the train to a new track",
          nearestPathEndpoint.node.id,
          "path",
          nearestPathEndpoint.pathName,
        );
        return {
          ...train,
          trackNodeId: nearestPathEndpoint.node.id,
          t: nearestPathEndpoint.t,
          velocity: trainVelocity,
          pathName: nearestPathEndpoint.pathName,
        };
      }
    }
    if (t < 0) {
      // Off the start of the track - find the position at t=0 for this track
      const startTrackTx = findRailedPosition(
        nodes,
        train.trackNodeId,
        train.pathName,
        0,
      )!;
      const nearestPathEndpoint = findNearestPathEndpoint(
        startTrackTx,
        nodes,
        train.trackNodeId,
      );
      if (nearestPathEndpoint) {
        return {
          ...train,
          trackNodeId: nearestPathEndpoint.node.id,
          t: nearestPathEndpoint.t,
          velocity: trainVelocity,
          pathName: nearestPathEndpoint.pathName,
        };
      }
    }
    // Move forward one tick
    return {
      ...train,
      t: Math.max(0, Math.min(t, path.length)), // Don't allow t to go past the end of the track
      velocity: trainVelocity,
    };
  } else {
    return train;
  }
}

const keyMap: Map<string, () => void> = new Map([
  ["f", flipSelected],
  ["q", () => rotateSelectedNode("ccw")],
  ["e", () => rotateSelectedNode("cw")],
  ["Delete", removeSelected],
  ["Backspace", removeSelected],
  ["n", () => addNewNode("a1", mousePos)],
  ["e", () => addNewNode("e1", mousePos)],
  ["y", () => addNewNode("y1", mousePos)],
  ["u", () => addNewNode("y2", mousePos)],
  ["d", () => duplicateSelected()],
  ["t", () => addTrain(mousePos)],
]);

function addTrain(position: Vec2) {
  state = produce(state, (draft) => {
    draft.trains.push({
      id: uuid(),
      kind: "derailed",
      tx: { p: position, r: 0 },
    });
  });
}

function derailTrain(trainId: string, tx: Tx2) {
  state = produce(state, (draft) => {
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

function selectTrain(trainId: string) {
  state = produce(state, (draft) => {
    draft.selectedId = trainId;
  });
}

function findRailedPosition(
  flatNodes: readonly FlatTrackNode[],
  trackNodeId: string,
  pathName: string,
  t: number,
) {
  const trackNode = flatNodes.find((node) => node.id === trackNodeId)!;
  const path = trackNode.paths.get(pathName)!;
  return path.path(t);
}

function findNearestTrackPath(
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

function dockTrainToTrack(
  trainId: string,
  nodeId: string,
  t: number,
  pathName: string,
  reverse: boolean,
) {
  state = produce(state, (draft) => {
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

function moveTrain(id: string, pos: Vec2) {
  state = produce(state, (draft) => {
    const draftTrain = draft.trains.find((t) => t.id === id);
    if (!draftTrain || draftTrain.kind !== "derailed") return;
    draftTrain.tx.p = pos;
  });
}

// Undocks a node from its parent and moves it to a given transform.
function undockNode(id: string, moveTo: Tx2) {
  state = produce(state, (draft) => {
    const draftTrackNode = findTrackNodeById(draft, id);
    if (!draftTrackNode) return;
    if (draftTrackNode.parent) {
      // If we have a parent, undock it from current parent and push into root nodes
      delete draftTrackNode.parent.node.dockedNodes[draftTrackNode.parent.port];
      draft.rootTrackNodes.push({
        ...draftTrackNode.node,
        tx: moveTo,
      });
    }
  });
}

function dockTrack(id: string, targetNodeId: string, targetPortName: string) {
  state = produce(state, (draft) => {
    const trackNode = findTrackNodeById(draft, id);
    const targetNode = findTrackNodeById(draft, targetNodeId);
    if (!trackNode || !targetNode) return;
    // Attach the track node to the target node at the target port
    targetNode.node.dockedNodes[targetPortName] = trackNode.node;
    // Remove the track node from the root nodes if it's there
    draft.rootTrackNodes = draft.rootTrackNodes.filter(
      (n) => n.id !== trackNode.node.id,
    );
  });
}

// Move a (root) node to a new position
function moveNode(id: string, newPosition: Vec2) {
  state = produce(state, (draft) => {
    const foundNode = draft.rootTrackNodes.find((node) => id === node.id);
    if (foundNode) {
      foundNode.tx.p = newPosition;
    }
  });
}

function rotateSelectedNode(direction: "cw" | "ccw") {
  // Rotate the selected track node 45° clockwise, keeping docked nodes in place.
  const angle = direction === "cw" ? 45 : -45;
  state = produce(state, (draft) => {
    draft.rootTrackNodes.forEach((node) => {
      if (node.id === draft.selectedId) {
        node.tx = Tx2.rotate(node.tx, angle);
      }
    });
    draft.trains.forEach((train) => {
      if (train.kind === "derailed" && train.id === draft.selectedId) {
        train.tx = Tx2.rotate(train.tx, angle);
      }
    });
  });
}

function flipSelected() {
  // Flip the selectedd track node
  state = produce(state, (draft) => {
    if (!draft.selectedId) return;
    const found = findTrackNodeById(draft, draft.selectedId);
    if (found) found.node.flipped = !found.node.flipped;

    const foundTrain = draft.trains.find((t) => draft.selectedId === t.id);
    if (foundTrain) {
      if (foundTrain.kind === "railed") {
        foundTrain.reverse = !foundTrain.reverse;
        foundTrain.velocity = 0; // Stop the train when flipping, to avoid weirdness with flipped controls
      }
    }
  });
}

// Remove a given track node or any of its children, as well as any trains that
// were on the node or any of its children.
function removeSelected() {
  const selectedId = state.selectedId;
  if (!selectedId) return;

  // Delete the selected track node
  state = produce(state, (draft) => {
    // Remove the track node
    const foundNode = findTrackNodeById(draft, selectedId);
    if (foundNode) {
      if (foundNode.parent) {
        delete foundNode.parent.node.dockedNodes[foundNode.parent.port];
      } else {
        draft.rootTrackNodes = draft.rootTrackNodes.filter(
          (n) => n.id !== foundNode.node.id,
        );
      }

      const removedNodeIds = new Set<string>();
      const addNodeAndChildrenToSet = (node: TrackNode) => {
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
    }

    // If a train was selected, remove it too
    draft.trains = draft.trains.filter((t) => selectedId !== t.id);
  });
}

window.addEventListener("hashchange", m.redraw);
