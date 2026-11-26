import { countLabel } from "@budget/schema/register-selection";
import { type ReactNode, useRef, useState } from "react";
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

function Row({ item }: { item: Item }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="bulk-item"
      aria-label={item.label}
      aria-disabled={item.disabled ? "true" : undefined}
      data-ticket={item.disabled?.ticket}
      title={item.disabled?.title}
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
  /** The selection is scheduled rows: only Delete works in this Build. */
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
  const [sub, setSub] = useState(false);
  const moveBtn = useRef<HTMLButtonElement>(null);
  const later = { ticket: "later", title: "Not available for scheduled transactions yet" };
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
    [
      { label: "Memo...", icon: <MemoIcon />, disabled: later },
      {
        label: "Move to Account",
        icon: <ExportIcon style={{ transform: "rotate(-90deg)" }} />,
        disabled: later,
      },
    ],
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
              <Row key={item.label} item={item} />
            ))}
            {moveTo && g[0]?.label === "Memo..." && (
              <button
                ref={moveBtn}
                type="button"
                role="menuitem"
                className="bulk-item"
                aria-label="Move to Account"
                aria-haspopup="menu"
                aria-expanded={sub}
                onClick={() => setSub((s) => !s)}
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
          onClose={() => setSub(false)}
        >
          <ul className="bulk-list bulk-move">
            {moveTo?.length === 0 && <li className="bulk-empty">No other accounts</li>}
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
