import type { SVGProps } from "react";

/** Budget's own gear: a ring with eight teeth, drawn filled in the current colour. */
export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" {...p}>
    {[0, 45, 90, 135].map((a) => (
      <rect key={a} x="7" y="0.5" width="2" height="15" rx="1" transform={`rotate(${a} 8 8)`} />
    ))}
    <path
      fillRule="evenodd"
      d="M8 3.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2Zm0 2.7a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8Z"
    />
  </svg>
);
