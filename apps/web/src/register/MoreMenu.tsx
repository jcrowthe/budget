import { countLabel } from "@budget/schema/register-selection";
import { SCHEDULED_LATER } from "@budget/schema/scheduled-transactions";
import {
  type KeyboardEvent as ReactKey,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  CaretRightIcon,
  ClearedCircleIcon,
  DuplicateIcon,
  ExportIcon,
  LinkBrokenIcon,
  LinkIcon,
  MemoIcon,
  RepeatIcon,
  TrashIcon,
} from "./icons";
import { Popover } from "./Popover";

/**
 * A zero-size fixed span at a point, handed to a Popover as its anchor: a right-click opens the menu there.
 * The anchor is given to `children` once it is mounted.
 */
export function PointAnchor({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: (anchor: HTMLElement) => ReactNode;
}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <>
      {createPortal(
        <span
          ref={setEl}
          aria-hidden="true"
          style={{ position: "fixed", left: x, top: y + 4, width: 0, height: 0 }}
        />,
        document.body,
      )}
      {el ? children(el) : null}
    </>
  );
}

const MATCH_TITLE = "To match, select two transactions, one you entered and one from your bank.";

type Item = {
  label: string;
  icon: ReactNode;
  keys?: string[];
  disabled?: { ticket: string; title?: string };
  onClick?: () => void;
};

/** `onHover`: the pointer entered the row (the Move to Account submenu closes at once). */
function Row({ item, onHover }: { item: Item; onHover?: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="bulk-item"
      aria-label={item.label}
      aria-disabled={item.disabled ? "true" : undefined}
      data-ticket={item.disabled?.ticket}
      title={item.disabled?.title}
      onMouseEnter={onHover}
      onClick={item.disabled ? undefined : item.onClick}
    >
      <span className="bulk-item-icon">{item.icon}</span>
      <span className="bulk-item-label">{item.label}</span>
      {item.keys && (
        <span className="bulk-keys" aria-hidden="true">
          {item.keys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </span>
      )}
    </button>
  );
}

/** The bar's More menu, in the source's order and with its dividers. */
export function MoreMenu({
  scheduled = false,
  anchor,
  count,
  unclear,
  makeRepeating,
  placement = "above",
  moveTo,
  onClose,
  onUnclear,
  onDuplicate,
  onMemo,
  onMove,
  onExport,
  onDelete,
}: {
  /** The selection is scheduled rows: Duplicate and Export stay disabled with their reason. */
  scheduled?: boolean;
  anchor: HTMLElement;
  count: number;
  /** Every non-reconciled selected row is cleared: the menu offers "Mark as Uncleared". */
  unclear: boolean;
  /** Make Repeating: enabled with its action, or greyed out with the reason. */
  makeRepeating: { onClick: () => void } | { reason: string };
  /** `right` with the point anchor of a right-click: the menu's top-left is at the pointer. */
  placement?: "above" | "right";
  /** The other open accounts, for "Move to Account" (account registers only); null hides the entry. */
  moveTo: { id: string; name: string }[] | null;
  onClose: () => void;
  onUnclear: () => void;
  onDuplicate: () => void;
  onMemo: () => void;
  onMove: (accountId: string) => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  // EXF-679: the Move to Account submenu opens on hover, click, ArrowRight, Enter and Space; it closes on Escape
  // (the first one: More stays) and when the pointer leaves the button and the submenu.
  const [sub, setSub] = useState<null | "pointer" | "keyboard">(null);
  const moveBtn = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const cancelLeave = useCallback(() => {
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = undefined;
  }, []);
  const closeSub = () => {
    cancelLeave();
    setSub(null);
  };
  const SUB_MENU = '[role="menu"][aria-label="Move to Account"]';
  useEffect(() => {
    if (sub === null) return;
    const onMove = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      const inside = t !== null && (moveBtn.current?.contains(t) || t.closest(SUB_MENU) !== null);
      if (inside) cancelLeave();
      else if (leaveTimer.current === undefined) {
        leaveTimer.current = window.setTimeout(() => {
          leaveTimer.current = undefined;
          setSub(null);
        }, 150);
      }
    };
    // Window capture runs before the Popovers' document listeners: the first Escape closes the submenu only.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelLeave();
      setSub(null);
      moveBtn.current?.focus();
    };
    document.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey, true);
      cancelLeave();
    };
  }, [sub, cancelLeave]);
  useEffect(() => {
    if (sub !== "keyboard") return;
    document.querySelector<HTMLElement>(`${SUB_MENU} [role="menuitem"]`)?.focus();
  }, [sub]);
  const onSubKey = (e: ReactKey) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      closeSub();
      moveBtn.current?.focus();
    }
  };
  const later = { ticket: "later", title: SCHEDULED_LATER };
  const matchGroup: Item[] = [
    {
      label: "Match",
      icon: <LinkIcon />,
      keys: ["M"],
      disabled: { ticket: "EXF-464", title: MATCH_TITLE },
    },
    {
      label: "Unmatch",
      icon: <LinkBrokenIcon />,
      keys: ["shift", "U"],
      disabled: { ticket: "EXF-464" },
    },
  ];
  const repeatItem: Item = {
    label: "Make Repeating",
    icon: <RepeatIcon />,
    keys: ["shift", "T"],
    ...("onClick" in makeRepeating
      ? { onClick: makeRepeating.onClick }
      : { disabled: { ticket: "EXF-503", title: makeRepeating.reason } }),
  };
  const scheduledGroups: Item[][] = [
    matchGroup,
    [
      { label: "Duplicate", icon: <DuplicateIcon />, keys: ["shift", "D"], disabled: later },
      repeatItem,
    ],
    [{ label: "Memo...", icon: <MemoIcon />, onClick: onMemo }],
    [{ label: `Export ${countLabel(count)}`, icon: <ExportIcon />, disabled: later }],
    [{ label: "Delete", icon: <TrashIcon />, keys: ["delete"], onClick: onDelete }],
  ];
  const groups: Item[][] = scheduled
    ? scheduledGroups
    : [
        ...(unclear
          ? [
              [
                {
                  label: "Mark as Uncleared",
                  icon: <ClearedCircleIcon />,
                  keys: ["C"],
                  onClick: onUnclear,
                },
              ],
            ]
          : []),
        matchGroup,
        [
          {
            label: "Duplicate",
            icon: <DuplicateIcon />,
            keys: ["shift", "D"],
            onClick: onDuplicate,
          },
          repeatItem,
        ],
        [{ label: "Memo...", icon: <MemoIcon />, onClick: onMemo }],
        [
          {
            label: `Export ${countLabel(count)}`,
            icon: <ExportIcon />,
            onClick: onExport,
          },
        ],
        [{ label: "Delete", icon: <TrashIcon />, keys: ["delete"], onClick: onDelete }],
      ];
  return (
    <Popover
      anchor={anchor}
      placement={placement}
      dx={0}
      width={232}
      label="More actions"
      onClose={onClose}
    >
      <ul className="bulk-list">
        {groups.map((g, gi) => (
          <li key={g[0]?.label} className="bulk-group">
            {gi > 0 && <hr />}
            {g.map((item) => (
              <Row key={item.label} item={item} onHover={closeSub} />
            ))}
            {moveTo && g[0]?.label === "Memo..." && (
              <button
                ref={moveBtn}
                type="button"
                role="menuitem"
                className={`bulk-item${sub ? " is-active" : ""}`}
                aria-label="Move to Account"
                aria-haspopup="menu"
                aria-expanded={sub !== null}
                onMouseEnter={() => {
                  cancelLeave();
                  setSub((cur) => cur ?? "pointer");
                }}
                onClick={(e) => setSub((cur) => (e.detail === 0 ? "keyboard" : (cur ?? "pointer")))}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSub("keyboard");
                  }
                }}
              >
                <span className="bulk-item-icon">
                  <ExportIcon style={{ transform: "rotate(-90deg)" }} />
                </span>
                <span className="bulk-item-label">Move to Account</span>
                <span className="bulk-keys" aria-hidden="true">
                  <CaretRightIcon />
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {sub && moveBtn.current ? (
        <Popover
          anchor={moveBtn.current}
          placement="right"
          width={232}
          label="Move to Account"
          onClose={closeSub}
        >
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: arrow keys move through the menu's items */}
          <ul className="bulk-list bulk-move" onKeyDown={onSubKey}>
            {moveTo?.length === 0 && (
              <li>
                <span className="bulk-empty" role="menuitem" aria-disabled="true" tabIndex={-1}>
                  No other accounts
                </span>
              </li>
            )}
            {moveTo?.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="bulk-item"
                  aria-label={a.name}
                  onClick={() => onMove(a.id)}
                >
                  <span className="bulk-item-label">{a.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </Popover>
  );
}
