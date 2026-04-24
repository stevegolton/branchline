import m from "mithril";
import type { Vec2 } from "./geom";
import { trackRegistry } from "./track_registry";
import type { DockedTrack, Workspace } from "./workspace";

// Train's location: which piece it's on, and how far along that piece's
// local path. direction: +1 = input→output, -1 = output→input.
export interface TrainState {
  trackId: string;
  t: number;
  direction: 1 | -1;
}

// Walks the tree to find a track by id, accumulating the world transform
// of the containing piece (so the simulator can render the blob without
// duplicating the port-math in renderTrack).
export function resolveWorldTransform(
  workspace: Workspace,
  trackId: string,
): { track: DockedTrack; position: Vec2; rotation: number; flipped: boolean } | null {
  function walk(
    track: DockedTrack,
    translate: Vec2,
    rotation: number,
  ): { track: DockedTrack; position: Vec2; rotation: number; flipped: boolean } | null {
    if (track.id === trackId) {
      return { track, position: translate, rotation, flipped: !!track.flipped };
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

  for (const t of workspace.tracks) {
    const found = walk(t, t.position, t.orientation ?? 0);
    if (found) return found;
  }
  return null;
}

// Find the parent of a docked track, so the simulator can walk backwards.
export function findParent(
  workspace: Workspace,
  childId: string,
): { parent: DockedTrack; portIndex: number } | null {
  function walk(track: DockedTrack): { parent: DockedTrack; portIndex: number } | null {
    if (!track.docked) return null;
    for (let i = 0; i < track.docked.length; i++) {
      const child = track.docked[i];
      if (!child) continue;
      if (child.id === childId) return { parent: track, portIndex: i };
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }
  for (const t of workspace.tracks) {
    const found = walk(t);
    if (found) return found;
  }
  return null;
}

// Get the world position of a given port on a given track piece.
function portWorld(
  workspace: Workspace,
  trackId: string,
  portIndex: number,
): Vec2 | null {
  const found = resolveWorldTransform(workspace, trackId);
  if (!found) return null;
  const port = trackRegistry[found.track.kind].ports[portIndex];
  if (!port) return null;
  const flipSign = found.flipped ? -1 : 1;
  const rad = (found.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = port.offset.x;
  const ly = port.offset.y * flipSign;
  return {
    x: found.position.x + lx * cos - ly * sin,
    y: found.position.y + lx * sin + ly * cos,
  };
}

// Find an input port on some other piece co-located (within epsilon) with
// the given world point. Used so the train can hop across adjacent-but-
// undocked pieces, forming implicit loops.
const LOOP_EPSILON = 8; // pixels

function findLoopTarget(
  workspace: Workspace,
  worldPos: Vec2,
  excludeTrackId: string,
): string | null {
  function walk(track: DockedTrack): string | null {
    if (track.id !== excludeTrackId) {
      const inPortIdx = trackRegistry[track.kind].ports.findIndex(
        (p) => p.direction === "in",
      );
      if (inPortIdx >= 0 && trackRegistry[track.kind].path) {
        const pw = portWorld(workspace, track.id, inPortIdx);
        if (pw && Math.hypot(pw.x - worldPos.x, pw.y - worldPos.y) < LOOP_EPSILON) {
          return track.id;
        }
      }
    }
    if (track.docked) {
      for (const c of track.docked) {
        if (!c) continue;
        const found = walk(c);
        if (found) return found;
      }
    }
    return null;
  }
  for (const t of workspace.tracks) {
    const found = walk(t);
    if (found) return found;
  }
  return null;
}

// Like findLoopTarget, but looks for a co-located *output* port whose slot
// is empty (un-docked), so the train can walk backwards through a junction
// that isn't formally docked.
function findLoopSource(
  workspace: Workspace,
  worldPos: Vec2,
  excludeTrackId: string,
): string | null {
  function walk(track: DockedTrack): string | null {
    if (track.id !== excludeTrackId && trackRegistry[track.kind].path) {
      const ports = trackRegistry[track.kind].ports;
      const outs: number[] = [];
      ports.forEach((p, i) => {
        if (p.direction === "out") outs.push(i);
      });
      for (let oi = 0; oi < outs.length; oi++) {
        const portIdx = outs[oi];
        // Only consider ports that have nothing docked in the matching slot.
        if (track.docked?.[oi]) continue;
        const pw = portWorld(workspace, track.id, portIdx);
        if (pw && Math.hypot(pw.x - worldPos.x, pw.y - worldPos.y) < LOOP_EPSILON) {
          return track.id;
        }
      }
    }
    if (track.docked) {
      for (const c of track.docked) {
        if (!c) continue;
        const found = walk(c);
        if (found) return found;
      }
    }
    return null;
  }
  for (const t of workspace.tracks) {
    const found = walk(t);
    if (found) return found;
  }
  return null;
}

// Pick a starting piece — first root that has a path.
export function pickStart(workspace: Workspace): TrainState | null {
  for (const t of workspace.tracks) {
    if (trackRegistry[t.kind].path) {
      return { trackId: t.id, t: 0, direction: 1 };
    }
  }
  return null;
}

// Advance the train by dt (seconds). Speed is in units of local-path per
// second — so a straight piece is traversed at ~constant speed regardless
// of its length, which is fine for now.
const SPEED = 1.5; // paths-per-second

export function advance(
  state: TrainState,
  workspace: Workspace,
  dt: number,
): TrainState {
  let { trackId, t, direction } = state;
  t += direction * SPEED * dt;

  // Transitions: fell off the output end → try to enter the docked child
  // at port 0. Fell off the input end → try to walk back to the parent.
  while (t > 1 || t < 0) {
    const found = resolveWorldTransform(workspace, trackId);
    if (!found) return state; // Piece was deleted mid-sim.

    if (t > 1) {
      // Try to step forward into docked[0].
      const next = found.track.docked?.[0];
      if (next && trackRegistry[next.kind].path) {
        trackId = next.id;
        t = t - 1;
      } else {
        // No dock — check for a co-located input port on another piece
        // (implicit loop across an un-docked junction).
        const outPortIdx = trackRegistry[found.track.kind].ports.findIndex(
          (p) => p.direction === "out",
        );
        const outPos =
          outPortIdx >= 0 ? portWorld(workspace, trackId, outPortIdx) : null;
        const hop = outPos ? findLoopTarget(workspace, outPos, trackId) : null;
        if (hop) {
          trackId = hop;
          t = t - 1;
        } else {
          // Dead end — reverse.
          direction = -1;
          t = 1 - (t - 1);
        }
      }
    } else {
      // t < 0. Walk back to parent if this piece is docked.
      const parentInfo = findParent(workspace, trackId);
      if (parentInfo && trackRegistry[parentInfo.parent.kind].path) {
        // We entered this piece at t=0 coming from parent's output; going
        // backwards means we exit at parent's output and continue backwards
        // along the parent's path (t goes from 1 down).
        trackId = parentInfo.parent.id;
        t = 1 + t; // t was negative, so this maps -0.1 → 0.9, etc.
      } else {
        // No parent — check for a co-located output port on another piece
        // whose output touches our input (implicit loop).
        const inPortIdx = trackRegistry[found.track.kind].ports.findIndex(
          (p) => p.direction === "in",
        );
        const inPos =
          inPortIdx >= 0 ? portWorld(workspace, trackId, inPortIdx) : null;
        const hop = inPos
          ? findLoopSource(workspace, inPos, trackId)
          : null;
        if (hop) {
          trackId = hop;
          t = 1 + t;
        } else {
          // Dead end — reverse.
          direction = 1;
          t = -t;
        }
      }
    }
  }

  return { trackId, t, direction };
}

// Compute the train's world position given its local t on a piece.
export function trainWorld(
  state: TrainState,
  workspace: Workspace,
): { position: Vec2; rotation: number } | null {
  const found = resolveWorldTransform(workspace, state.trackId);
  if (!found) return null;
  const piece = trackRegistry[found.track.kind];
  if (!piece.path) return null;
  const local = piece.path(state.t);
  const flipSign = found.flipped ? -1 : 1;
  const rad = (found.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = local.position.x;
  const ly = local.position.y * flipSign;
  return {
    position: {
      x: found.position.x + lx * cos - ly * sin,
      y: found.position.y + lx * sin + ly * cos,
    },
    rotation: (found.rotation + local.rotation * flipSign + 360) % 360,
  };
}

// Drives a TrainState via requestAnimationFrame. Returns start/stop fns.
export function createSimulator(
  getWorkspace: () => Workspace,
  getState: () => TrainState | null,
  setState: (s: TrainState | null) => void,
) {
  let raf: number | null = null;
  let lastTs = 0;

  function tick(ts: number) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    const s = getState();
    if (s) {
      setState(advance(s, getWorkspace(), dt));
      m.redraw();
    }
    raf = requestAnimationFrame(tick);
  }

  return {
    start() {
      if (raf !== null) return;
      const s = getState() ?? pickStart(getWorkspace());
      if (!s) return;
      setState(s);
      lastTs = 0;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      setState(null);
    },
    get running() {
      return raf !== null;
    },
  };
}
