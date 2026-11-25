import type { SVGProps } from "react";

/** A calendar page, drawn filled on a 24-unit grid (own artwork); it takes the pill's text colour. */
export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M7 1.5h2V4h6V1.5h2V4h2.5A2.5 2.5 0 0 1 22 6.5v14a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 20.5v-14A2.5 2.5 0 0 1 4.5 4H7zM4 10v10.5a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5V10zm3 2.5h3v3H7z" />
  </svg>
);
