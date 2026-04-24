import m from "mithril";

export interface ProjectRowAttrs {
  id: string;
  created: number;
  modified: number;
  active?: boolean;
  onLoad: () => void;
  onDelete: () => void;
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
      { class: attrs.active ? "active" : "", onclick: attrs.onLoad },
      m(".project-row__meta", [
        m(".project-row__id", shortId),
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
