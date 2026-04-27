import m from "mithril";
import { angleBetween, tx2Css, type Transform2 } from "../geom";
import { startDrag } from "../dom";
import "../styles.css";
import { trackRegistry } from "../track_registry";
import { createWorkspace, type DockedTrack, type Track } from "../workspace";
import { createProjectStore } from "../project_store";
import { TrackView } from "./track";
import { Toolbar } from "./toolbar";
import { ProjectRow } from "./project_row";
import { track2Global, type NormalizedTrack } from "../track";
import { runTrainTick, TrainView, type Train } from "../train";
import * as Vec2 from "../vec2";
import { Workspace } from "./workspace";
import { Toolbox, ToolboxItem } from "./toolbox";
import a1 from "../track/a1";
import c1 from "../track/e1";
import y1 from "../track/y1";
import y2 from "../track/y2";

const DOCK_THRESHOLD = 40;

// Normalize a workspace's tree of tracks into a flat list where each track
// piece has absolute world coordinates. This is more convenient for working
// with simulations.
function normalizeTracks(tracks: readonly Track[]): NormalizedTrack[] {
  const result: NormalizedTrack[] = [];
  function addTrack(
    track: DockedTrack,
    position: Vec2.Vec2,
    orientation: number,
    isRoot = false,
  ) {
    result.push({
      id: track.id,
      kind: track.kind,
      p: position,
      r: orientation,
      flipped: track.flipped ?? false,
      isRoot,
    });
    const manifest = trackRegistry[track.kind];
    const ports = manifest.ports;
    const outPorts = ports.filter((p) => p.direction === "out");
    const rad = (orientation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const flipSign = track.flipped ? -1 : 1;
    outPorts.forEach((port, i) => {
      const localX = port.p.x;
      const localY = port.p.y * flipSign;
      const world = {
        x: position.x + localX * cos - localY * sin,
        y: position.y + localX * sin + localY * cos,
      };
      const portRotation = (orientation + port.r * flipSign + 360) % 360;
      const docked = track.docked?.[i];
      if (docked) {
        addTrack(docked, world, portRotation);
      }
    });
  }
  tracks.forEach((t) => addTrack(t, t.p, t.r ?? 0, true));
  return result.map(() => {});
}

function getCurrentHash(): string | null {
  const match = location.hash.match(/^#\/project\/([0-9a-fA-F-]+)$/);
  return match ? match[1] : null;
}

export function App(): m.Component {
  let previousUuid: string | null = null;
  let mousePos = { x: 0, y: 0 };
  let workspaceOffset: Vec2.Vec2 = { x: 0, y: 0 };
  // Drag-time ghost: shows where the dragged piece will land if dropped now.
  let snapGhost: {
    kind: keyof typeof trackRegistry;
    flipped?: boolean;
    p: Vec2.Vec2;
    r: number;
  } | null = null;
  let workspace = createWorkspace({ tracks: [] });
  const store = createProjectStore();
  let selectedId: string | null = null;
  let draggedTrack: {
    id: string;
    position: Vec2.Vec2;
  } | null = null;
  let trains: readonly Train[] = [];
  let grabbedTrainId: string | null = null;
  let trainSnapPoint: { trackId: string; t: number; reverse: boolean } | null =
    null;

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

  interface OutputPortWorld {
    owner: DockedTrack;
    portIndex: number; // index into owner.docked
    world: Vec2.Vec2;
    rotation: number;
  }

  function collectOutputPorts(
    track: DockedTrack,
    translate: Vec2.Vec2,
    rotation: number,
    out: OutputPortWorld[],
    skipId: string,
  ) {
    if (track.id === skipId) return; // Don't consider the piece being dragged or its subtree
    const { kind, docked, flipped } = track;
    const outPorts = trackRegistry[kind].ports.filter(
      (p) => p.direction === "out",
    );
    const rad = (rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const flipSign = flipped ? -1 : 1;
    outPorts.forEach((port, i) => {
      // Flip the port into the piece's local frame first (mirror y), then
      // rotate into the parent's world frame.
      const localX = port.p.x;
      const localY = port.p.y * flipSign;
      const world = {
        x: translate.x + localX * cos - localY * sin,
        y: translate.y + localX * sin + localY * cos,
      };
      const portRotation = (rotation + port.r * flipSign + 360) % 360;
      if (!docked?.[i]) {
        out.push({ owner: track, portIndex: i, world, rotation: portRotation });
      }
      if (docked?.[i]) {
        collectOutputPorts(docked[i], world, portRotation, out, skipId);
      }
    });
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

      // Kick off the ticks
      function tick() {
        requestAnimationFrame(tick);
        m.redraw();

        const normalizedTracks = normalizeTracks(workspace.state.tracks);
        trains = trains.map((train) => runTrainTick(normalizedTracks, train));
      }
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

      // Normalize the workspace's tree of docked tracks into a flat list of
      // pieces with world coordinates, for easier rendering and simulation.
      // TODO - only do this when the workspace changes, which we can tell.
      const normalizedTracks = normalizeTracks(workspace.state.tracks);
      const trackPieces: m.Children[] = [];

      for (const track of normalizedTracks) {
        const manifest = trackRegistry[track.kind];

        let translate = track.p;
        if (draggedTrack && track.id === draggedTrack.id) {
          translate = draggedTrack.position;
        }

        trackPieces.push(
          m(
            TrackView,
            {
              id: track.id,
              tx: { p: translate, r: track.r },
              flipped: track.flipped,
              selected: track.id === selectedId,
              ports: manifest.ports,
              isRoot: track.isRoot,
              onpointerdown: (e: PointerEvent) => {
                e.stopPropagation(); // Prevent the main view's pointerdown from firing
                const node = e.currentTarget as HTMLElement;
                selectedId = track.id;
                startDrag(e, node, 4, {
                  onDragStart: () => {
                    let currentPos = translate;
                    draggedTrack = { id: track.id, position: currentPos };

                    // Find the output port closest to the dragged piece's
                    // input, across the whole tree (minus its own subtree).
                    // Returns the nearest candidate and its distance — even
                    // if it exceeds DOCK_THRESHOLD; callers decide whether
                    // to act on it.
                    const findNearestPort = (): {
                      candidate: OutputPortWorld;
                      distance: number;
                    } | null => {
                      const inputWorld = currentPos;
                      const candidates: OutputPortWorld[] = [];
                      for (const t of workspace.state.tracks) {
                        collectOutputPorts(
                          t,
                          t.p,
                          t.r ?? 0,
                          candidates,
                          track.id,
                        );
                      }
                      let best: OutputPortWorld | null = null;
                      let bestDist = Infinity;
                      for (const c of candidates) {
                        const d = Math.hypot(
                          c.world.x - inputWorld.x,
                          c.world.y - inputWorld.y,
                        );
                        if (d < bestDist) {
                          best = c;
                          bestDist = d;
                        }
                      }
                      return best
                        ? { candidate: best, distance: bestDist }
                        : null;
                    };

                    return {
                      onDrag(deltaX, deltaY) {
                        currentPos = {
                          x: currentPos.x + deltaX,
                          y: currentPos.y + deltaY,
                        };
                        draggedTrack = { id: track.id, position: currentPos };
                        const nearest = findNearestPort();
                        if (nearest && nearest.distance < DOCK_THRESHOLD) {
                          snapGhost = {
                            kind: track.kind,
                            flipped: track.flipped,
                            p: nearest.candidate.world,
                            r: nearest.candidate.rotation,
                          };
                        } else {
                          snapGhost = null;
                        }
                      },
                      onDragEnd() {
                        const nearest = findNearestPort();
                        const best =
                          nearest && nearest.distance < DOCK_THRESHOLD
                            ? nearest.candidate
                            : null;
                        snapGhost = null;

                        if (best) {
                          workspace.dockTrack(
                            track.id,
                            best.owner.id,
                            best.portIndex,
                          );
                          saveProject();
                        } else {
                          workspace.moveTrack(track.id, currentPos);
                          saveProject();
                        }

                        draggedTrack = null;
                      },
                    };
                  },
                });
              },
            },
            manifest.view(),
          ),
        );
      }

      function getGlobalTrainTx(train: Train): Transform2 {
        const tx = trainSnapPoint ? trainSnapPoint : train.tx;
        if ("trackId" in tx) {
          // The train is locked to a track. Return the train's global position
          // based on the track's current position.
          const track = normalizedTracks.find((t) => t.id === tx.trackId);
          if (track) {
            const manifest = trackRegistry[track.kind];
            const local = manifest.path
              ? manifest.path(tx.t)
              : { p: { x: 0, y: 0 }, r: 0 };
            return track2Global(track, {
              ...local,
              r: local.r + (tx.reverse ? 180 : 0),
            });
          } else {
            return { p: { x: 0, y: 0 }, r: 0 };
          }
        } else {
          // The train is free-floating. Return its current transform.
          return tx;
        }
      }

      // Return the nearest track and t value around a path for a given
      // position.
      function findNearestTrackPoint(
        tx: Transform2,
      ): { trackId: string; t: number; reverse: boolean } | null {
        // Iterate through the normalized track pieces and find the nearest
        // point on any piece's path to tx.
        const CULL_DIST_LIMIT = 300;
        const TRAIN_DIST_LIMIT = 50;

        // Find the set of nearby tracks
        const nearbyTracks = normalizedTracks
          .map((t) => {
            const delta = Vec2.delta(tx.p, t.p);
            const dist = Vec2.hypot(delta);
            return {
              id: t.id,
              dist,
              pos: t.p,
              t,
            };
          })
          .sort((a, b) => a.dist - b.dist)
          .filter((t) => t.dist < CULL_DIST_LIMIT);

        // Find the nearest point on any nearby track's path, and return the
        // track ID and t value for that point.
        const nearestPoints = nearbyTracks
          // Convert each track piece in the list to a snap point
          // on that piece, if it has a path.
          .map((track) => {
            // For each nearby track, find the nearest point on
            // its parameterized path. Do the stupid thing first -
            // just split the path up into points and we can
            // search for the closest one.
            const manifest = trackRegistry[track.t.kind];
            if (manifest.path) {
              let nearestPoint:
                | { dist: number; t: number; reverse: boolean }
                | undefined;
              for (let t = 0; t < 1; t += 0.01) {
                const pt = manifest.path(t);
                // Transform the point to global coords
                const ptGlobal = track2Global(track.t, pt);
                const delta = Vec2.delta(tx.p, ptGlobal.p);
                const dist = Vec2.hypot(delta);
                // Also find the nearest rotation, accounting for the current
                // train rotation.
                const reverse =
                  angleBetween(pt.r, tx.r) > angleBetween(pt.r, tx.r + 180);

                if (!nearestPoint || dist < nearestPoint.dist) {
                  nearestPoint = {
                    dist,
                    t,
                    reverse,
                  };
                }
              }

              return {
                ...nearestPoint!, // Assume nearest is defined
                track: track.t,
              };
            } else {
              return {
                t: 0,
                dist: Infinity, // Dummy
                track: track.t,
                reverse: false, // Dummy
              };
            }
          })
          .sort((a, b) => {
            return a.dist - b.dist;
          })
          .filter((t) => t.dist < TRAIN_DIST_LIMIT);

        if (nearestPoints.length > 0) {
          const nearestPoint = nearestPoints[0];
          return {
            trackId: nearestPoint.track.id,
            t: nearestPoint.t,
            reverse: nearestPoint.reverse, // TODO - handle reversed paths
          };
        } else {
          return null;
        }
      }

      // Render the trains
      for (const train of trains) {
        const trainTx = getGlobalTrainTx(train);

        trackPieces.push(
          m(TrainView, {
            tx: trainTx,
            onpointerdown: (e: PointerEvent) => {
              e.stopPropagation(); // Prevent the main view's pointerdown from firing
              const node = e.currentTarget as HTMLElement;
              startDrag(e, node, 4, {
                onDragStart: () => {
                  let currentTx = trainTx;
                  return {
                    onDrag(deltaX, deltaY) {
                      currentTx = {
                        ...currentTx,
                        p: {
                          x: currentTx.p.x + deltaX,
                          y: currentTx.p.y + deltaY,
                        },
                      };
                      train.tx = currentTx;

                      const nearestSnapPoint = findNearestTrackPoint(currentTx);
                      if (nearestSnapPoint) {
                        trainSnapPoint = nearestSnapPoint;
                      } else {
                        trainSnapPoint = null;
                      }
                    },
                    onDragEnd() {
                      train.tx = trainSnapPoint ?? train.tx;
                      trainSnapPoint = null;
                    },
                  };
                },
              });
            },
          }),
        );
      }

      return m(
        "main",
        {
          tabIndex: -1,
          onmousemove: (e: MouseEvent) => {
            mousePos = { x: e.clientX, y: e.clientY };
          },
          onpointerdown: (e: PointerEvent) => {
            startDrag(e, e.currentTarget as HTMLElement, 4, {
              onDragStart: () => {
                return {
                  onDrag(deltaX, deltaY) {
                    workspaceOffset = {
                      x: workspaceOffset.x + deltaX,
                      y: workspaceOffset.y + deltaY,
                    };
                  },
                };
              },
              onDragFailed: () => {
                selectedId = null;
              },
            });
          },
          onkeydown: (e: KeyboardEvent) => {
            // Pressing N adds a new track piece under the mouse oriented north
            const spawnPos = {
              x: mousePos.x - workspaceOffset.x,
              y: mousePos.y - workspaceOffset.y,
            };
            if (e.code === "KeyN") {
              workspace.addTrack({
                kind: "a1",
                r: 0,
                p: spawnPos,
              });
              // The moment we edit anything - save the workspace, ensure it has a uuid
              saveProject();
            } else if (e.code === "KeyC") {
              workspace.addTrack({
                kind: "c1",
                r: 0,
                p: spawnPos,
              });
              saveProject();
            } else if (e.code === "KeyY") {
              workspace.addTrack({
                kind: "y1",
                r: 0,
                p: spawnPos,
              });
              saveProject();
            } else if (e.code === "KeyU") {
              workspace.addTrack({
                kind: "y2",
                r: 0,
                p: spawnPos,
              });
              saveProject();
            } else if (e.code === "Delete" || e.code === "Backspace") {
              if (selectedId) {
                workspace.removeTrack(selectedId);
                selectedId = null;
                saveProject();
              }
            } else if (e.code === "KeyF") {
              if (selectedId) {
                workspace.flipTrack(selectedId);
                saveProject();
              }
            } else if (e.code === "KeyQ") {
              if (selectedId) {
                workspace.rotateTrack(selectedId, "ccw");
                saveProject();
              }
            } else if (e.code === "KeyE") {
              if (selectedId) {
                workspace.rotateTrack(selectedId, "cw");
                saveProject();
              }
            } else if (e.code === "KeyD") {
              if (selectedId) {
                const id = workspace.duplicateTrack(selectedId, spawnPos);
                selectedId = id;
                saveProject();
              }
            } else if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
              if (e.shiftKey) {
                workspace.redo();
              } else {
                workspace.undo();
              }
              saveProject();
            } else if (e.code === "KeyT") {
              trains.push({
                tx: { p: mousePos, r: 0 },
              });
            }
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
            onAddTrack: (kind) => {
              const center = {
                x: window.innerWidth / 2 - workspaceOffset.x,
                y: window.innerHeight / 2 - workspaceOffset.y,
              };
              workspace.addTrack({
                kind,
                r: 0,
                p: center,
              });
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
            m(ToolboxItem, a1.view()),
            m(ToolboxItem, c1.view()),
            m(ToolboxItem, y1.view()),
            m(ToolboxItem, y2.view()),
          ),
        ),

        m(
          Workspace,
          {
            offset: workspaceOffset,
          },
          snapGhost
            ? m(
                ".ghost",
                {
                  style: {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transformOrigin: "top left",
                    transform: `${tx2Css(snapGhost)} ${snapGhost.flipped ? " scaleY(-1)" : ""}`,
                    pointerEvents: "none",
                  },
                },
                trackRegistry[snapGhost.kind].view(),
              )
            : null,
          trackPieces,
        ),
      );
    },
  };
}

window.addEventListener("hashchange", m.redraw);
