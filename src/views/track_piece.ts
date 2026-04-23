import m from "mithril";
import type { Port } from "../types";

export interface TrackPieceAttrs extends m.Attributes {
  readonly ports: readonly Port[];
  readonly docked?: m.Children[];
  readonly selected?: boolean;
}

export function TrackPiece(): m.Component<TrackPieceAttrs> {
  return {
    view({ attrs, children }: m.Vnode<TrackPieceAttrs>) {
      const { ports, inputOffset, docked, selected, ...htmlAttrs } = attrs;
      return m(
        ".track",
        {
          ...htmlAttrs,
          className: selected ? "selected" : "",
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
            docked?.[i],
          ),
        ),
      );
    },
  };
}
