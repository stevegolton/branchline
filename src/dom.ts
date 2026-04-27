import m from "mithril";

// Adds an event listener to a DOM element, returning a disposable to remove it.
export function bindEventListener<K extends keyof HTMLElementEventMap>(
  element: EventTarget,
  event: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): { dispose: () => void } {
  element.addEventListener(event, handler as EventListener, options);
  return {
    dispose() {
      element.removeEventListener(event, handler as EventListener);
    },
  };
}

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
