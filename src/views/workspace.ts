import m from "mithril";
import { Vec2 } from "../geom";
import { startDrag } from "../dom";
import "./workspace.css";

export interface WorkspaceAttrs extends m.Attributes {
  readonly offset: Vec2;
  onpan?(offset: Vec2): void;
  onclick?(): void;
}

export function Workspace(): m.Component<WorkspaceAttrs> {
  let localOffset: Vec2 | undefined;
  return {
    view({ attrs, children }) {
      const { onclick, onpan, offset, ...rest } = attrs;
      return m(
        ".workspace",
        {
          ...rest,
          onpointerdown(e: PointerEvent) {
            startDrag(e, e.currentTarget as HTMLElement, 4, {
              onDragStart: () => {
                let currentOffset = offset;
                localOffset = offset;
                return {
                  onDrag(deltaX, deltaY) {
                    currentOffset = Vec2.add(currentOffset, {
                      x: deltaX,
                      y: deltaY,
                    });
                    localOffset = currentOffset;
                  },
                  onDragEnd() {
                    onpan?.(currentOffset);
                    localOffset = undefined;
                  },
                };
              },
              onDragFailed() {
                onclick?.();
              },
            });
          },
        },
        m(
          ".workspace-shim",
          {
            style: {
              transform: Vec2.css(localOffset ?? offset),
            },
          },
          children,
        ),
      );
    },
  };
}
