import m from "mithril";
import { type Vec2 } from "../geom";
import { startDrag } from "../dom";
import "../styles.css";
import { trackRegistry } from "../track_registry";
import { createWorkspace, type DockedTrack } from "../workspace";
import { createProjectStore } from "../project_store";
import { TrackPiece, type TrackPieceAttrs } from "./track_piece";
import { Toolbar } from "./toolbar";
import { ProjectRow } from "./project_row";

function getCurrentHash(): string | null {
  const match = location.hash.match(/^#\/project\/([0-9a-fA-F-]+)$/);
  return match ? match[1] : null;
}

const DOCK_THRESHOLD = 40;

export function App(): m.Component {
  let mousePos = { x: 0, y: 0 };
  let workspaceOffset: Vec2 = { x: 0, y: 0 };
  // Drag-time ghost: shows where the dragged piece will land if dropped now.
  let snapGhost: {
    kind: keyof typeof trackRegistry;
    flipped?: boolean;
    position: Vec2;
    rotation: number;
  } | null = null;
  let workspace = createWorkspace({ tracks: [] });
  const store = createProjectStore();
  let selectedId: string | null = null;
  let draggedTrack: {
    id: string;
    position: Vec2;
  } | null = null;

  function secureProject() {
    const uuid = getCurrentHash();
    if (uuid) {
      store.saveProject(uuid, workspace.workspace);
    } else {
      const uuid = crypto.randomUUID();
      store.saveProject(uuid, workspace.workspace);
      location.hash = `#/project/${uuid}`;
    }
  }

  interface OutputPortWorld {
    owner: DockedTrack;
    portIndex: number; // index into owner.docked
    world: Vec2;
    rotation: number;
  }

  function collectOutputPorts(
    track: DockedTrack,
    translate: Vec2,
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
      const localX = port.offset.x;
      const localY = port.offset.y * flipSign;
      const world = {
        x: translate.x + localX * cos - localY * sin,
        y: translate.y + localX * sin + localY * cos,
      };
      const portRotation = (rotation + port.rotation * flipSign + 360) % 360;
      if (!docked?.[i]) {
        out.push({ owner: track, portIndex: i, world, rotation: portRotation });
      }
      if (docked?.[i]) {
        collectOutputPorts(docked[i], world, portRotation, out, skipId);
      }
    });
  }

  let previousUuid: string | null = null;

  return {
    oncreate({ dom }: m.VnodeDOM) {
      // Focus the main element so that it can receive keyboard events
      (dom as HTMLElement).focus();
    },
    view() {
      const currentHash = getCurrentHash();
      let noSuchWorkspace = false;
      if (currentHash !== previousUuid) {
        console.log("Hash changed, loading workspace", currentHash);
        if (currentHash) {
          previousUuid = currentHash;
          const project = store.getProject(currentHash);
          console.log("Loaded project", project);
          if (project) {
            workspace = createWorkspace(project.workspace);
          } else {
            noSuchWorkspace = true;
          }
        } else {
          workspace = createWorkspace({ tracks: [] });
          previousUuid = null;
        }
      }

      if (noSuchWorkspace) {
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

      const trackPieces: m.Children[] = [];

      function renderTrack(
        track: DockedTrack,
        translate: Vec2,
        rotation: number,
        isRoot: boolean,
      ) {
        const { kind, docked, flipped } = track;
        const { view, ports } = trackRegistry[kind];

        if (draggedTrack && track.id === draggedTrack.id) {
          translate = draggedTrack.position;
        }

        const pieceTransform =
          `translate(${translate.x}px, ${translate.y}px) rotate(${rotation}deg)` +
          (flipped ? ` scaleY(-1)` : ``);

        trackPieces.push(
          m(
            TrackPiece,
            {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                transformOrigin: `top left`,
                transform: pieceTransform,
                width: 0,
                height: 0,
                color: isRoot ? "crimson" : "black",
              },
              selected: selectedId === track.id,
              ports,
              onpointerdown: (e: PointerEvent) => {
                e.stopPropagation(); // Prevent the main view's pointerdown from firing
                const node = e.currentTarget as HTMLElement;
                selectedId = track.id;
                startDrag(e, node, 4, {
                  onDragStart: () => {
                    // workspace.moveTrack(track.id, translate);
                    // secureProject();

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
                      for (const t of workspace.workspace.tracks) {
                        collectOutputPorts(
                          t,
                          t.position,
                          t.orientation ?? 0,
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
                            position: nearest.candidate.world,
                            rotation: nearest.candidate.rotation,
                          };
                        } else {
                          snapGhost = null;
                        }
                      },
                      onDragStop() {
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
                          secureProject();
                        } else {
                          workspace.moveTrack(track.id, currentPos);
                          secureProject();
                        }

                        draggedTrack = null;
                      },
                    };
                  },
                });
              },
            } satisfies TrackPieceAttrs,
            view(),
          ),
        );

        docked?.forEach((d, i) => {
          if (!d) return;
          // Work out the transform of each docked piece
          const outputPorts = trackRegistry[kind].ports.filter(
            (p) => p.direction === "out",
          );
          const port = outputPorts[i];

          // Mirror the port into the piece's local frame if flipped, then
          // rotate into the parent's world frame and add the parent's
          // translate. Children do not inherit the flip — only the port
          // geometry is mirrored so they attach on the correct side.
          const flipSign = flipped ? -1 : 1;
          const localX = port.offset.x;
          const localY = port.offset.y * flipSign;
          const rad = (rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          const dockTranslate = {
            x: translate.x + localX * cos - localY * sin,
            y: translate.y + localX * sin + localY * cos,
          };

          const dockRotation =
            (rotation + port.rotation * flipSign + 360) % 360;

          renderTrack(d, dockTranslate, dockRotation, false);
        });
      }

      workspace.workspace.tracks.forEach((x) =>
        renderTrack(x, x.position, x.orientation ?? 0, true),
      );

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
                orientation: 0,
                position: spawnPos,
              });
              // The moment we edit anything - save the workspace, ensure it has a uuid
              secureProject();
            } else if (e.code === "KeyC") {
              workspace.addTrack({
                kind: "c1",
                orientation: 0,
                position: spawnPos,
              });
              secureProject();
            } else if (e.code === "KeyY") {
              workspace.addTrack({
                kind: "y1",
                orientation: 0,
                position: spawnPos,
              });
              secureProject();
            } else if (e.code === "KeyU") {
              workspace.addTrack({
                kind: "y2",
                orientation: 0,
                position: spawnPos,
              });
              secureProject();
            } else if (e.code === "Delete" || e.code === "Backspace") {
              if (selectedId) {
                workspace.removeTrack(selectedId);
                selectedId = null;
                secureProject();
              }
            } else if (e.code === "KeyF") {
              if (selectedId) {
                workspace.flipTrack(selectedId);
                secureProject();
              }
            } else if (e.code === "KeyQ") {
              if (selectedId) {
                workspace.rotateTrack(selectedId, "ccw");
                secureProject();
              }
            } else if (e.code === "KeyE") {
              if (selectedId) {
                workspace.rotateTrack(selectedId, "cw");
                secureProject();
              }
            } else if (e.code === "KeyD") {
              if (selectedId) {
                const id = workspace.duplicateTrack(selectedId, spawnPos);
                selectedId = id;
                secureProject();
              }
            } else if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey)) {
              if (e.shiftKey) {
                workspace.redo();
              } else {
                workspace.undo();
              }
              secureProject();
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
              secureProject();
            },
            onRedo: () => {
              workspace.redo();
              secureProject();
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
                console.log("Removing track", key);
                store.deleteProject(key);
                if (getCurrentHash() === key) {
                  location.hash = "";
                  workspace = createWorkspace({ tracks: [] });
                }
              },
            }),
          ),
        ),
        m(
          ".workspace",
          {
            style: {
              position: "absolute",
              top: 0,
              left: 0,
              width: 0,
              height: 0,
              transform: `translate(${workspaceOffset.x}px, ${workspaceOffset.y}px)`,
              transformOrigin: "0 0",
            },
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
                    transform:
                      `translate(${snapGhost.position.x}px, ${snapGhost.position.y}px) rotate(${snapGhost.rotation}deg)` +
                      (snapGhost.flipped ? " scaleY(-1)" : ""),
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
