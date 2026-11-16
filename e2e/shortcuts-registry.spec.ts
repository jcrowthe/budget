import { expect, test } from "@playwright/test";
import {
  capLabel,
  comboMatches,
  isMacPlatform,
  parseCombo,
  pickShortcut,
} from "../apps/web/src/shortcuts/keys";
import {
  assertBindable,
  SHORTCUT_SECTIONS,
  SHORTCUTS,
  THEN,
} from "../apps/web/src/shortcuts/registry";

const TICKET = `Universal|Open Keyboard Shortcuts Help|?
Universal|Expand/Collapse Sidebar|shift .
Universal|Select All|ctrl A
Universal|Deselect All|escape
Universal|Math operations|+ - x /
Universal|Undo|ctrl Z
Universal|Redo|ctrl shift Z
Plan Actions|Snooze target|shift Z
Plan Actions|Collapse/expand groups|ctrl ↑/↓
Plan Actions|Move between plan rows|↑/↓
Plan Actions|Select multiple categories|shift ↑/↓
Account Actions|Add new transaction|shift N
Account Actions|Approve|A
Account Actions|Approve all transactions|shift L
Account Actions|Reject|shift R
Account Actions|Categorize|K
Account Actions|Split|S
Account Actions|Enter Now|E
Account Actions|Match|M
Account Actions|Unmatch|shift U
Account Actions|Toggle cleared state|C
Account Actions|Duplicate|shift D
Account Actions|Flag|shift F then 0‑6
Account Actions|Make repeating|shift T
Account Actions|Delete|delete
Account Actions|Reconcile|shift E
Account Actions|Focus on the search bar|ctrl shift F
Account Actions|Select a group of transactions|shift click
Account Actions|Select multiple transactions|shift ↑/↓
Account Actions|Move between transactions|↑/↓
Account Actions|Move to next transaction field|tab
Account Actions|Move to previous transaction field|shift tab
Date Picker|Navigate the date picker|↑ ↓ ← →
Date Picker|Move date one day forward|+
Date Picker|Move date one day backward|-
Date Picker|Select today|T
Date Picker|Select first day of month|M
Date Picker|Select last day of month|shift M
Date Picker|Select first day of year|Y
Date Picker|Select last day of year|shift Y`.split("\n");

const ev = (o: Partial<Parameters<typeof comboMatches>[1]> & { key: string }) => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...o,
});

test("the 40 rows equal the ticket's list, in order, with unique ids", () => {
  const title = (id: string) => SHORTCUT_SECTIONS.find((s) => s.id === id)?.title;
  const rows = SHORTCUTS.map(
    (s) =>
      `${title(s.section)}|${s.description}|${s.caps.map((c) => (c === THEN ? "then" : c)).join(" ")}`,
  );
  expect(rows).toEqual(TICKET);
  expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(40);
});

test("isMacPlatform and capLabel", () => {
  expect(isMacPlatform({ platform: "MacIntel" })).toBe(true);
  expect(isMacPlatform({ userAgentData: { platform: "macOS" } })).toBe(true);
  expect(isMacPlatform({ platform: "Linux x86_64" })).toBe(false);
  expect(isMacPlatform({ platform: "Win32" })).toBe(false);
  expect(isMacPlatform({ platform: "MacIntel", userAgentData: { platform: "Windows" } })).toBe(
    false,
  );
  expect(capLabel("ctrl", true)).toBe("⌘");
  expect(capLabel("ctrl", false)).toBe("ctrl");
  expect(capLabel("shift", true)).toBe("shift");
});

test("comboMatches", () => {
  const q = parseCombo("?");
  expect(comboMatches(q, ev({ key: "?", shiftKey: true }))).toBe(true);
  expect(comboMatches(q, ev({ key: "?" }))).toBe(true);
  expect(comboMatches(q, ev({ key: "?", ctrlKey: true }))).toBe(false);
  const dot = parseCombo("shift+.");
  expect(comboMatches(dot, ev({ key: ">", shiftKey: true }))).toBe(true);
  expect(comboMatches(dot, ev({ key: ":", code: "Period", shiftKey: true }))).toBe(true);
  expect(comboMatches(dot, ev({ key: "." }))).toBe(false);
  const all = parseCombo("ctrl+a");
  expect(comboMatches(all, ev({ key: "a", metaKey: true }))).toBe(true);
  expect(comboMatches(all, ev({ key: "a", ctrlKey: true, shiftKey: true }))).toBe(false);
  const a = parseCombo("a");
  expect(comboMatches(a, ev({ key: "a" }))).toBe(true);
  expect(comboMatches(a, ev({ key: "A", shiftKey: true }))).toBe(false);
  expect(comboMatches(a, ev({ key: "a", altKey: true }))).toBe(false);
});

test("pickShortcut", () => {
  const ctx = { bound: new Set(["open-help" as const]), inField: false, modalOpen: false };
  const q = ev({ key: "?", shiftKey: true });
  expect(pickShortcut(q, ctx)).toBe("open-help");
  expect(pickShortcut(q, { ...ctx, bound: new Set() })).toBeNull();
  expect(pickShortcut(q, { ...ctx, inField: true })).toBeNull();
  expect(pickShortcut(q, { ...ctx, modalOpen: true })).toBeNull();
  expect(pickShortcut({ ...q, ctrlKey: true }, ctx)).toBeNull();
  expect(pickShortcut({ ...q, repeat: true }, ctx)).toBeNull();
  expect(pickShortcut({ ...q, isComposing: true }, ctx)).toBeNull();
  expect(pickShortcut({ ...q, defaultPrevented: true }, ctx)).toBeNull();
});

test("a row without key combinations cannot be bound", () => {
  expect(() => assertBindable("flag")).toThrow("shortcut flag has no key combination");
  expect(() => assertBindable("open-help")).not.toThrow();
});
