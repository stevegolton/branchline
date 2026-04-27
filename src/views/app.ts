import m from "mithril";
import { type Vec2 } from "../geom";
import { startDrag } from "../dom";
import "../styles.css";
import { trackRegistry } from "../track_registry";
import {
  createWorkspace,
  type DockedTrack,
  type Workspace,
} from "../workspace";
import { createProjectStore } from "../project_store";
import { createSimulator, trainWorld, type TrainState } from "../simulator";
import { TrackPiece, type TrackPieceAttrs } from "./track_piece";
import { Toolbar } from "./toolbar";
import { ProjectRow } from "./project_row";

interface NormalizedTrack {
  readonly id: string;
  readonly kind: keyof typeof trackRegistry;
  readonly position: Vec2;
  readonly orientation: number;
  readonly flipped: boolean;
  readonly isRoot: boolean; // Whether this track is a root track (not docked to any other)
}

// Normalize a workspace's tree of tracks into a flat list where each track
// peice has absolute world coordinates. This is more convenient for working
// with simulations.
function normalizeTracks(workspace: Workspace): NormalizedTrack[] {
  const result: NormalizedTrack[] = [];
  function addTrack(
    track: DockedTrack,
    position: Vec2,
    orientation: number,
    isRoot = false,
  ) {
    result.push({
      id: track.id,
      kind: track.kind,
      position,
      orientation,
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
      const localX = port.offset.x;
      const localY = port.offset.y * flipSign;
      const world = {
        x: position.x + localX * cos - localY * sin,
        y: position.y + localX * sin + localY * cos,
      };
      const portRotation = (orientation + port.rotation * flipSign + 360) % 360;
      const docked = track.docked?.[i];
      if (docked) {
        addTrack(docked, world, portRotation);
      }
    });
  }
  workspace.tracks.forEach((t) =>
    addTrack(t, t.position, t.orientation ?? 0, true),
  );
  return result;
}

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
  let trainState: TrainState | null = null;
  // Past world transforms of the train, newest-first. Used to render trailing
  // carriages at time-delayed positions.
  const TRAIL_MAX_AGE_MS = 2000;
  const trail: { ts: number; position: Vec2; rotation: number }[] = [];
  // Time offsets (ms) for each carriage behind the engine.
  const CARRIAGE_DELAYS_MS = [180, 360];
  const simulator = createSimulator(
    () => workspace.workspace,
    () => trainState,
    (s) => {
      trainState = s;
    },
  );

  function sampleTrail(
    ageMs: number,
  ): { position: Vec2; rotation: number } | null {
    if (trail.length === 0) return null;
    const target = trail[0].ts - ageMs;
    // trail is newest-first; find the first sample at or older than target.
    for (let i = 0; i < trail.length; i++) {
      if (trail[i].ts <= target) return trail[i];
    }
    return trail[trail.length - 1];
  }

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

  const attractors: { position: Vec2 }[] = [];

  let train: {
    pos: Vec2;
    orientaion: number;
    acceleration: number;
    velocity: number;
    turnAngle: number;
  } = {
    pos: { x: 0, y: 0 },
    orientaion: 0,
    velocity: 0,
    acceleration: 0,
    turnAngle: 0,
  };

  const sensorOffsets = { x: 80, y: 20 };

  function tick(el: HTMLElement) {
    // Move the train around the track...
    // requestAnimationFrame(() => tick(el));

    // Sum up the "gravitational" pull of all the attractors on each of the sensor points on the train (either side of the front axle).
    const sensor1 = {
      x:
        train.pos.x +
        Math.cos(train.orientaion) * sensorOffsets.x -
        Math.sin(train.orientaion) * sensorOffsets.y,
      y:
        train.pos.y +
        Math.sin(train.orientaion) * sensorOffsets.x +
        Math.cos(train.orientaion) * sensorOffsets.y,
    };
    const sensor2 = {
      x:
        train.pos.x +
        Math.cos(train.orientaion) * sensorOffsets.x +
        Math.sin(train.orientaion) * sensorOffsets.y,
      y:
        train.pos.y +
        Math.sin(train.orientaion) * sensorOffsets.x -
        Math.cos(train.orientaion) * sensorOffsets.y,
    };
    let sensor1Force = 0;
    let sensor2Force = 0;
    for (const a of attractors) {
      const dx = a.position.x - sensor1.x;
      const dy = a.position.y - sensor1.y;
      const distSq = dx * dx + dy * dy;
      sensor1Force += 1 / distSq;
    }

    // Sum up sensor 2's forces
    for (const a of attractors) {
      const dx = a.position.x - sensor2.x;
      const dy = a.position.y - sensor2.y;
      const distSq = dx * dx + dy * dy;
      sensor2Force += 1 / distSq;
    }

    const forceDiff = sensor1Force - sensor2Force;
    console.log("Sensor forces", forceDiff);

    const drag = 0.003 * train.velocity;
    train.velocity += train.acceleration - drag;
    train.pos = {
      x: train.pos.x + Math.cos(train.orientaion) * train.velocity,
      y: train.pos.y + Math.sin(train.orientaion) * train.velocity,
    };
    const turn = Math.max(
      Math.min(forceDiff + train.turnAngle * 0.01, 0.05),
      -0.05,
    );
    train.orientaion += turn * train.velocity;
    el.style.transform = `translate(${train.pos.x}px, ${train.pos.y}px) rotate(${train.orientaion}rad)`;
    console.log(train);

    // Use the difference in forces to adjust the turn angle
    // train.turnAngle += forceDiff * 0.5;
  }

  return {
    oncreate({ dom }: m.VnodeDOM) {
      const trainEl = document.createElement("div");
      trainEl.className = "train";
      for (const dy of [sensorOffsets.y, -sensorOffsets.y]) {
        const sensor = document.createElement("div");
        sensor.className = "train-sensor";
        sensor.style.left = `${sensorOffsets.x}px`;
        sensor.style.top = `calc(50% + ${dy}px)`;
        trainEl.appendChild(sensor);
      }
      dom.querySelector(".workspace")?.appendChild(trainEl);

      // Focus the main element so that it can receive keyboard events
      (dom as HTMLElement).focus();
      requestAnimationFrame(() => tick(trainEl));
    },
    view() {
      attractors.length = 0;

      const currentHash = getCurrentHash();
      let noSuchWorkspace = false;
      if (currentHash !== previousUuid) {
        if (currentHash) {
          previousUuid = currentHash;
          const project = store.getProject(currentHash);
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

      // Normalize the workspace's tree of docked tracks into a flat list of
      // pieces with world coordinates, for easier rendering and simulation.
      // TODO - only do this when the workspace changes, which we can tell.
      const normalizedTracks = normalizeTracks(workspace.workspace);

      const trackPieces: m.Children[] = [];

      for (const track of normalizedTracks) {
        const manifest = trackRegistry[track.kind];

        let translate = track.position;
        if (draggedTrack && track.id === draggedTrack.id) {
          translate = draggedTrack.position;
        }

        trackPieces.push(
          m(
            TrackPiece,
            {
              translate: translate,
              rotation: track.orientation,
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
            },
            manifest.view(),
          ),
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
            } else if (e.code === "ArrowUp") {
              train.acceleration = 0.01;
            } else if (e.code === "ArrowDown") {
              train.acceleration = -0.01;
            } else if (e.code === "ArrowLeft") {
              if (!e.repeat) train.turnAngle -= 1;
            } else if (e.code === "ArrowRight") {
              if (!e.repeat) train.turnAngle += 1;
            }
          },
          onkeyup: (e: KeyboardEvent) => {
            if (e.code === "ArrowUp") {
              train.acceleration = 0;
            } else if (e.code === "ArrowDown") {
              train.acceleration = 0;
            } else if (e.code === "ArrowLeft") {
              if (!e.repeat) train.turnAngle += 1;
            } else if (e.code === "ArrowRight") {
              if (!e.repeat) train.turnAngle -= 1;
            }
          },
        },
        m(
          Toolbar,
          {
            canUndo: workspace.canUndo,
            canRedo: workspace.canRedo,
            isPlaying: simulator.running,
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
            onPlayPause: () => {
              if (simulator.running) simulator.stop();
              else simulator.start();
            },
            onAddTrack: (kind) => {
              const center = {
                x: window.innerWidth / 2 - workspaceOffset.x,
                y: window.innerHeight / 2 - workspaceOffset.y,
              };
              workspace.addTrack({
                kind,
                orientation: 0,
                position: center,
              });
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
          (() => {
            if (!trainState) {
              trail.length = 0;
              return null;
            }
            const tw = trainWorld(trainState, workspace.workspace);
            if (!tw) return null;

            // Record this sample at the head of the trail; drop stale ones.
            const now = performance.now();
            trail.unshift({
              ts: now,
              position: tw.position,
              rotation: tw.rotation,
            });
            const cutoff = now - TRAIL_MAX_AGE_MS;
            while (trail.length > 0 && trail[trail.length - 1].ts < cutoff) {
              trail.pop();
            }

            const blob = (pos: Vec2, color: string, size: number, z: number) =>
              m(".train", {
                style: {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: `${size}px`,
                  height: `${size}px`,
                  borderRadius: "50%",
                  background: color,
                  border: "3px solid black",
                  transform: `translate(${pos.x - size / 2}px, ${pos.y - size / 2}px)`,
                  pointerEvents: "none",
                  zIndex: z,
                },
              });

            return [
              blob(tw.position, "crimson", 20, 7),
              ...CARRIAGE_DELAYS_MS.map((delay, i) => {
                const s = sampleTrail(delay);
                return s ? blob(s.position, "#333", 16, 6 - i) : null;
              }),
            ];
          })(),
        ),
      );
    },
  };
}

window.addEventListener("hashchange", m.redraw);
