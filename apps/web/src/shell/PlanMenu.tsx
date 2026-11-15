import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useCurrentPlan } from "./useCurrentPlan";

export function PlanMenu({ onNewPlan, onClose }: { onNewPlan: () => void; onClose: () => void }) {
  const { plan, plans } = useCurrentPlan();
  const navigate = useNavigate();
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
        New Plan
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
          Open Plan <span aria-hidden="true">›</span>
        </button>
        {sub ? (
          <div className="submenu" role="menu" aria-label="Plans">
            {plans.map((p) => (
              <button
                type="button"
                role="menuitem"
                key={p.id}
                onClick={() => {
                  onClose();
                  navigate(`/${p.id}/budget`);
                }}
              >
                <span>{p.name}</span>
                {p.id === plan?.id ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
