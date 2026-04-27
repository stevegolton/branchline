import { produce, type WritableDraft } from "immer";
import { Tx2, Vec2 } from "./geom";
import { trackRegistry } from "./track_registry";

export type DockedTrack = Omit<Track, "position" | "orientation">;

export interface Track {
  id: string;
  kind: keyof typeof trackRegistry;
  p: Vec2;
  r: number;
  flipped?: boolean;
  // Port-indexed: slots may be undefined where no child is docked. Do not
  // filter/compact — that would break index→port alignment.
  docked?: (DockedTrack | undefined)[];
}

export interface Workspace {
  tracks: Track[];
}

export function createWorkspace(workspace: Workspace) {
  let state = workspace;
  const history: Workspace[] = [];
  const future: Workspace[] = [];

  function updateStore(fn: (draft: WritableDraft<Workspace>) => void) {
    history.push(state);
    future.length = 0; // New edits invalidate the redo stack.
    state = produce(state, fn);
  }

  return {
    get state() {
      return state;
    },
    get canUndo() {
      return history.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    undo() {
      if (!this.canUndo) return;
      future.push(state);
      state = history.pop()!;
    },
    redo() {
      if (!this.canRedo) return;
      history.push(state);
      state = future.pop()!;
    },
    // Rotate the track 45° in the given direction, and rotate all children with it.
    rotateTrack(trackId: string, direction: "cw" | "ccw") {
      updateStore((draft) => {
        const found = findTrack(draft, trackId);
        if (found.kind === "none") return;
        if (found.kind === "docked") {
          // Undock
          const parent = found.parent;
          parent.docked = parent.docked?.map((t) =>
            t?.id === trackId ? undefined : t,
          );

          const orientation =
            ((found.r ?? 0) + (direction === "cw" ? 45 : -45) + 360) % 360;

          // Move to root level, preserving world orientation.
          draft.tracks.push({
            ...found.track,
            p: found.p,
            r: orientation,
          });
        } else {
          // Root tracks can just be rotated in place.
          found.track.r =
            ((found.track.r ?? 0) + (direction === "cw" ? 45 : -45) + 360) %
            360;
          return;
        }
      });
    },
    // Flip the given track piece, don't flip children.
    flipTrack(trackId: string) {
      updateStore((draft) => {
        const found = findTrack(draft, trackId);
        if (found.kind === "none") return;
        const track = found.track;
        track.flipped = !track.flipped;
      });
    },
    // Delete the track and all children.
    removeTrack(trackId: string) {
      updateStore((draft) => {
        const found = findTrack(draft, trackId);
        if (found.kind === "none") return;
        if (found.kind === "root") {
          draft.tracks = draft.tracks.filter((t) => t?.id !== trackId);
        } else {
          // Remove docked track
          const parent = found.parent;
          parent.docked = parent.docked?.map((t) =>
            t?.id === trackId ? undefined : t,
          );
        }
      });
    },
    // Undock if docked, and move to position.
    moveTrack(trackId: string, newPosition: Vec2) {
      updateStore((draft) => {
        const found = findTrack(draft, trackId);
        if (found.kind === "none") return;
        if (found.kind === "docked") {
          // Undock
          const parent = found.parent;
          parent.docked = parent.docked?.map((t) =>
            t?.id === trackId ? undefined : t,
          );

          // Move to root level, preserving world orientation.
          draft.tracks.push({
            ...found.track,
            p: newPosition,
            r: found.r,
          });
        } else {
          // Just move
          found.track.p = newPosition;
        }
      });
    },
    // Dock a track node to a port on another track. Undock if already docked.
    dockTrack(trackId: string, toTrackId: string, portIndex: number) {
      updateStore((draft) => {
        const found = findTrack(draft, trackId);
        if (found.kind === "none") return;
        const target = findTrack(draft, toTrackId);
        if (target.kind === "none") return;

        // Detach from its current location.
        if (found.kind === "root") {
          draft.tracks = draft.tracks.filter((t) => t?.id !== trackId);
        } else {
          const parent = found.parent;
          parent.docked = parent.docked?.map((t) =>
            t?.id === trackId ? undefined : t,
          );
        }

        // Strip root-only fields when docking.
        const { p: _p, r: _o, ...docked } = found.track as Track;

        target.track.docked ??= [];
        target.track.docked[portIndex] = docked as DockedTrack;
      });
    },
    addTrack(track: Omit<Track, "id">) {
      const id = crypto.randomUUID();
      updateStore((draft) => {
        draft.tracks.push({ ...track, id });
      });
      return id;
    },
    duplicateTrack(trackId: string, spawnPos: Vec2) {
      const id = crypto.randomUUID();
      updateStore((draft) => {
        const track = findTrack(this.state, trackId);
        if (track.kind === "none") return;
        if (track.kind === "docked") {
          const t = track.track;
          draft.tracks.push({
            ...t,
            id,
            p: spawnPos,
            r: track.r,
            docked: [], // Undock children when duplicating, to avoid ID conflicts.
          });
        } else {
          const t = track.track;
          draft.tracks.push({ ...t, id, p: spawnPos, docked: [] });
        }
      });
      return id;
    },
  };
}

type FindResult =
  | { kind: "none" }
  | {
      kind: "root";
      track: Track;
    }
  | ({
      kind: "docked";
      track: DockedTrack;
      parent: DockedTrack;
    } & Tx2);

function findTrack(workspace: Workspace, id: string): FindResult {
  for (const track of workspace.tracks) {
    if (!track) continue;
    const rootPos = track.p;
    const rootRot = track.r ?? 0;
    if (track.id === id) {
      return {
        kind: "root",
        track,
      };
    }
    if (track.docked) {
      const found = findDockedTrack(track.docked, id, track, rootPos, rootRot);
      if (found.kind !== "none") return found;
    }
  }
  return { kind: "none" };
}

function findDockedTrack(
  nodes: readonly (DockedTrack | undefined)[],
  id: string,
  parent: DockedTrack,
  parentPos: Vec2,
  parentRot: number,
): FindResult {
  const outPorts = trackRegistry[parent.kind].ports.filter(
    (p) => p.direction === "out",
  );
  const rad = (parentRot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const flipSign = parent.flipped ? -1 : 1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!n) continue;
    const port = outPorts[i];
    const localX = port.p.x;
    const localY = port.p.y * flipSign;
    const childPos = {
      x: parentPos.x + localX * cos - localY * sin,
      y: parentPos.y + localX * sin + localY * cos,
    };
    const childRot = (parentRot + port.r * flipSign + 360) % 360;
    if (n.id === id) {
      return {
        kind: "docked",
        track: n,
        parent,
        p: childPos,
        r: childRot,
      };
    }
    if (n.docked) {
      const found = findDockedTrack(n.docked, id, n, childPos, childRot);
      if (found.kind !== "none") return found;
    }
  }
  return { kind: "none" };
}
