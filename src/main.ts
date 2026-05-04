import m from "mithril";
import { App } from "./views/app";
import "./main.css";

m.route(document.body, "/new", {
  "/new": App,
  "/world/:worldId": App,
});
