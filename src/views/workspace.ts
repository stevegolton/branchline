import m from "mithril";
import { Vec2 } from "../geom";
import { startDrag } from "../dom";
import "./workspace.css";

export interface WorkspaceAttrs extends m.Attributes {
  readonly offset: Vec2;
  onpan?(offset: Vec2): void;
  onclick?(): void;
}

export const Workspace: m.Component<WorkspaceAttrs> = {
  view({ attrs, children }) {
    const { onclick, onpan, offset, ...rest } = attrs;
    return m(
      ".workspace",
      {
        ...rest,
        onpointerdown(e: PointerEvent) {
          let currentOffset = offset;
          startDrag(e, e.currentTarget as HTMLElement, 4, {
            onDragStart: () => {
              return {
                onDrag(deltaX, deltaY) {
                  currentOffset = Vec2.add(currentOffset, {
                    x: deltaX,
                    y: deltaY,
                  });
                  onpan?.(currentOffset);
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
            transform: Vec2.css(offset),
          },
        },
        children,
      ),
    );
  },
};
