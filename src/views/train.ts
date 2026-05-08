import m from "mithril";
import { Tx2 } from "../geom";
import classNames from "classnames";
import "./train.css";

export interface TrainViewAttrs extends m.Attributes {
  readonly tx: Tx2;
  readonly selected?: boolean;
  readonly type: "carriage" | "locomotive"; // The type of train this is, which determines its shape.
}

export const TrainView: m.Component<TrainViewAttrs> = {
  view({ attrs }: m.Vnode<TrainViewAttrs>) {
    const { tx, selected, className, ...htmlAttrs } = attrs;
    return m(".train", {
      ...htmlAttrs,
      className: classNames(
        className,
        selected && "selected",
        attrs.type ? attrs.type : "locomotive",
      ),
      style: { transform: Tx2.css(tx) },
    });
  },
};
