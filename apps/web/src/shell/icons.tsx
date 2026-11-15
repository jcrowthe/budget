import type { SVGProps } from "react";

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const PlanIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M3 10h18M8 15h3" />
  </svg>
);
export const ReflectIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);
export const AccountsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18" />
  </svg>
);
export const CaretIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} width="12" height="12" aria-hidden="true" {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const PlusCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
export const Logo = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" {...p}>
    <rect width="32" height="32" rx="8" fill="#545BFE" />
    <path
      d="M10 7h7.5a4.5 4.5 0 0 1 2.6 8.2A4.8 4.8 0 0 1 18 25h-8V7Zm3.2 3v4.2h4a2.1 2.1 0 0 0 0-4.2h-4Zm0 7.2V22H18a2.4 2.4 0 0 0 0-4.8h-4.8Z"
      fill="#fff"
      fillRule="evenodd"
    />
  </svg>
);
