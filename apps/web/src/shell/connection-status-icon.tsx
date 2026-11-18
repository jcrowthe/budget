import type { SVGProps } from "react";

/** A filled warning triangle with an exclamation mark, in the text colour (the strip and the sidebar mark). */
export const WarningTriangleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M8 1.5c.4 0 .8.2 1 .6l6 10.6c.4.7-.1 1.6-1 1.6H2c-.9 0-1.4-.9-1-1.6L7 2.1c.2-.4.6-.6 1-.6Zm-.7 4.3v3.9h1.4V5.8H7.3Zm0 5.2v1.4h1.4V11H7.3Z"
    />
  </svg>
);

/** A key: the bank asks the owner to authorize again (16×16, the text colour; Budget's own drawing). */
export const KeyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M10.5 1.5a4 4 0 0 0-3.8 5.2L1.5 11.9V14.5H4.1v-1.4h1.4v-1.4h1.4l1.5-1.5a4 4 0 1 0 2.1-7.7Zm1.3 2.2a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2Z"
    />
  </svg>
);

/** A diamond with an exclamation mark: the linked account is not found at the bank (16×16). */
export const DiamondAlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M8.7 1.3l6 6c.4.4.4 1 0 1.4l-6 6c-.4.4-1 .4-1.4 0l-6-6c-.4-.4-.4-1 0-1.4l6-6c.4-.4 1-.4 1.4 0ZM7.3 4.6v4h1.4v-4H7.3Zm0 5.2v1.4h1.4V9.8H7.3Z"
    />
  </svg>
);

/** An octagon with an exclamation mark: the import service cannot serve this bank (16×16). */
export const OctagonAlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16" aria-hidden="true" {...p}>
    <path
      fillRule="evenodd"
      d="M5.2 1h5.6c.3 0 .5.1.7.3l3.2 3.2c.2.2.3.4.3.7v5.6c0 .3-.1.5-.3.7l-3.2 3.2c-.2.2-.4.3-.7.3H5.2c-.3 0-.5-.1-.7-.3L1.3 11.5c-.2-.2-.3-.4-.3-.7V5.2c0-.3.1-.5.3-.7l3.2-3.2c.2-.2.4-.3.7-.3ZM7.3 4.6v4h1.4v-4H7.3Zm0 5.2v1.4h1.4V9.8H7.3Z"
    />
  </svg>
);
