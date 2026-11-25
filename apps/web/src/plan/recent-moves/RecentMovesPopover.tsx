import {
  dayGroups,
  entryText,
  matchesType,
  type RecentMove,
  type RecentMovesType,
} from "@budget/schema/recent-moves";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRecentMoves } from "../../api/recent-moves";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { usePlanMonth } from "../../shell/planPaths";
import { monthLabel } from "../monthNav";
import { Popover } from "../Popover";
import "./recent-moves.css";

const TABS: { type: RecentMovesType; label: string }[] = [
  { type: "all", label: "All" },
  { type: "moved", label: "Moved" },
  { type: "assigned", label: "Assigned" },
];
const FILTERED_EMPTY: Record<RecentMovesType, string> = {
  all: "No recent moves",
  moved: "No moved money in the last 34 days",
  assigned: "No assigned money in the last 34 days",
};
const METHOD: Partial<Record<RecentMove["method"], string>> = {
  cover: "Cover",
  auto_assign: "Auto-Assign",
  undo: "Undo",
};

type Side = NonNullable<RecentMove["from"]>;

function Chip({ side, onPick }: { side: Side; onPick: (s: Side) => void }) {
  return (
    <button
      type="button"
      className="recent-move-chip"
      disabled={side.deleted}
      title={side.category_name}
      onClick={() => onPick(side)}
    >
      <span className="recent-move-chip-name">{side.category_name}</span>{" "}
      <span className="recent-move-chip-month">{monthLabel(side.month)}</span>
    </button>
  );
}

function Icon({ moved }: { moved: boolean }) {
  return (
    <svg className="recent-move-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {moved ? (
        <path
          d="M4 7h10l-3-3M16 13H6l3 3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M10 4v12M4 10h12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function Card({ e, onPick }: { e: RecentMove; onPick: (s: Side) => void }) {
  const fmt = usePlanFormatter();
  const t = entryText(e, fmt.money);
  const method = METHOD[e.method];
  return (
    <li className="recent-move">
      <Icon moved={e.kind === "moved"} />
      <div className="recent-move-body">
        <div className="recent-move-text">
          <span className="recent-move-actor">{e.actor.name}</span> {t.lead}{" "}
          {e.from && <Chip side={e.from} onPick={onPick} />}
          {t.between && ` ${t.between} `}
          {(e.kind === "assigned" || t.between) && e.to && <Chip side={e.to} onPick={onPick} />}
        </div>
        {method && <div className="recent-move-method">{method}</div>}
      </div>
      <span className="recent-move-avatar" title={e.actor.name} aria-hidden="true">
        {e.actor.initial}
      </span>
    </li>
  );
}

/**
 * The plan's Recent Moves (EXF-506): assigning and money moves of the last 34 days under their day, with
 * All / Moved / Assigned. A chip closes the popover, opens the entry's month and selects the category.
 */
export function RecentMovesPopover({
  anchor,
  onClose,
  onSelectCategory,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onSelectCategory?: (id: string) => void;
}) {
  const { budgetId, setMonth } = usePlanMonth();
  const q = useRecentMoves(budgetId);
  const [type, setType] = useState<RecentMovesType>("all");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  const all = q.data;
  const shown = useMemo(() => (all ?? []).filter((e) => matchesType(e, type)), [all, type]);
  const days = useMemo(() => dayGroups(shown, new Date()), [shown]);
  const pick = (s: Side) => {
    onClose();
    setMonth(s.month);
    onSelectCategory?.(s.category_id);
  };
  const none = all && all.length === 0;
  return (
    <Popover
      anchor={anchor}
      width={439}
      label="Recent Moves"
      className="recent-moves-popover"
      dismissOnOutside
      onClose={onClose}
    >
      <div className="recent-moves-header">
        <h2 className="recent-moves-title">Recent Moves</h2>
        <div className="recent-moves-tabs" role="tablist" aria-label="Show">
          {TABS.map((t, i) => (
            <button
              key={t.type}
              ref={i === 0 ? first : undefined}
              type="button"
              role="tab"
              aria-selected={type === t.type}
              className="recent-moves-tab"
              onClick={() => setType(t.type)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="recent-moves-body" aria-busy={q.isPending}>
        {none && (
          <div className="recent-moves-zero">
            <p className="recent-moves-zero-title">No recent moves</p>
            <p>Assigning and moving money in the last 34 days shows up here.</p>
            <button type="button" className="popover-button is-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
        {all && !none && shown.length === 0 && (
          <p className="recent-moves-filtered-zero">{FILTERED_EMPTY[type]}</p>
        )}
        {q.isError && (
          <p className="recent-moves-filtered-zero">Recent moves could not be loaded.</p>
        )}
        {days.map((d) => (
          <section key={d.key} className="recent-moves-day">
            <h3 className="recent-moves-day-heading">
              <span>{d.label}</span>
              {d.today && <span className="recent-moves-today">Today</span>}
            </h3>
            <ul className="recent-moves-list">
              {d.entries.map((e) => (
                <Card key={e.id} e={e} onPick={pick} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Popover>
  );
}
