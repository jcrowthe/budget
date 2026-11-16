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
/** The dash of a half-checked checkbox. */
export const SubtractIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M5 11h14v2H5z" />
  </svg>
);
/** A pencil filling its box (16 px when sized by CSS). */
export const PencilIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="m0 19.2 14.4-14.4 4.8 4.8L4.8 24H0zM20.9 7.9l-4.8-4.8 1.7-1.7a2.4 2.4 0 0 1 3.4 0l1.4 1.4a2.4 2.4 0 0 1 0 3.4z" />
  </svg>
);
/** Card chevrons that fill their box: the source's panel chevrons are full-bleed, the grid's are not. */
export const CardChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M0 5.6 1.6 4 12 14.4 22.4 4 24 5.6l-12 12z" />
  </svg>
);
export const CardChevronRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M5.6 0 4 1.6 14.4 12 4 22.4 5.6 24l12-12z" />
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

// Ready to Assign box and breakdown (own artwork).
export const SubtractCircleFillIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm5 12H7v-2h10z" />
  </svg>
);
export const AddCircleFillIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm5 12h-4v4h-2v-4H7v-2h4V7h2v4h4z" />
  </svg>
);
export const InfoCircleFillIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm1 16h-2v-6h2zm0-8h-2V7h2z" />
  </svg>
);
export const CheckCircleFillIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm-1.6 15.6L6 12.2l1.4-1.4 3 3 6.2-6.2L18 9z" />
  </svg>
);

// Targets (EXF-508, EXF-514): own 16-unit artwork.
const small = { viewBox: "0 0 16 16", fill: "currentColor" } as const;
export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...small} aria-hidden="true" {...p}>
    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.25 4.5v4l2.9 1.7.75-1.3-2.15-1.25V4.5z" />
  </svg>
);
export const ClockCheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...small} aria-hidden="true" {...p}>
    <path d="M8 1a7 7 0 1 0 7 7h-1.5A5.5 5.5 0 1 1 8 2.5zM7.25 4.5v4l2.9 1.7.75-1.3-2.15-1.25V4.5zM11.4 1.3 9.9 2.8l1.9 1.9 3.3-3.3-1.1-1.1-2.2 2.2z" />
  </svg>
);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...small} aria-hidden="true" {...p}>
    <path d="M6 1h4l.5 1.5H14V4H2V2.5h3.5zM3.2 5h9.6l-.7 9.1a1 1 0 0 1-1 .9H4.9a1 1 0 0 1-1-.9zM6 6.5v6h1.2v-6zm2.8 0v6H10v-6z" />
  </svg>
);
export const CaretDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 9 9" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M0.8 2.5 4.5 6.5 8.2 2.5z" />
  </svg>
);
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...small} aria-hidden="true" {...p}>
    <path d="M4.5 0v2H2.5A1.5 1.5 0 0 0 1 3.5v10A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 13.5 2h-2V0H10v2H6V0zM2.5 6h11v7.5h-11z" />
  </svg>
);
export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...small} aria-hidden="true" {...p}>
    <path d="M10.6 2.4 9.2 1 2.2 8l7 7 1.4-1.4L5 8z" />
  </svg>
);
export const ChevronRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...small} aria-hidden="true" {...p}>
    <path d="M5.4 2.4 6.8 1l7 7-7 7-1.4-1.4L11 8z" />
  </svg>
);
/** The donut beside the Target card's title. */
export const TargetRingIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...small} aria-hidden="true" {...p}>
    <path
      d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
      fillRule="evenodd"
    />
  </svg>
);
