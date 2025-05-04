import m from "mithril";
import { Tx2 } from "../geom";
import classNames from "classnames";
import "./track.css";

export interface TrackPieceAttrs extends m.Attributes {
  readonly tx: Tx2;
  readonly selected?: boolean;
  readonly flipped?: boolean;
  readonly isRoot?: boolean;
}

export function TrackView(): m.Component<TrackPieceAttrs> {
  return {
    view({ attrs, children }: m.Vnode<TrackPieceAttrs>) {
      const {
        inputOffset,
        docked,
        selected,
        tx,
        flipped,
        className,
        isRoot,
        ...htmlAttrs
      } = attrs;

      return m(
        ".track",
        {
          ...htmlAttrs,
          style: {
            transform: Tx2.css(tx) + (flipped ? ` scaleY(-1)` : ``),
          },
          className: classNames(
            className,
            selected && "selected",
            isRoot && "root",
          ),
        },
        children,
      );
    },
  };
}
