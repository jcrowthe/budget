import type { SVGProps } from "react";

// Budget's own artwork, drawn on a 24-unit grid in currentColor.
type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 24 24", fill: "currentColor" } as const;

export const CashIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M1 4h22v16H1V4Zm2 2v3a3 3 0 0 0 3-3H3Zm18 0h-3a3 3 0 0 0 3 3V6ZM3 15v3h3a3 3 0 0 0-3-3Zm18 0a3 3 0 0 0-3 3h3v-3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
    />
  </svg>
);
export const CardIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M2 3h20a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 4v2h20V7H2Zm0 6v6h20v-6H2Zm3 2h6v2H5v-2Z"
    />
  </svg>
);
export const ChartUpIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path d="M14 4h9v9h-2.4v-5l-7.700 7.700-4.300-4.300L2.700 18.700 1 17l7.600-7.600 4.300 4.300L18.900 6.400H14V4Z" />
  </svg>
);
export const ChartDownIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path d="M14 20h9v-9h-2.400v5l-7.700-7.700-4.300 4.300L2.700 5.300 1 7l7.600 7.600 4.300-4.300 6 6.300H14V20Z" />
  </svg>
);
export const LockIcon = (p: P) => (
  <svg {...base} width={12} height={12} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M12 1a6 6 0 0 0-6 6v3H4v13h16V10h-2V7a6 6 0 0 0-6-6Zm0 2a4 4 0 0 1 4 4v3H8V7a4 4 0 0 1 4-4Zm-1 11h2v5h-2v-5Z"
    />
  </svg>
);
export const PencilIcon = (p: P) => (
  <svg {...base} width={16} height={16} aria-hidden="true" {...p}>
    <path d="M16.500 2.500 21.500 7.500 8 21H3v-5L16.500 2.500Zm0 2.800L5 16.800V19h2.200L18.700 7.500l-2.200-2.200Z" />
  </svg>
);
export const StarOutlineIcon = (p: P) => (
  <svg {...base} width={16} height={16} aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="m12 1 3.300 7 7.700 1-5.600 5.300 1.400 7.700-6.800-3.700-6.800 3.700 1.400-7.700L1 9l7.700-1L12 1Zm0 5.200-2 4.200-4.600.6 3.400 3.200-.8 4.600 4-2.200 4 2.200-.8-4.600 3.400-3.200-4.600-.6-2-4.200Z"
    />
  </svg>
);
export const StarFilledIcon = (p: P) => (
  <svg {...base} width={16} height={16} aria-hidden="true" {...p}>
    <path d="m12 1 3.300 7 7.700 1-5.600 5.300 1.400 7.700-6.800-3.700-6.800 3.700 1.400-7.700L1 9l7.700-1L12 1Z" />
  </svg>
);
