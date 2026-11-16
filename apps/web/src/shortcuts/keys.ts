// Pure key logic for the shortcut dispatcher (no React, no DOM).
import { SHORTCUTS, type ShortcutId } from "./registry";

export type KeyLike = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
};
export type Combo = {
  key: string;
  ctrl: boolean;
  shift: boolean;
  shiftFree: boolean;
  code?: string;
};

export function isMacPlatform(nav: { platform?: string; userAgentData?: { platform?: string } }) {
  const p = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad/i.test(p);
}

export function capLabel(cap: string, mac: boolean) {
  return mac && cap === "ctrl" ? "⌘" : cap;
}

export function parseCombo(text: string): Combo {
  const parts = text.split("+");
  const key = parts[parts.length - 1] ?? "";
  const mods = parts.slice(0, -1);
  const shift = mods.includes("shift");
  const shiftFree = !shift && key.length === 1 && !/[a-z0-9]/i.test(key);
  const combo: Combo = { key, ctrl: mods.includes("ctrl"), shift, shiftFree };
  if (text === "shift+.") combo.code = "Period";
  return combo;
}

export function comboMatches(c: Combo, ev: KeyLike) {
  if (ev.altKey) return false;
  if (c.ctrl !== (ev.ctrlKey || ev.metaKey)) return false;
  if (!c.shiftFree && c.shift !== ev.shiftKey) return false;
  const k = ev.key.toLowerCase();
  if (k === c.key) return true;
  if (c.code && ev.code === c.code) return true;
  return c.code === "Period" && k === ">";
}

const PARSED = new Map<ShortcutId, Combo[]>(
  SHORTCUTS.map((s) => [
    s.id,
    ("combos" in s ? (s.combos as readonly string[]) : []).map(parseCombo),
  ]),
);

export function pickShortcut(
  ev: KeyLike,
  ctx: { bound: ReadonlySet<ShortcutId>; inField: boolean; modalOpen: boolean },
): ShortcutId | null {
  if (ev.defaultPrevented || ev.repeat || ev.isComposing) return null;
  if (ctx.inField || ctx.modalOpen) return null;
  for (const s of SHORTCUTS) {
    if (!ctx.bound.has(s.id)) continue;
    if (PARSED.get(s.id)?.some((c) => comboMatches(c, ev))) return s.id;
  }
  return null;
}
