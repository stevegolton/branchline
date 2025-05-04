import m from "mithril";

export interface ProjectRowAttrs {
  readonly id: string;
  readonly name?: string;
  readonly created: number;
  readonly modified: number;
  readonly active?: boolean;
  readonly onLoad: () => void;
  readonly onDelete: () => void;
  readonly onRename: (name: string) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export const ProjectRow: m.Component<ProjectRowAttrs> = {
  view({ attrs }) {
    const shortId = attrs.id.slice(0, 8);
    return m(
      ".project-row",
      {
        class: attrs.active ? "active" : "",
        onclick: attrs.onLoad,
        ondblclick: (e: PointerEvent) => {
          e.stopPropagation();
          const name = window.prompt("Rename project", shortId);
          if (name) attrs.onRename(name);
        },
      },
      m(".project-row__meta", [
        m(".project-row__id", attrs.name ?? shortId),
        m(".project-row__date", formatDate(attrs.modified)),
      ]),
      m(".project-row__actions", [
        m(
          "button.project-row__btn",
          {
            onclick: (e: PointerEvent) => {
              e.stopPropagation();
              attrs.onDelete();
            },
          },
          "Delete",
        ),
      ]),
    );
  },
};
