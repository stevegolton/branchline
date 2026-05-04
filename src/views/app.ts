import { produce } from "immer";
import m from "mithril";
import { startDrag, type MithrilEvent } from "../dom";
import { Tx2, Vec2 } from "../geom";
import {
  findTrackById,
  type World,
  type Track,
  type Train,
  moveRootTrack,
  dockTrack,
  moveTrain,
  dockTrainToTrack,
  addRootTrack,
  addTrain,
  selectEntity,
  undockTrack,
  derailTrain,
  rotateSelected,
  flipSelected,
  removeSelected,
  deselect,
  emptyWorld,
  duplicateSelected,
} from "../world";
import { trackRegistry } from "../track_registry";
import type { Path, Port } from "../types";
import { ProjectRow } from "./project_row";
import { Toolbar } from "./toolbar";
import { TrackView } from "./track";
import { TrainView } from "./train";
import { Workspace } from "./workspace";
import { assertDefined } from "../assert";
import { Toolbox, ToolboxItem } from "./toolbox";
import "./app.css";
import { uuid } from "../utils";
import { createProjectStore } from "../project_store";

let cachedWorld: World | undefined;

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
function flatten(world: World) {
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
  return flatTrackNodes;
}

let mousePos: Vec2 = { x: 0, y: 0 };

export interface AppAttrs {
  readonly worldId?: string;
}

const store = createProjectStore();

export function App(): m.Component<AppAttrs> {
  let previousWorldId: string | undefined | null;
  let ghostTrain: Tx2 | undefined;
  let ghostTrackNode: FlatTrackNode | undefined;

  function getOrCreateWorld(worldId: string | null): World | undefined {
    if (worldId !== previousWorldId) {
      previousWorldId = worldId;
      if (worldId) {
        return store.getProject(worldId)?.workspace;
      } else {
        // Undefined world id - just return an empty world. We'll save it on
        // first load.
        return emptyWorld;
      }
    } else {
      return cachedWorld;
    }
  }

  function useWorld(worldId: string | null) {
    cachedWorld = getOrCreateWorld(worldId);
    function updateWorld(newWorld: World, save = true) {
      cachedWorld = newWorld;
      if (!save) return;
      if (worldId) {
        store.saveProject(worldId ?? uuid(), newWorld);
      } else {
        // No world ID - must be a new world that hasn't been saved yet.
        const newId = uuid();
        store.saveProject(newId, newWorld);
        m.route.set(`/world/${newId}`);
      }
    }
    return { world: cachedWorld, updateWorld };
  }

  return {
    oncreate({ dom }: m.VnodeDOM<AppAttrs>) {
      // Focus the main element so that it can receive keyboard events
      (dom as HTMLElement).focus();
    },
    view({ attrs }: m.Vnode<AppAttrs>) {
      const worldId = attrs.worldId;
      const { world: maybeWorld, updateWorld } = useWorld(worldId ?? null);

      if (!maybeWorld) {
        return m(
          "",
          'No such workspace: "' + worldId + '"',
          m(
            "button",
            {
              onclick: () => m.route.set("/new"),
            },
            "Create new world",
          ),
        );
      }

      const world = maybeWorld;

      function tick() {
        if (!cachedWorld) {
          return;
        }
        m.redraw();
        const flatNodes = flatten(cachedWorld);
        cachedWorld = produce(cachedWorld, (draft) => {
          draft.trains = draft.trains.map((train) => {
            return runTrainTick(flatNodes, train);
          });
        });
      }

      tick();

      function addNodeAtMouse(kind: keyof typeof trackRegistry) {
        updateWorld(addRootTrack(world, kind, mousePos));
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

      const keyMap: Map<string, () => void> = new Map([
        ["f", () => updateWorld(flipSelected(world))],
        ["q", () => updateWorld(rotateSelected(world, "ccw"))],
        ["e", () => updateWorld(rotateSelected(world, "cw"))],
        ["Delete", () => updateWorld(removeSelected(world))],
        ["Backspace", () => updateWorld(removeSelected(world))],
        ["n", () => addNodeAtMouse("a1")],
        ["c", () => addNodeAtMouse("e1")],
        ["y", () => addNodeAtMouse("y1")],
        ["u", () => addNodeAtMouse("y2")],
        ["d", () => updateWorld(duplicateSelected(world, mousePos))],
        ["t", () => updateWorld(addTrain(world, mousePos))],
      ]);

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

      const flatNodes = flatten(world);
      const trackNodes = flatNodes.map((node) => {
        return m(
          TrackView,
          {
            key: node.id,
            tx: node.tx,
            flipped: node.flipped,
            selected: node.id === world.selectedId,
            isRoot: node.isRoot,
            onpointerdown(e: PointerEvent) {
              updateWorld(selectEntity(world, node.id));
              e.stopPropagation();
              let dragPos = node.tx;
              startDrag(e, e.currentTarget as HTMLElement, 4, {
                onDragStart: () => {
                  // Undock this node - noop if it's a root node
                  updateWorld(undockTrack(world, node.id, node.tx));
                  return {
                    onDrag(deltaX, deltaY) {
                      dragPos = Tx2.translate(dragPos, {
                        x: deltaX,
                        y: deltaY,
                      });
                      updateWorld(moveRootTrack(world, node.id, dragPos.p));
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
                        updateWorld(
                          dockTrack(
                            world,
                            node.id,
                            trackPort.node.id,
                            trackPort.portName,
                          ),
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

      const trainNodes = world.trains.map((train) => {
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
          selected: train.id === world.selectedId,
          onpointerdown(e: PointerEvent) {
            updateWorld(selectEntity(world, train.id));
            e.stopPropagation();
            let dragPos = trainTx;
            startDrag(e, e.currentTarget as HTMLElement, 4, {
              onDragStart: () => {
                updateWorld(derailTrain(world, train.id, dragPos));
                return {
                  onDrag(dx, dy) {
                    dragPos = Tx2.translate(dragPos, { x: dx, y: dy });
                    updateWorld(moveTrain(world, train.id, dragPos.p));
                    const trackPath = findNearestTrackPath(flatNodes, dragPos);
                    ghostTrain = trackPath?.tx;
                  },
                  onDragEnd() {
                    const trackPath = findNearestTrackPath(flatNodes, dragPos);
                    if (trackPath) {
                      updateWorld(
                        dockTrainToTrack(
                          world,
                          train.id,
                          trackPath.node.id,
                          trackPath.t,
                          trackPath.pathName,
                          trackPath.reverse,
                        ),
                      );
                    }
                    ghostTrain = undefined;
                  },
                };
              },
            });
          },
        });
      });

      return m(
        "main",
        {
          tabIndex: -1,
          onkeydown(e: KeyboardEvent) {
            if (e.getModifierState("Control") || e.getModifierState("Meta")) {
              if (e.key === "z") {
                // TODO: Undo stack.
                // updateWorld(history.pop() ?? world);
              }
            } else {
              keyMap.get(e.key)?.();
            }
          },
          onpointermove(e: MithrilEvent<PointerEvent>) {
            e.redraw = false;
            mousePos = { x: e.clientX, y: e.clientY };
          },
        },
        m(
          Toolbar,
          {
            canUndo: false,
            canRedo: false,
            onNewWorld: () => {
              m.route.set("/new");
            },
            onUndo: () => {
              throw new Error("Undo not implemented yet");
            },
            onRedo: () => {
              throw new Error("Undo not implemented yet");
            },
          },
          store.listProjects().map(([key, project]) =>
            m(ProjectRow, {
              key,
              id: key,
              created: project.created,
              modified: project.modified,
              active: worldId === key,
              onLoad: () => {
                m.route.set(`/world/${key}`);
              },
              onDelete: () => {
                const result = confirm(
                  "Are you sure you want to delete this world? This action cannot be undone.",
                );
                if (result) {
                  m.route.set("/new");
                  store.deleteProject(key);
                }
              },
            }),
          ),
          m(
            Toolbox,
            m(
              ToolboxItem,
              {
                onclick: () => addNodeAtMouse("a1"),
              },
              trackRegistry["a1"].view(),
            ),
            m(
              ToolboxItem,
              {
                onclick: () => addNodeAtMouse("e1"),
              },
              trackRegistry["e1"].view(),
            ),
            m(
              ToolboxItem,
              {
                onclick: () => addNodeAtMouse("y1"),
              },
              trackRegistry["y1"].view(),
            ),
            m(
              ToolboxItem,
              {
                onclick: () => addNodeAtMouse("y2"),
              },
              trackRegistry["y2"].view(),
            ),
          ),
        ),
        m(
          Workspace,
          {
            offset: world.offset,
            onpan(offset) {
              updateWorld(
                produce(world, (draft) => {
                  draft.offset = offset;
                }),
              );
            },
            onclick() {
              updateWorld(deselect(world));
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
        Tx2.angleBetween(startTx.r, tx.r) < 10
      ) {
        return { node, pathName, t: 0 };
      }
      const endTx = path(length);
      if (
        Vec2.dist(endTx.p, tx.p) < EPSILON &&
        Tx2.angleBetween(endTx.r, tx.r) < 10
      ) {
        return { node, pathName, t: length };
      }
    }
  }
}
