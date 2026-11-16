import { useEffect, useRef } from "react";
import { pickShortcut } from "./keys";
import { type ShortcutId, shortcutById } from "./registry";

export type ShortcutHandler = (e: KeyboardEvent) => void;
export const MODAL_SELECTOR = '[role="dialog"], [role="menu"], [aria-modal="true"], dialog[open]';
export const FIELD_SELECTOR = "input, textarea, select, [contenteditable]";

// A screen registers a handler for a registry id; the last one mounted wins.
const handlers = new Map<ShortcutId, ShortcutHandler[]>();

/** Binds `handler` to a registry shortcut while the calling component is mounted (and `enabled`). */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler, enabled = true): void {
  if (!shortcutById(id).combos?.length) throw new Error(`shortcut ${id} has no key combination`);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const fn: ShortcutHandler = (e) => ref.current(e);
    handlers.set(id, [...(handlers.get(id) ?? []), fn]);
    return () => {
      const rest = (handlers.get(id) ?? []).filter((h) => h !== fn);
      if (rest.length) handlers.set(id, rest);
      else handlers.delete(id);
    };
  }, [id, enabled]);
}

/** The app's one keydown listener. It acts only for an id that has a handler, and touches no other key. */
export function useShortcutDispatcher(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const inField =
        !!t?.closest(FIELD_SELECTOR) || (t instanceof HTMLElement && t.isContentEditable);
      const id = pickShortcut(e, {
        bound: new Set(handlers.keys()),
        inField,
        modalOpen: !!document.querySelector(MODAL_SELECTOR),
      });
      if (!id) return;
      const list = handlers.get(id);
      const h = list?.[list.length - 1];
      if (!h) return;
      e.preventDefault();
      h(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
