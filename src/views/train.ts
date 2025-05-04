import m from "mithril";
import { Tx2 } from "../geom";
import classNames from "classnames";
import "./train.css";

export interface TrainViewAttrs extends m.Attributes {
  readonly tx: Tx2;
  readonly selected?: boolean;
}

export const TrainView: m.Component<TrainViewAttrs> = {
  view({ attrs }: m.Vnode<TrainViewAttrs>) {
    const { tx, selected, className, ...htmlAttrs } = attrs;
    return m(".train", {
      ...htmlAttrs,
      className: classNames(className, selected && "selected"),
      style: { transform: Tx2.css(tx) },
    });
  },
};
