import m from "mithril";
import "./toolbox.css";

export const Toolbox: m.Component = {
  view({ children }: m.Vnode) {
    return m(".toolbox", children);
  },
};

export const ToolboxItem: m.Component<m.Attributes> = {
  view({ children, attrs }: m.Vnode<m.Attributes>) {
    return m(".toolbox-item", attrs, children);
  },
};
