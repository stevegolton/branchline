import m from "mithril";
import { trackRegistry } from "./track_registry";
import * as Vec2 from "./vec2";

export interface TrainViewAttrs extends m.Attributes {
  readonly tx: Transform2;
}

export const TrainView: m.Component<TrainViewAttrs> = {
  view({ attrs }: m.Vnode<TrainViewAttrs>) {
    const { tx, ...htmlAttrs } = attrs;
    return m(".train", {
      ...htmlAttrs,
      style: {
        transform: tx2Css(tx),
      },
    });
  },
};

export interface Train {
  readonly id: string;
  readonly tx:
    | Transform2
    | {
        readonly trackId: string;
        readonly t: number;
        readonly reverse: boolean;
      };
}

const TRAIN_SPEED = 0.01; // How much t changes per tick for a train moving at normal speed
const EPSILON = 1e-6; // Threshold for considering two points to be the same

// Runs a time tick for a given track on a given track, and returns the new
// state of the train after that tick.
export function runTrainTick(
  tracks: readonly NormalizedTrack[],
  train: Train,
): Train {
  const tx = train.tx;
  if ("p" in tx) {
    // If the train is not currently on a track, don't move it anywhere.
    return train;
  }

  const track = tracks.find((t) => t.id === tx.trackId);
  if (!track) {
    // Can't find the track that this train is on... must have been deleted.
    // TODO: Move the train to an absolute position instead.
    return train;
  }

  // Move the train along the track.
  let t = tx.t + (tx.reverse ? -TRAIN_SPEED : TRAIN_SPEED);

  if (t >= 0 && t < 1) {
    // Still on the track, just update the t value.
    return { ...train, tx: { ...train.tx, t } };
  }

  if (t >= 1) {
  }

  const manifest = trackRegistry[track.kind];
  const outputPortOffset = manifest.ports[1];
  const globalOutput = track2Global(track, outputPortOffset);

  // The train has reached the end of the track. If there's a
  // docked track, move it to the next track; otherwise, keep it
  // at the end.
  for (const otherTrack of tracks) {
    // If this current track has a docked track with an input that's close
    // to the output of this track, move the train to that track.
    const manifest = trackRegistry[otherTrack.kind];
    const inputPortOffset = manifest.ports[0];
    const globalInput = track2Global(otherTrack, inputPortOffset);

    if (Vec2.distance(globalInput.p, globalOutput.p) < EPSILON) {
      return {
        ...train,
        tx: { ...train.tx, t: t - 1.0, trackId: otherTrack.id },
      };
    }
  }

  // Otherwise transition to a global position at the end of the track.
  return {
    tx: {
      p: globalOutput.p,
      r: globalOutput.r,
    },
  };
}
