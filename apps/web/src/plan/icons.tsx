import type { SVGProps } from "react";

// Own artwork, drawn filled on a 24-unit grid.
const base = { viewBox: "0 0 24 24", fill: "currentColor" } as const;

export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M5.4 8 12 14.6 18.6 8 20 9.4l-8 8-8-8z" />
  </svg>
);
export const ChevronRightSmallIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M8 5.4 14.6 12 8 18.6 9.4 20l8-8-8-8z" />
  </svg>
);
export const UndoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M9 4 3 10l6 6 1.4-1.4L7.8 12H14a4 4 0 0 1 0 8h-3v2h3a6 6 0 0 0 0-12H7.8l2.6-2.6z" />
  </svg>
);
export const RedoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="m15 4 6 6-6 6-1.4-1.4 2.6-2.6H10a4 4 0 0 0 0 8h3v2h-3a6 6 0 0 1 0-12h6.2l-2.6-2.6z" />
  </svg>
);
export const ClockBackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2 4.9L6.6 18.3A9 9 0 1 0 13 3Zm-1 5v5l4 2.4.8-1.4-3.3-2V8z" />
  </svg>
);
export const BarsOnIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <rect x="3" y="6" width="18" height="4" rx="2" />
    <rect x="3" y="14" width="11" height="4" rx="2" />
  </svg>
);
export const BarsOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <rect x="3" y="5" width="18" height="2.5" rx="1.25" />
    <rect x="3" y="10.75" width="18" height="2.5" rx="1.25" />
    <rect x="3" y="16.5" width="18" height="2.5" rx="1.25" />
  </svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="m9.5 17.5-5-5 1.9-1.9 3.1 3.1 8.1-8.1 1.9 1.9z" />
  </svg>
);
