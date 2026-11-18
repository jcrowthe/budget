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
