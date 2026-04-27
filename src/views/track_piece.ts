import m from "mithril";
import type { Port } from "../types";
import type { Vec2 } from "../geom";
import classNames from "classnames";

export interface TrackPieceAttrs extends m.Attributes {
  readonly ports: readonly Port[];
  readonly selected: boolean;
  readonly translate: Vec2;
  readonly rotation: number;
  readonly flipped: boolean;
  readonly isRoot: boolean;
}

export function TrackPiece(): m.Component<TrackPieceAttrs> {
  return {
    view({ attrs, children }: m.Vnode<TrackPieceAttrs>) {
      const {
        ports,
        inputOffset,
        docked,
        selected,
        translate,
        rotation,
        flipped,
        className,
        isRoot,
        ...htmlAttrs
      } = attrs;

      const pieceTransform =
        `translate(${translate.x}px, ${translate.y}px) ` +
        `rotate(${rotation}deg) ` +
        (flipped ? ` scaleY(-1)` : ``);

      return m(
        ".track",
        {
          ...htmlAttrs,
          style: {
            transform: pieceTransform,
          },
          className: classNames(
            className,
            selected && "selected",
            isRoot && "root",
          ),
        },
        children,
        ports.map((port, i) =>
          m(
            ".port",
            {
              style: {
                position: "absolute",
                left: `${port.offset.x}px`,
                top: `${port.offset.y}px`,
                transform: `rotate(${port.rotation}deg)`,
                transformOrigin: "0 0",
              },
            },
            m(".dot", {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: "10px",
                height: "10px",
                backgroundColor: i === 0 ? "green" : "red",
                borderRadius: "50%",
                transform: `translate(-50%, -50%)`,
              },
            }),
          ),
        ),
      );
    },
  };
}
