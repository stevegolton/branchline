import m from "mithril";

export interface ToolbarAttrs {
  canUndo: boolean;
  canRedo: boolean;
  onNewWorkspace: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export const Toolbar: m.Component<ToolbarAttrs> = {
  view({ attrs, children }) {
    return m(
      ".help",
      {
        onpointerdown: (e: PointerEvent) => {
          e.stopPropagation();
        },
      },
      [
        m("div", [
          m("kbd", "N"),
          " / ",
          m("kbd", "C"),
          " / ",
          m("kbd", "Y"),
          " / ",
          m("kbd", "U"),
          " — add piece",
        ]),
        m("div", [m("kbd", "Q"), " / ", m("kbd", "E"), " — rotate"]),
        m("div", [m("kbd", "F"), " — flip"]),
        m("div", [m("kbd", "D"), " — duplicate"]),
        m("div", [m("kbd", "Del"), " — remove"]),
        m("div", [
          m("kbd", "Ctrl+Z"),
          " / ",
          m("kbd", "Ctrl+Shift+Z"),
          " — undo/redo",
        ]),
        m("div", "drag to pan · drag piece to dock"),
        m("div", { style: { marginTop: "6px" } }, [
          m("span", { style: { color: "rgb(43, 97, 215)" } }, "blue"),
          " = selected · ",
          m("span", { style: { color: "crimson" } }, "red"),
          " = root",
        ]),
        m("button", { onclick: attrs.onNewWorkspace }, "New Workspace"),
        m(
          "button",
          { disabled: !attrs.canUndo, onclick: attrs.onUndo },
          "Undo",
        ),
        m(
          "button",
          { disabled: !attrs.canRedo, onclick: attrs.onRedo },
          "Redo",
        ),
        children,
      ],
    );
  },
};
