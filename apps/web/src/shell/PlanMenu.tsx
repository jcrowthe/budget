import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router";
import {
  ArrowsCircleIcon,
  BankIcon,
  ChevronRightIcon,
  DocumentDownIcon,
  DocumentIcon,
  FlagIcon,
  FolderIcon,
  KeyboardIcon,
  LeafIcon,
  LogoutIcon,
  PaintRollerIcon,
  PlusCircleIcon,
  WrenchIcon,
} from "./icons";
import { placeMenu, placeMenuBeside, placeSubmenu } from "./menuPlacement";
import { planMenuActions } from "./planMenuActions";
import {
  type EntryDef,
  type IconKey,
  PLAN_MENU,
  type PlanMenuAction,
  type ResolvedEntry,
  resolveEntry,
  VIEW_ALL_PLANS,
} from "./planMenuEntries";
import { recentOtherPlans, useCurrentPlan } from "./useCurrentPlan";

const ICONS: Record<IconKey, (p: { className?: string }) => ReactNode> = {
  "plus-circle": PlusCircleIcon,
  folder: FolderIcon,
  wrench: WrenchIcon,
  "arrows-circle": ArrowsCircleIcon,
  flag: FlagIcon,
  "paint-roller": PaintRollerIcon,
  "document-down": DocumentDownIcon,
  leaf: LeafIcon,
  bank: BankIcon,
  keyboard: KeyboardIcon,
  logout: LogoutIcon,
  document: DocumentIcon,
};

const LOGOUT_HREF = "/cdn-cgi/access/logout";
const ENABLED = '[role="menuitem"]:not([aria-disabled="true"])';
const focusables = (el: HTMLElement | null) =>
  el ? Array.from(el.querySelectorAll<HTMLElement>(ENABLED)) : [];

type Pos = { left: number; top: number; maxHeight: number };

/** Moves focus within one menu for the arrow, Home and End keys. Returns true when it handled the key. */
function moveFocus(e: ReactKeyboardEvent, container: HTMLElement | null) {
  const items = focusables(container);
  if (items.length === 0) return false;
  const at = items.indexOf(document.activeElement as HTMLElement);
  let next: number;
  if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
  else if (e.key === "ArrowUp")
    next = at < 0 ? items.length - 1 : (at - 1 + items.length) % items.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = items.length - 1;
  else return false;
  e.preventDefault();
  items[next]?.focus();
  return true;
}

export function PlanMenu({
  anchorRef,
  openedByKeyboard,
  initialFocus = "first",
  onClose,
  onDialog,
  placement = "below",
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  openedByKeyboard: boolean;
  initialFocus?: "first" | "last";
  onClose: (opts: { focusButton: boolean }) => void;
  onDialog: (action: Extract<PlanMenuAction, { Dialog: unknown }>) => void;
  placement?: "below" | "beside";
}) {
  const { plan, plans } = useCurrentPlan();
  const navigate = useNavigate();
  const others = recentOtherPlans(plans, plan?.id);
  const hasPlan = !!plan;
  const [sub, setSub] = useState(false);
  const [menuPos, setMenuPos] = useState<Pos | null>(null);
  const [subPos, setSubPos] = useState<Pos | null>(null);
  const [tick, setTick] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusSub = useRef(false);

  const close = useCallback((focusButton: boolean) => onClose({ focusButton }), [onClose]);

  // Place the menu under the button, and again on resize and when the menu scrolls.
  useLayoutEffect(() => {
    void tick; // re-run on resize and scroll
    const a = anchorRef.current;
    if (!a) return;
    const rect = a.getBoundingClientRect();
    setMenuPos(
      placement === "beside"
        ? placeMenuBeside(
            rect,
            a.closest("nav")?.getBoundingClientRect().right ?? rect.right,
            window.innerHeight,
          )
        : placeMenu(rect, window.innerHeight),
    );
  }, [anchorRef, tick, placement]);
  // Place the submenu beside the Open Plan row, measured once it is rendered.
  useLayoutEffect(() => {
    void tick;
    void menuPos;
    const m = menuRef.current;
    const s = subRef.current;
    const row = m?.querySelector<HTMLElement>('[data-entry="open-plan"]');
    if (!sub || !m || !s || !row) return setSubPos(null);
    setSubPos(
      placeSubmenu(
        m.getBoundingClientRect(),
        row.getBoundingClientRect(),
        { width: s.offsetWidth, height: s.offsetHeight },
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [sub, tick, menuPos]);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener("resize", again);
    const m = menuRef.current;
    m?.addEventListener("scroll", again);
    return () => {
      window.removeEventListener("resize", again);
      m?.removeEventListener("scroll", again);
    };
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Initial focus: a row when opened by keyboard, else the menu itself.
  const focused = useRef(false);
  useEffect(() => {
    const m = menuRef.current;
    // A hidden menu cannot take focus: wait until it is placed.
    if (!m || !menuPos || focused.current) return;
    focused.current = true;
    const items = focusables(m);
    const target = openedByKeyboard
      ? initialFocus === "last"
        ? items[items.length - 1]
        : items[0]
      : undefined;
    (target ?? m).focus();
  }, [openedByKeyboard, initialFocus, menuPos]);
  // A submenu opened by keyboard focuses its first row once it is placed.
  useEffect(() => {
    if (sub && subPos && focusSub.current) {
      focusSub.current = false;
      focusables(subRef.current)[0]?.focus();
    }
  }, [sub, subPos]);

  // Dismissal: an outside press (not the button, menu or submenu) and Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        anchorRef.current?.contains(t) ||
        menuRef.current?.contains(t) ||
        subRef.current?.contains(t)
      )
        return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close(true);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, close]);

  const openSub = (byKeyboard: boolean) => {
    clearTimeout(timer.current);
    focusSub.current = byKeyboard;
    setSub(true);
  };
  const closeSubAndFocusRow = () => {
    setSub(false);
    menuRef.current?.querySelector<HTMLElement>('[data-entry="open-plan"]')?.focus();
  };

  const select = (r: ResolvedEntry, byKeyboard: boolean) => {
    if (!r.enabled) return;
    if (r.id === "open-plan") return openSub(byKeyboard);
    const a = r.action;
    if (!a) return;
    if ("Dialog" in a) {
      close(false);
      onDialog(a);
    } else {
      close(true);
      a.run({ budgetId: plan?.id ?? null, navigate });
    }
  };

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      return close(true);
    }
    if (moveFocus(e, menuRef.current)) return;
    const onOpen = (document.activeElement as HTMLElement | null)?.dataset.entry === "open-plan";
    if (e.key === "ArrowRight" && onOpen) {
      e.preventDefault();
      openSub(true);
    }
  };
  const onSubKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Tab") {
      e.preventDefault();
      return close(true);
    }
    if (moveFocus(e, subRef.current)) return;
    if (e.key === "ArrowLeft" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSubAndFocusRow();
    }
  };

  const row = (def: EntryDef, inSub: boolean) => {
    const r = resolveEntry(def, planMenuActions, hasPlan);
    const Icon = ICONS[r.icon];
    const common = {
      role: "menuitem",
      tabIndex: -1,
      "data-entry": r.id,
      "aria-disabled": r.enabled ? undefined : true,
    } as const;
    if (r.id === "log-out")
      return (
        <a key={r.id} {...common} href={LOGOUT_HREF}>
          <Icon />
          <span className="label">{r.label}</span>
        </a>
      );
    const isOpen = r.id === "open-plan";
    return (
      <button
        key={r.id}
        type="button"
        {...common}
        {...(isOpen
          ? {
              "aria-haspopup": "menu" as const,
              "aria-expanded": sub,
              ...(sub ? { "aria-controls": "plan-submenu" } : {}),
              onMouseEnter: () => openSub(false),
            }
          : inSub
            ? {}
            : {
                onMouseEnter: () => {
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => setSub(false), 200);
                },
              })}
        onClick={(e) => select(r, e.detail === 0)}
      >
        <Icon />
        <span className="label">{r.label}</span>
        {isOpen ? <ChevronRightIcon className="chevron" /> : null}
      </button>
    );
  };

  return createPortal(
    <>
      <div
        className="menu"
        role="menu"
        id="plan-menu"
        aria-label="Plan"
        tabIndex={-1}
        ref={menuRef}
        onKeyDown={onMenuKey}
        style={menuPos ?? { visibility: "hidden" }}
      >
        {PLAN_MENU.map((section, i) => (
          <div key={section.heading ?? section.entries[0]?.id} className="menu-section">
            {i > 0 ? <hr className="menu-separator" /> : null}
            {section.heading ? <div className="menu-heading">{section.heading}</div> : null}
            {section.entries.map((d) => row(d, false))}
          </div>
        ))}
      </div>
      {sub ? (
        <div
          className="menu submenu"
          role="menu"
          id="plan-submenu"
          aria-label="Plans"
          ref={subRef}
          onKeyDown={onSubKey}
          onMouseEnter={() => clearTimeout(timer.current)}
          style={subPos ?? { visibility: "hidden" }}
        >
          {others.length > 0 ? (
            <>
              <div className="menu-heading">Recent Plans</div>
              {others.map((p) => (
                <Link
                  key={p.id}
                  role="menuitem"
                  tabIndex={-1}
                  to={`/${p.id}/budget`}
                  onClick={() => close(false)}
                >
                  <DocumentIcon />
                  <span className="label">{p.name}</span>
                </Link>
              ))}
              <hr className="menu-separator" />
            </>
          ) : null}
          {row(VIEW_ALL_PLANS, true)}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
