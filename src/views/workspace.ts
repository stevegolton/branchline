import m from "mithril";
import { Vec2 } from "../geom";
import "./workspace.css";

export interface WorkspaceAttrs extends m.Attributes {
  readonly offset: Vec2;
  onpan?(offset: Vec2): void;
  onclick?(): void;
}

export function Workspace(): m.Component<WorkspaceAttrs> {
  let drag: { readonly offset: Vec2 } | undefined;
  return {
    view({ attrs, children }) {
      const { onclick, onpan, offset, ...rest } = attrs;
      return m(
        ".workspace",
        {
          ...rest,
          onpointerdown(e: PointerEvent) {
            const el = e.currentTarget as HTMLElement;
            el.setPointerCapture(e.pointerId);
            drag = { offset };
          },
          onpointermove(e: PointerEvent) {
            if (drag) {
              drag = {
                offset: Vec2.add(drag.offset, {
                  x: e.movementX,
                  y: e.movementY,
                }),
              };
            }
          },
          onpointerup() {
            if (drag) {
              const dragDist = Vec2.dist(offset, drag.offset);
              if (dragDist < 5) {
                onclick?.();
              } else {
                onpan?.(drag.offset);
              }
              drag = undefined;
            }
          },
        },
        m(
          ".workspace-shim",
          {
            style: {
              transform: Vec2.css(drag?.offset ?? offset),
            },
          },
          children,
        ),
      );
    },
  };
}
