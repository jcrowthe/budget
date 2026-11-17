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
export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M0.5 3.5 6 9l5.5-5.5-1.4-1.4L6 6.2 1.9 2.1z" />
  </svg>
);
export const PencilIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M8.6 0.9a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1 0 1.4L4.3 10.2 1 11l0.8-3.3z" />
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
export const ChevronLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M15.4 4.6 14 3.2 5.2 12 14 20.8l1.4-1.4L8 12z" />
  </svg>
);
export const CaretRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 12 12" fill="currentColor" width="12" height="12" aria-hidden="true" {...p}>
    <path d="M2 0v12l8-6z" />
  </svg>
);
export const CheckCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.6 14.4L6 12l1.4-1.4 3 3 6.2-6.2L18 8.8z"
    />
  </svg>
);
export const BankIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M12 3 3 8v2h18V8l-9-5ZM5 12v6h2v-6H5Zm4 0v6h2v-6H9Zm4 0v6h2v-6h-2Zm4 0v6h2v-6h-2ZM3 19v2h18v-2H3Z" />
  </svg>
);

type IconProps = SVGProps<SVGSVGElement>;
export const WrenchIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M20.7 5.3a5 5 0 0 1-6.6 6.2L7 18.6a2.1 2.1 0 0 1-3-3l7.1-7.1A5 5 0 0 1 17.3 2l-3 3 .7 3 3 .7 3-3-.3-.4ZM5.5 16.5a.9.9 0 1 0 1.3 1.3.9.9 0 0 0-1.3-1.3Z" />
  </svg>
);
export const ArrowsCircleIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M12 4a8 8 0 0 1 7.7 6h-2.1A6 6 0 0 0 7 8.6L9 10.5H3V4.5l1.6 1.6A9.9 9.9 0 0 1 12 4Zm9 9.5v6l-1.6-1.6A10 10 0 0 1 4.3 14h2.1A6 6 0 0 0 17 15.4l-2-1.9h6Z" />
  </svg>
);
export const FlagIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M5 2h2v1.2c2-1 4-.8 6 .2s4 1.2 6 .2v10c-2 1-4 .8-6-.2s-4-1.2-6-.2V22H5V2Z" />
  </svg>
);
export const PaintRollerIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M6 2h12a2 2 0 0 1 2 2v1h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-8v2h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h-1v-3a1 1 0 0 1 1-1h8V7h-1v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
  </svg>
);
export const DocumentDownIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5ZM11 11h2v4.2l1.6-1.6 1.4 1.4-4 4-4-4 1.4-1.4 1.6 1.6V11Z"
    />
  </svg>
);
export const LeafIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M20 3C10 3 4 8 4 14c0 1.5.4 2.8 1 3.9L3 20.4 4.6 22l2.5-2.1c1.1.7 2.4 1.1 3.9 1.1 6 0 10-6 9-18Zm-9 15c-1.3 0-2.4-.5-3.2-1.2C9 12 12 9 16 8c-3 2-5 5-5 10Z" />
  </svg>
);
export const KeyboardIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1 3v2h2V8H5Zm4 0v2h2V8H9Zm4 0v2h2V8h-2Zm4 0v2h2V8h-2ZM5 12v2h2v-2H5Zm4 0v2h2v-2H9Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2ZM8 15.5v1.5h8v-1.5H8Z" />
  </svg>
);
export const LogoutIcon = (p: IconProps) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M4 3h9a1 1 0 0 1 1 1v3h-2V5H6v14h6v-2h2v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm12.5 4.5L21 12l-4.5 4.5-1.4-1.4 2.1-2.1H9v-2h8.2l-2.1-2.1 1.4-1.4Z" />
  </svg>
);

// Own artwork: a window with a hollow left panel and a triangle pointing at the panel (close) or away (open).
export const SidebarCloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm1 2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2V4H5Zm4 0v16h10a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H9Zm9 5v6l-6-3 6-3Z"
    />
  </svg>
);
export const SidebarOpenIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm1 2a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h2V4H5Zm4 0v16h10a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H9Zm3 5 6 3-6 3V9Z"
    />
  </svg>
);

/** A linked account whose connection works: a check mark (12×12). */
export const LinkedCheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 12 12" fill="currentColor" width="12" height="12" aria-hidden="true" {...p}>
    <path d="M6 0a6 6 0 1 0 0 12A6 6 0 0 0 6 0Zm-1 8.6L2.6 6.2l.9-.9L5 6.8l3.5-3.5.9.9L5 8.6Z" />
  </svg>
);
/** A linked account whose connection needs attention: a plain warning mark (12×12). */
export const LinkWarningIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 12 12" fill="currentColor" width="12" height="12" aria-hidden="true" {...p}>
    <path d="M6 0a6 6 0 1 0 0 12A6 6 0 0 0 6 0Zm-.6 2.8h1.2v4H5.4v-4Zm0 5h1.2V9H5.4V7.8Z" />
  </svg>
);
