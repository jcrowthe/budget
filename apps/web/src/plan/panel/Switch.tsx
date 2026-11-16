/** A labelled on/off switch: a 40×24 track with a knob (measured on the source: track rx 12, knob r 10). */
export function Switch({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="target-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
        <rect className="switch-track" width="40" height="24" rx="12" />
        <circle className="switch-knob" cx={checked ? 28 : 12} cy="12" r="10" />
      </svg>
      <span>{label}</span>
    </button>
  );
}
