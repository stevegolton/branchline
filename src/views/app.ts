import m from "mithril";
import { type MithrilEvent } from "../dom";
import { Tx2, Vec2 } from "../geom";
import { type World, type Track, emptyWorld, type Locomotive } from "../world";
import { trackRegistry } from "../track_registry";
import { ProjectRow } from "./project_row";
import { Toolbar } from "./toolbar";
import { TrackView } from "./track";
import { TrainView } from "./train";
import { Workspace } from "./workspace";
import { Toolbox, ToolboxItem } from "./toolbox";
import "./app.css";
import { uuid } from "../utils";
import { createProjectStore } from "../project_store";
import {
  type FlatTrackNode,
  addCarriage,
  addRootTrack,
  addTrain,
  derailTrain,
  deselect,
  dockTrack,
  dockTrainToTrack,
  duplicateSelected,
  findNearestTrackPath,
  findRailedPosition,
  flatten,
  flipSelected,
  moveRootTrack,
  moveTrain,
  panWorld,
  removeSelected,
  rotateSelected,
  selectEntity,
  tick,
  undockTrack,
} from "../actions";

export interface AppAttrs {
  readonly worldId?: string;
}

export function App(): m.Component<AppAttrs> {
  const store = createProjectStore();
  let previousWorldId: string | undefined | null;
  let draggedTrain: { id: string; tx: Tx2 } | undefined;
  let draggedTrack: { id: string; tx: Tx2 } | undefined;
  let ghostTrain: { type: "locomotive" | "carriage"; tx: Tx2 } | undefined;
  let ghostTrackNode: FlatTrackNode | undefined;
  let running = true;
  let mousePos: Vec2 = { x: 0, y: 0 };
  let cachedWorld: World | undefined;

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
    function updateWorld(update: (world: World) => World, save = true) {
      if (!cachedWorld) return;
      const newWorld = update(cachedWorld);
      cachedWorld = newWorld;
      window.world = newWorld;
      if (!save) return;
      if (worldId) {
        store.saveProject(worldId ?? uuid(), newWorld);
      } else {
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
      // When tab is hidden, pause ticks
      document.addEventListener("visibilitychange", () => {
        running = !document.hidden;
        m.redraw();
      });
    },
    view({ attrs }: m.Vnode<AppAttrs>) {
      const worldId = attrs.worldId;
      const { world, updateWorld } = useWorld(worldId ?? null);

      if (!world) {
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

      const flatNodes = flatten(world);

      // If we're running schedule another redraw on the next animation frame.
      if (running) m.redraw();

      // Advance the simulation by one tick on each redraw.
      updateWorld((world) => tick(world, draggedTrain?.id), false);

      function addNodeAtMouse(kind: keyof typeof trackRegistry) {
        updateWorld((world) => addRootTrack(world, kind, mousePos));
      }

      function collectSubtreeIds(track: Track, out: Set<string>) {
        out.add(track.id);
        for (const child of Object.values(track.dockedNodes)) {
          collectSubtreeIds(child, out);
        }
      }

      function findDockTarget(
        nodes: readonly FlatTrackNode[],
        targetTx: Tx2,
        targetNodeId: string,
      ) {
        // The dragged track is a root (it was undocked on pointerdown), so we
        // only need to look at world.tracks to find its subtree.
        const excluded = new Set<string>([targetNodeId]);
        const draggedRoot = world?.tracks.find((t) => t.id === targetNodeId);
        if (draggedRoot) collectSubtreeIds(draggedRoot, excluded);

        const DOCKING_DIST = 40;
        const nearbyPorts = nodes
          .filter((node) => !excluded.has(node.id))
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
        ["f", () => updateWorld(flipSelected)],
        ["q", () => updateWorld((w) => rotateSelected(w, "ccw"))],
        ["e", () => updateWorld((w) => rotateSelected(w, "cw"))],
        ["Delete", () => updateWorld(removeSelected)],
        ["Backspace", () => updateWorld(removeSelected)],
        ["n", () => addNodeAtMouse("a1")],
        ["c", () => addNodeAtMouse("e1")],
        ["y", () => addNodeAtMouse("y1")],
        ["u", () => addNodeAtMouse("y2")],
        ["d", () => updateWorld((w) => duplicateSelected(w, mousePos))],
        ["t", () => updateWorld((w) => addTrain(w, mousePos))],
        ["g", () => updateWorld((w) => addCarriage(w, mousePos))],
      ]);

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
              e.stopPropagation();

              // Capture the pointer
              const el = e.currentTarget as HTMLElement;
              el.setPointerCapture(e.pointerId);

              draggedTrack = { id: node.id, tx: node.tx };

              updateWorld((w) =>
                undockTrack(selectEntity(w, node.id), node.id, node.tx),
              );
            },
            onpointermove(e: PointerEvent) {
              if (draggedTrack?.id === node.id) {
                const draggedPos = Tx2.translate(draggedTrack.tx, {
                  x: e.movementX,
                  y: e.movementY,
                });
                draggedTrack = {
                  ...draggedTrack,
                  tx: draggedPos,
                };
                updateWorld((w) => moveRootTrack(w, node.id, draggedPos.p));

                // See if we're near a docking point for this track
                const trackPort = findDockTarget(
                  flatNodes,
                  draggedPos,
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
              }
            },
            onpointerup() {
              if (draggedTrack?.id === node.id) {
                // See if we're near a docking point for this track TODO here we
                // need to make sure that we're not going to dock to one of our
                // child nodes, otherwise we could create a cycle in the track
                // graph.
                const trackPort = findDockTarget(
                  flatNodes,
                  draggedTrack.tx,
                  node.id,
                );

                if (trackPort) {
                  updateWorld((w) =>
                    dockTrack(
                      w,
                      node.id,
                      trackPort.node.id,
                      trackPort.portName,
                    ),
                  );
                }

                draggedTrack = undefined;
                ghostTrackNode = undefined;
              }
            },
          },
          node.view(),
        );
      });

      const trainNodes = world.trains.map((train) => {
        function findTrainTx(train: Locomotive): Tx2 {
          if (draggedTrain && draggedTrain.id === train.id) {
            return draggedTrain.tx;
          }

          if (train.kind === "derailed") {
            return train.tx;
          } else {
            // Find the railed position
            const tx = findRailedPosition(
              flatNodes,
              train.trackId,
              train.pathName,
              train.t,
            )!;
            return train.reverse ? Tx2.rotate(tx, 180) : tx;
          }
        }

        const trainTx = findTrainTx(train);
        const trainView = m(TrainView, {
          key: train.id,
          type: "locomotive",
          tx: trainTx,
          selected: train.id === world.selectedId,
          oncontextmenu(e: PointerEvent) {
            e.preventDefault();
          },
          onpointerdown(e: PointerEvent) {
            e.stopPropagation();

            // Pull out the element from the event
            const el = e.currentTarget as HTMLElement;
            el.setPointerCapture(e.pointerId);

            // Immediately select the train on pointer down
            updateWorld((w) => selectEntity(w, train.id));

            // Remember we're dragging this train.
            draggedTrain = {
              id: train.id,
              tx: trainTx,
            };
          },
          onpointermove(e: PointerEvent) {
            if (draggedTrain?.id === train.id) {
              const draggedPos = Tx2.translate(draggedTrain.tx, {
                x: e.movementX,
                y: e.movementY,
              });
              draggedTrain = {
                ...draggedTrain,
                tx: draggedPos,
              };
              const trackPath = findNearestTrackPath(flatNodes, draggedPos);
              if (trackPath) {
                ghostTrain = { type: "locomotive", tx: trackPath.tx };
              } else {
                ghostTrain = undefined;
              }
            }
          },
          onpointerup() {
            if (draggedTrain?.id === train.id) {
              const trackPath = findNearestTrackPath(
                flatNodes,
                draggedTrain.tx,
              );
              if (trackPath) {
                updateWorld((w) =>
                  dockTrainToTrack(
                    w,
                    train.id,
                    trackPath.node.id,
                    trackPath.t,
                    trackPath.pathName,
                    trackPath.reverse,
                  ),
                );
              } else if (train.kind === "railed") {
                const tx = draggedTrain.tx;
                updateWorld((w) => derailTrain(w, train.id, tx));
              } else {
                const p = draggedTrain.tx.p;
                updateWorld((w) => moveTrain(w, train.id, p));
              }
              draggedTrain = undefined;
              ghostTrain = undefined;
            }
          },
        });

        const vnodes = [];

        if (train.kind === "railed") {
          let carriage = train.carriage;
          while (carriage) {
            const childTx = findRailedPosition(
              flatNodes,
              carriage.trackId,
              carriage.pathName,
              carriage.t,
            )!;

            vnodes.push(
              m(TrainView, {
                key: carriage.id,
                type: "carriage",
                tx: childTx, // train.reverse ? Tx2.rotate(childTx, 180) : childTx,
                selected: carriage.id === world.selectedId,
              }),
            );
            carriage = carriage.carriage;
          }
        } else if (train.kind === "derailed") {
          let carriage = train.carriage;
          let offset = Vec2.identity();
          while (carriage) {
            offset = Vec2.add(offset, { x: -100, y: 0 });
            vnodes.push(
              m(TrainView, {
                key: carriage.id,
                type: "carriage",
                tx: Tx2.translate(trainTx, offset),
                selected: carriage.id === world.selectedId,
              }),
            );
            carriage = carriage.carriage;
          }
        }

        return [trainView, ...vnodes].filter(Boolean);
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
              name: project.name,
              created: project.created,
              modified: project.modified,
              active: worldId === key,
              onRename: (name) => {
                store.renameProject(key, name);
              },
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
              updateWorld((w) => panWorld(w, offset));
            },
            onclick() {
              updateWorld(deselect);
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
              tx: ghostTrain.tx,
              type: ghostTrain.type,
              className: "ghost",
            }),
          m(".trains", trainNodes),
        ),
      );
    },
  };
}
