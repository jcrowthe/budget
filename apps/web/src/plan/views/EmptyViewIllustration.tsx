/** Our own line drawing for an empty custom view: a tray with nothing in it and a few dashed outlines. */
export function EmptyViewIllustration() {
  return (
    <svg
      className="view-empty-art"
      width="160"
      height="120"
      viewBox="0 0 160 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M24 70h34l6 12h32l6-12h34" />
      <path d="M24 70l12-38h88l12 38v30a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6z" />
      <rect x="52" y="12" width="56" height="10" rx="4" strokeDasharray="4 5" />
      <rect x="44" y="40" width="72" height="10" rx="4" strokeDasharray="4 5" />
      <path d="M72 94h16" />
    </svg>
  );
}
