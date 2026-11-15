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
    <path d="M8.5 1 1 8.5 8.5 16l1.9-1.9-3.6-3.6H14a4.5 4.5 0 0 1 0 9h-3.5V23H14a7 7 0 0 0 0-14H6.8l3.6-3.6z" />
  </svg>
);
export const RedoIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M15.5 1 23 8.5 15.5 16l-1.9-1.9 3.6-3.6H10a4.5 4.5 0 0 0 0 9h3.5V23H10a7 7 0 0 1 0-14h7.2l-3.6-3.6z" />
  </svg>
);
export const ClockBackIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M13 1a11 11 0 0 0-11 11H0l4.5 4.5L9 12H5.5A7.5 7.5 0 1 1 8 17.6l-1.9 1.9A11 11 0 1 0 13 1Zm-1.2 5.5v6l5 3 .9-1.5-3.9-2.3V6.5z" />
  </svg>
);
export const BarsOnIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <rect x="0.5" y="1.5" width="23" height="9" rx="2.5" />
    <rect x="0.5" y="13.5" width="23" height="9" rx="2.5" />
  </svg>
);
export const BarsOffIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <rect x="0.5" y="1.5" width="23" height="5" rx="2.5" />
    <rect x="0.5" y="9.5" width="23" height="5" rx="2.5" />
    <rect x="0.5" y="17.5" width="23" height="5" rx="2.5" />
  </svg>
);
export const PlusCircleFillIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm-1.2 6h2.4v4.8H18v2.4h-4.8V18h-2.4v-4.8H6v-2.4h4.8V6Z"
    />
  </svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="m9.5 17.5-5-5 1.9-1.9 3.1 3.1 8.1-8.1 1.9 1.9z" />
  </svg>
);
/**
 * A 2×2 grid of + − × ÷ glyphs filling a 16-unit box. Measured on the source's calculator icon (getBBox, viewBox
 * 0 0 16 16): 1.5-unit strokes, '+' centred (3.5,3.5) with 7-unit arms, '−' bar x 9–16 at y 2.75–4.25, '×' centred
 * (3.5,12.5), '÷' bar x 9–16 at y 11.75–13.25 with r=1 dots at (12.5,10) and (12.5,15).
 */
export const CalculatorIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} viewBox="0 0 16 16" aria-hidden="true" {...p}>
    <path d="M0 2.75h7v1.5H0zM2.75 0h1.5v7h-1.5zM9 2.75h7v1.5H9zM9 11.75h7v1.5H9z" />
    <circle cx="12.5" cy="10" r="1" />
    <circle cx="12.5" cy="15" r="1" />
    <path
      d="M1.2 10.2 5.8 14.8M5.8 10.2 1.2 14.8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);
