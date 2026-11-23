export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.25" y="1.25" width="29.5" height="29.5" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="3.25" fill="currentColor" />
      <path
        d="M16 6.5v3.25M16 22.25V25.5M6.5 16h3.25M22.25 16H25.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
