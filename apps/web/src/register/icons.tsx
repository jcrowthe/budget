import type { SVGProps } from "react";

// Budget's own artwork, drawn on a 24-unit grid in currentColor.
const base = { viewBox: "0 0 24 24", fill: "currentColor" } as const;
type P = SVGProps<SVGSVGElement>;

export const PlusCircleIcon = (p: P) => (
  <svg {...base} width={16} height={16} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm-1.2 6h2.4v4.8H18v2.4h-4.8V18h-2.4v-4.8H6v-2.4h4.8V6Z"
    />
  </svg>
);
export const FileUpIcon = (p: P) => (
  <svg {...base} width={16} height={16} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M4 0h10l6 6v18H4V0Zm9 2H6v20h12V8h-5V2Zm-1 8 4 4.5-1.4 1.2-1.6-1.8V19h-2v-5.1l-1.6 1.8L8 14.5 12 10Z"
    />
  </svg>
);
export const UndoIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path d="M8.5 1 1 8.5 8.5 16l1.9-1.9-3.6-3.6H14a4.5 4.5 0 0 1 0 9h-3.5V23H14a7 7 0 0 0 0-14H6.8l3.6-3.6z" />
  </svg>
);
export const RedoIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path d="M15.5 1 23 8.5 15.5 16l-1.9-1.9 3.6-3.6H10a4.5 4.5 0 0 0 0 9h3.5V23H10a7 7 0 0 1 0-14h7.2l-3.6-3.6z" />
  </svg>
);
export const CaretDownIcon = (p: P) => (
  <svg {...base} width={8} height={8} aria-hidden="true" {...p}>
    <path d="M2 7h20L12 19z" />
  </svg>
);
export const CaretUpIcon = (p: P) => (
  <svg {...base} width={8} height={8} aria-hidden="true" {...p}>
    <path d="M2 17h20L12 5z" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"
    />
  </svg>
);
export const ClearedFilledIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm1.2 7.2c1.5 0 2.8.5 3.8 1.5l-1.4 1.7a3.4 3.4 0 0 0-2.4-1c-1.9 0-3.2 1.4-3.2 3.6s1.3 3.6 3.2 3.6c1 0 1.8-.4 2.5-1l1.3 1.7a5.6 5.6 0 0 1-3.9 1.5c-3.1 0-5.4-2.2-5.4-5.8s2.300-5.8 5.500-5.8Z"
    />
  </svg>
);
export const ClearedOutlineIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 1.6a10.400 10.400 0 1 0 0 20.800 10.400 10.400 0 0 0 0-20.800ZM12 0a12 12 0 1 1 0 24 12 12 0 0 1 0-24Zm1.200 7.200c1.500 0 2.800.5 3.800 1.500l-1.400 1.700a3.400 3.400 0 0 0-2.400-1c-1.900 0-3.200 1.400-3.200 3.600s1.300 3.600 3.200 3.600c1 0 1.800-.4 2.500-1l1.300 1.700a5.600 5.600 0 0 1-3.900 1.500c-3.100 0-5.400-2.200-5.400-5.800s2.300-5.800 5.500-5.800Z"
    />
  </svg>
);
export const LockIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 1a5 5 0 0 0-5 5v3H4v14h16V9h-3V6a5 5 0 0 0-5-5Zm3 8H9V6a3 3 0 0 1 6 0v3Zm-4 4h2v5h-2v-5Z"
    />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base} width={10} height={10} aria-hidden="true" {...p}>
    <path d="m3 12.500 1.500-1.500 4.500 4.500L19.500 5 21 6.500 9 18.500z" />
  </svg>
);
export const MinusIcon = (p: P) => (
  <svg {...base} width={10} height={10} aria-hidden="true" {...p}>
    <path d="M4 10.500h16v3H4z" />
  </svg>
);
export const CalculatorIcon = (p: P) => (
  <svg {...base} width={14} height={14} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M5 1h14a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Zm1 3v5h12V4H6Zm1 8v2.4h2.4V12H7Zm3.8 0v2.4h2.4V12h-2.4Zm3.8 0v2.4H17V12h-2.4ZM7 15.8v2.4h2.4v-2.4H7Zm3.8 0v2.4h2.4v-2.4h-2.4Zm3.8 0v2.4H17v-2.4h-2.4Z"
    />
  </svg>
);
export const ChevronLeftIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path d="M15.5 3 7 12l8.5 9 1.8-1.7L10.6 12l6.7-7.3z" />
  </svg>
);
export const ChevronRightIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path d="M8.5 3 17 12l-8.5 9-1.8-1.7L13.4 12 6.7 4.7z" />
  </svg>
);
