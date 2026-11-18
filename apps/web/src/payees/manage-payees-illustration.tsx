/** Budget's own drawing for an empty pane: an outlined price tag. */
export function PayeesIllustration() {
  return (
    <svg
      className="mp-illustration"
      width="120"
      viewBox="0 0 120 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 14h40l46 46-34 34-46-46z" />
      <circle cx="36" cy="36" r="6" />
      <path d="M64 30l22 22M58 44l14 14" opacity="0.5" />
    </svg>
  );
}
