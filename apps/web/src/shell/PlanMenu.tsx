import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronRightIcon, DocumentIcon, FolderIcon, PlusCircleIcon } from "./icons";
import { useCurrentPlan } from "./useCurrentPlan";

export function PlanMenu({ onNewPlan, onClose }: { onNewPlan: () => void; onClose: () => void }) {
  const { plan, plans } = useCurrentPlan();
  const navigate = useNavigate();
  const others = plans.filter((p) => p.id !== plan?.id);
  const [sub, setSub] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div className="menu" role="menu" ref={ref}>
      <button type="button" role="menuitem" onClick={onNewPlan}>
        <PlusCircleIcon />
        <span className="label">New Plan</span>
      </button>
      <div className="menu-item-wrap">
        <button
          type="button"
          role="menuitem"
          aria-haspopup="true"
          aria-expanded={sub}
          onClick={() => setSub(true)}
          onMouseEnter={() => setSub(true)}
        >
          <FolderIcon />
          <span className="label">Open Plan</span>
          <ChevronRightIcon className="chevron" />
        </button>
        {sub ? (
          <div className="submenu" role="menu" aria-label="Plans">
            <div className="submenu-heading">Recent Plans</div>
            {others.map((p) => (
              <button
                type="button"
                role="menuitem"
                key={p.id}
                onClick={() => {
                  onClose();
                  navigate(`/${p.id}/budget`);
                }}
              >
                <DocumentIcon />
                <span className="label">{p.name}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
