interface IconProps {
  className?: string;
  size?: number;
}

export function ChevronCircleLeftIcon({ className, size = 30 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" />
      <path
        d="M14 6.5 9 12l5 5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronCircleRightIcon({ className, size = 30 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 6.5 15 12l-5 5.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CaretDownIcon({ className, size = 12 }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M1.3 4h21.4c1.1 0 1.7 1.2 1 2.1L13 19.5a1.3 1.3 0 0 1-2 0L.3 6.1C-.4 5.2.2 4 1.3 4Z"
        fill="currentColor"
      />
    </svg>
  );
}
