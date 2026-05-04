import m from "mithril";

export interface DragStartHandlers {
  onDragStart?: () => DragHandlers;
  onDragFailed?: () => void;
}

export interface DragHandlers {
  onDrag?: (deltaX: number, deltaY: number) => void;
  onDragEnd?: (deltaX: number, deltaY: number) => void;
}

export function startDrag(
  e: PointerEvent,
  element: HTMLElement,
  deadzone: number,
  startHandlers: DragStartHandlers,
) {
  const startX = e.clientX;
  const startY = e.clientY;
  element.setPointerCapture(e.pointerId);

  let handlers: DragHandlers | undefined;

  function onPointerMove(ev: PointerEvent) {
    m.redraw();
    const deltaX = ev.clientX - startX;
    const deltaY = ev.clientY - startY;
    if (!handlers) {
      if (Math.hypot(deltaX, deltaY) < deadzone) return;
      handlers = startHandlers.onDragStart?.();
    }
    handlers?.onDrag?.(ev.movementX, ev.movementY);
  }

  function onPointerUp(ev: PointerEvent) {
    m.redraw();
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    if (!handlers) {
      startHandlers.onDragFailed?.();
      return;
    }
    const deltaX = ev.clientX - startX;
    const deltaY = ev.clientY - startY;
    handlers.onDragEnd?.(deltaX, deltaY);
  }

  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
}
