import {
  ADD_ACTIVITY_ITEMS,
  ADD_ACTIVITY_LABEL,
  type AddActivityId,
} from "@budget/schema/loan-add-activity";
import { useRef, useState } from "react";
import { Popover } from "../register/Popover";
import "../register/register.css";
import "./loan-activity.css";

/** The loan page's primary "Add Activity" button and its menu of four or five items (Add Escrow only for a mortgage) (EXF-542). */
export function AddActivityMenu({
  mortgage,
  onPick,
}: {
  mortgage: boolean;
  onPick: (id: AddActivityId) => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {ADD_ACTIVITY_LABEL}
      </button>
      {open && button.current ? (
        <Popover
          anchor={button.current}
          placement="below"
          width={320}
          align="start"
          label={ADD_ACTIVITY_LABEL}
          onClose={() => setOpen(false)}
        >
          <ul className="bulk-list">
            {ADD_ACTIVITY_ITEMS.filter((item) => mortgage || item.id !== "escrow").map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="bulk-item loan-add-item"
                  aria-describedby={`loan-add-${item.id}-sub`}
                  onClick={() => {
                    setOpen(false);
                    onPick(item.id);
                  }}
                >
                  <span className="loan-add-label">{item.label}</span>
                  <span id={`loan-add-${item.id}-sub`} className="loan-add-subtitle">
                    {item.subtitle}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </>
  );
}
