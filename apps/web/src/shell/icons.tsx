import type { SVGProps } from "react";

// Own artwork, drawn filled (fill currentColor, no stroke).
const base = { viewBox: "0 0 24 24", fill: "currentColor" } as const;
const nav = { viewBox: "0 0 24 20", fill: "currentColor" } as const;

export const PlanIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...nav} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M5 1h14a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4Zm-2 7v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8H3Zm3 4h5v2H6v-2Z"
    />
  </svg>
);
export const ReflectIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...nav} aria-hidden="true" {...p}>
    <path d="M2 10h4v9H2zM9 1h4v18H9zM16 6h4v13h-4z" />
  </svg>
);
export const AccountsIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...nav} aria-hidden="true" {...p}>
    <path d="M12 0 1 6v2h22V6L12 0ZM3 9h3v7H3V9Zm5 0h3v7H8V9Zm5 0h3v7h-3V9Zm5 0h3v7h-3V9ZM1 17h22v2H1v-2Z" />
  </svg>
);
export const CaretIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 12 12" fill="currentColor" width="12" height="12" aria-hidden="true" {...p}>
    <path d="M0 2h12L6 10z" />
  </svg>
);
export const ChevronRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M3.5 0.5 9 6l-5.5 5.5-1.4-1.4L6.2 6 2.1 1.9z" />
  </svg>
);
export const PlusCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v4h4v2h-4v4h-2v-4H7v-2h4V7Z"
    />
  </svg>
);
export const FolderIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M2 5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5Z" />
  </svg>
);
export const DocumentIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5Z" />
  </svg>
);
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M5.6 4.2 12 10.6l6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4z" />
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
