import m from "mithril";
import { type Vec2 } from "../geom";
import a1 from "../track/a1";
import c1 from "../track/c1";
import y1 from "../track/y1";
import y2 from "../track/y2";
import "../styles.css";
import { TrackPiece, type TrackPieceAttrs } from "./track_piece";
import { startDrag } from "../dom";

const trackRegistry = {
  a1,
  c1,
  y1,
  y2,
};

type DockedTrack = Omit<Track, "position" | "orientation">;

interface State {
  tracks: Track[];
  selectedId: string | null;
}

interface Track {
  readonly id: string;
  readonly kind: keyof typeof trackRegistry;
  position: Vec2;
  orientation: number;
  flipped?: boolean;
  // Port-indexed: slots may be undefined where no child is docked. Do not
  // filter/compact — that would break index→port alignment.
  docked?: (DockedTrack | undefined)[];
}

function createInitialState(): State {
  return {
    tracks: [
      {
        id: crypto.randomUUID(),
        kind: "c1",
        position: { x: 800, y: 600 },
        orientation: 0,
        docked: [
          {
            id: crypto.randomUUID(),
            kind: "c1",
            docked: [
              {
                id: crypto.randomUUID(),
                kind: "c1",
                docked: [
                  {
                    id: crypto.randomUUID(),
                    kind: "c1",
                    docked: [
                      {
                        id: crypto.randomUUID(),
                        kind: "c1",
                        docked: [
                          {
                            id: crypto.randomUUID(),
                            kind: "c1",
                            docked: [
                              {
                                id: crypto.randomUUID(),
                                kind: "a1",
                                docked: [
                                  {
                                    id: crypto.randomUUID(),
                                    kind: "a1",
                                    docked: [
                                      {
                                        id: crypto.randomUUID(),
                                        kind: "c1",
                                        flipped: true,
                                        docked: [
                                          {
                                            id: crypto.randomUUID(),
                                            kind: "c1",
                                            flipped: true,
                                            docked: [
                                              {
                                                id: crypto.randomUUID(),
                                                kind: "c1",
                                                flipped: true,
                                                docked: [
                                                  {
                                                    id: crypto.randomUUID(),
                                                    kind: "c1",
                                                    flipped: true,
                                                    docked: [
                                                      {
                                                        id: crypto.randomUUID(),
                                                        kind: "c1",
                                                        flipped: true,
                                                        docked: [
                                                          {
                                                            id: crypto.randomUUID(),
                                                            kind: "c1",
                                                            flipped: true,
                                                            docked: [
                                                              {
                                                                id: crypto.randomUUID(),
                                                                kind: "a1",
                                                                docked: [
                                                                  {
                                                                    id: crypto.randomUUID(),
                                                                    kind: "a1",
                                                                  },
                                                                ],
                                                              },
                                                            ],
                                                          },
                                                        ],
                                                      },
                                                    ],
                                                  },
                                                ],
                                              },
                                            ],
                                          },
                                        ],
                                      },
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    selectedId: null,
  };
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
  const state = createInitialState();

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

  // Remove a track from the tree. For roots (state.tracks) we splice the
  // array. For docked slots we null the slot rather than splice, to keep
  // sibling indices aligned with their owner's output-port indices.
  function findAndRemoveTrack(
    nodes: (Track | DockedTrack | undefined)[],
    id: string,
    isRootLevel: boolean,
  ): DockedTrack | null {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!n) continue;
      if (n.id === id) {
        if (isRootLevel) {
          nodes.splice(i, 1);
        } else {
          nodes[i] = undefined;
        }
        return n;
      }
      if (n.docked) {
        const found = findAndRemoveTrack(n.docked, id, false);
        if (found) return found;
      }
    }
    return null;
  }

  function findTrackInTree(
    nodes: readonly (Track | DockedTrack | undefined)[],
    id: string,
  ): DockedTrack | null {
    for (const n of nodes) {
      if (!n) continue;
      if (n.id === id) return n;
      if (n.docked) {
        const found = findTrackInTree(n.docked, id);
        if (found) return found;
      }
    }
    return null;
  }

  // Walk the tree and find the world transform of a track by id. Returns
  // { position, rotation } — the same values you'd pass as the piece's
  // own root position/orientation to keep it in place visually.
  function resolveWorldTransform(
    trackId: string,
  ): { position: Vec2; rotation: number } | null {
    function walk(
      track: DockedTrack,
      translate: Vec2,
      rotation: number,
    ): { position: Vec2; rotation: number } | null {
      if (track.id === trackId) {
        return { position: { ...translate }, rotation };
      }
      if (!track.docked) return null;
      const outPorts = trackRegistry[track.kind].ports.filter(
        (p) => p.direction === "out",
      );
      const rad = (rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const flipSign = track.flipped ? -1 : 1;
      for (let i = 0; i < track.docked.length; i++) {
        const child = track.docked[i];
        if (!child) continue;
        const port = outPorts[i];
        const localX = port.offset.x;
        const localY = port.offset.y * flipSign;
        const childTranslate = {
          x: translate.x + localX * cos - localY * sin,
          y: translate.y + localX * sin + localY * cos,
        };
        const childRotation = (rotation + port.rotation * flipSign + 360) % 360;
        const found = walk(child, childTranslate, childRotation);
        if (found) return found;
      }
      return null;
    }

    for (const t of state.tracks) {
      const found = walk(t, t.position, t.orientation);
      if (found) return found;
    }
    return null;
  }

  function rotateTrack(trackId: string, direction: "cw" | "ccw") {
    // If the track is docked, detach it first so rotation doesn't drag
    // its siblings or change the parent's port layout.
    let track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
      const world = resolveWorldTransform(trackId);
      const detached = findAndRemoveTrack(state.tracks, trackId, false);
      if (!detached || !world) return;
      track = {
        ...detached,
        position: world.position,
        orientation: world.rotation,
      };
      state.tracks.push(track);
    }
    track.orientation =
      direction === "cw"
        ? (track.orientation + 45) % 360
        : (track.orientation - 45 + 360) % 360;
  }

  function flipTrack(trackId: string) {
    const track = findTrackInTree(state.tracks, trackId);
    if (track) track.flipped = !track.flipped;
  }

  return {
    oncreate({ dom }: m.VnodeDOM) {
      // Focus the main element so that it can receive keyboard events
      (dom as HTMLElement).focus();
    },
    view() {
      const trackPieces: m.Children[] = [];

      function renderTrack(
        track: DockedTrack,
        translate: Vec2,
        rotation: number,
        isRoot: boolean,
      ) {
        const { kind, docked, flipped } = track;
        const { view, ports } = trackRegistry[kind];

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
              selected: state.selectedId === track.id,
              ports,
              onFlip: () => {
                flipTrack(track.id);
              },
              onRemove: () => {
                findAndRemoveTrack(state.tracks, track.id, true);
              },
              onpointerdown: (e: PointerEvent) => {
                e.stopPropagation(); // Prevent the main view's pointerdown from firing
                const node = e.currentTarget as HTMLElement;
                state.selectedId = track.id;
                startDrag(e, node, 4, {
                  onDragStart: () => {
                    // If we're a root level node, do nothing
                    let rootTrack = state.tracks.find((t) => t.id === track.id);
                    if (!rootTrack) {
                      // Detach this track from its parent's docked slot (null
                      // the slot rather than splicing, to keep port alignment).
                      findAndRemoveTrack(state.tracks, track.id, false);

                      // Add this track to the root level with the same position as the parent
                      rootTrack = {
                        ...track,
                        orientation: rotation,
                        position: {
                          x: translate.x,
                          y: translate.y,
                        },
                      };
                      state.tracks.push(rootTrack);
                      m.redraw();
                    }
                    // Find the output port closest to the dragged piece's
                    // input, across the whole tree (minus its own subtree).
                    // Returns the nearest candidate and its distance — even
                    // if it exceeds DOCK_THRESHOLD; callers decide whether
                    // to act on it.
                    const findNearestPort = (): {
                      candidate: OutputPortWorld;
                      distance: number;
                    } | null => {
                      const inputWorld = rootTrack.position;
                      const candidates: OutputPortWorld[] = [];
                      for (const t of state.tracks) {
                        collectOutputPorts(
                          t,
                          t.position,
                          t.orientation,
                          candidates,
                          rootTrack.id,
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
                      return best ? { candidate: best, distance: bestDist } : null;
                    };

                    return {
                      onDrag(deltaX, deltaY) {
                        rootTrack.position = {
                          x: rootTrack.position.x + deltaX,
                          y: rootTrack.position.y + deltaY,
                        };
                        const nearest = findNearestPort();
                        if (nearest && nearest.distance < DOCK_THRESHOLD) {
                          snapGhost = {
                            kind: rootTrack.kind,
                            flipped: rootTrack.flipped,
                            position: nearest.candidate.world,
                            rotation: nearest.candidate.rotation,
                          };
                        } else {
                          snapGhost = null;
                        }
                        m.redraw();
                      },
                      onDragStop() {
                        const nearest = findNearestPort();
                        const best =
                          nearest && nearest.distance < DOCK_THRESHOLD
                            ? nearest.candidate
                            : null;
                        snapGhost = null;

                        if (best) {
                          const removed = findAndRemoveTrack(
                            state.tracks,
                            rootTrack.id,
                            true,
                          );
                          if (removed) {
                            // Strip root-only fields when re-docking.
                            const {
                              position: _p,
                              orientation: _o,
                              ...docked
                            } = removed as Track;
                            best.owner.docked ??= [];
                            best.owner.docked[best.portIndex] =
                              docked as DockedTrack;
                            m.redraw();
                          }
                        }
                      },
                    };
                  },
                });
              },
            } satisfies TrackPieceAttrs,
            view(),
          ),
        );

        if (docked) {
          docked.forEach((d, i) => {
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
      }

      state.tracks.forEach((x) =>
        renderTrack(x, x.position, x.orientation, true),
      );

      function addTrack(track: Omit<Track, "id">) {
        const id = crypto.randomUUID();
        state.tracks.push({ id, ...track });
        state.selectedId = id;
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
                    m.redraw();
                  },
                };
              },
              onDragFailed: () => {
                state.selectedId = null;
                m.redraw();
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
              addTrack({ kind: "a1", orientation: 0, position: spawnPos });
            } else if (e.code === "KeyC") {
              addTrack({ kind: "c1", orientation: 0, position: spawnPos });
            } else if (e.code === "KeyY") {
              addTrack({ kind: "y1", orientation: 0, position: spawnPos });
            } else if (e.code === "KeyU") {
              addTrack({ kind: "y2", orientation: 0, position: spawnPos });
            } else if (e.code === "Delete" || e.code === "Backspace") {
              if (state.selectedId) {
                findAndRemoveTrack(state.tracks, state.selectedId, true);
                state.selectedId = null;
                m.redraw();
              }
            } else if (e.code === "KeyF") {
              if (state.selectedId) {
                flipTrack(state.selectedId);
                m.redraw();
              }
            } else if (e.code === "KeyQ") {
              if (state.selectedId) {
                rotateTrack(state.selectedId, "ccw");
                m.redraw();
              }
            } else if (e.code === "KeyE") {
              if (state.selectedId) {
                rotateTrack(state.selectedId, "cw");
                m.redraw();
              }
            } else if (e.code === "KeyD") {
              if (state.selectedId) {
                const src = findTrackInTree(state.tracks, state.selectedId);
                if (src) {
                  const world = resolveWorldTransform(src.id);
                  addTrack({
                    kind: src.kind,
                    flipped: src.flipped,
                    orientation: world?.rotation ?? 0,
                    position: spawnPos,
                  });
                  m.redraw();
                }
              }
            }
          },
        },
        m(".help", [
          m("div", [m("kbd", "N"), " / ", m("kbd", "C"), " / ", m("kbd", "Y"), " / ", m("kbd", "U"), " — add piece"]),
          m("div", [m("kbd", "Q"), " / ", m("kbd", "E"), " — rotate"]),
          m("div", [m("kbd", "F"), " — flip"]),
          m("div", [m("kbd", "D"), " — duplicate"]),
          m("div", [m("kbd", "Del"), " — remove"]),
          m("div", "drag to pan · drag piece to dock"),
          m("div", { style: { marginTop: "6px" } }, [
            m("span", { style: { color: "rgb(43, 97, 215)" } }, "blue"),
            " = selected · ",
            m("span", { style: { color: "crimson" } }, "red"),
            " = root",
          ]),
        ]),
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
