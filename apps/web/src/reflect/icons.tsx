import type { SVGProps } from "react";

// Own artwork on a 24-unit grid.
const base = { viewBox: "0 0 24 24", fill: "currentColor" } as const;
type P = SVGProps<SVGSVGElement>;

export const CalendarIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zM5 10v9h14v-9zm0-4v2h14V6z" />
  </svg>
);
export const ChevronLeftIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M15.6 5.4 9 12l6.6 6.6L14.2 20l-8-8 8-8z" />
  </svg>
);
export const ChevronRightIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M8.4 5.4 15 12l-6.6 6.6L9.8 20l8-8-8-8z" />
  </svg>
);
export const CaretDownIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M6 9h12l-6 7z" />
  </svg>
);
export const FileTextIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M6 2h8l6 6v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm7 2H7v16h12V9h-6zM9 13h8v2H9zm0 4h6v2H9z" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="m9.5 17.5-5-5 1.4-1.4 3.6 3.6 8.6-8.6 1.4 1.4z" />
  </svg>
);
export const EyeSlashIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="m3.3 2 18.7 18.7-1.3 1.3-3.2-3.2A10.7 10.7 0 0 1 12 20C6.5 20 2.7 15.6 1.5 12a14 14 0 0 1 3.6-5.4L2 3.3zM12 6a10.7 10.7 0 0 1 10.5 6 14.200 14.200 0 0 1-2.800 3.900l-3-3A4.800 4.800 0 0 0 11 7.200L9.300 5.500A11 11 0 0 1 12 6zm-3.500 6.500a3.500 3.500 0 0 0 3.500 3.500l-3.500-3.500z" />
  </svg>
);
export const InfoIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 7h2v6h-2zm0-3h2v2h-2z" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="M10 3a7 7 0 0 1 5.600 11.200l5.100 5.100-1.400 1.400-5.100-5.100A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base} aria-hidden="true" {...p}>
    <path d="m6.400 5 5.600 5.600L17.600 5 19 6.400 13.400 12l5.600 5.600-1.400 1.400-5.600-5.600L6.400 19 5 17.600l5.600-5.600L5 6.400z" />
  </svg>
);
