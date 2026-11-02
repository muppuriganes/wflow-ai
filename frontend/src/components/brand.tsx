export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--color-primary)" />
      <path d="M7 10l3.5 12L16 12l5.5 10L25 10" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-tight">WFlow AI</span>
    </span>
  );
}
