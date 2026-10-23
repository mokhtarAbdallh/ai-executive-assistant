import { cn } from "../lib/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex select-none items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 36 36"
        fill="none"
        role="img"
        aria-label="Dawwen"
        className="h-8 w-8 shrink-0 text-brand"
      >
        <rect width="36" height="36" rx="9" fill="currentColor" fillOpacity="0.14" />
        <path
          d="M10 24C12 20 16 14 26 12M12 26C15 25 21 24 26 17"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <circle cx="26" cy="12" r="2.4" fill="currentColor" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className="text-lg font-semibold tracking-tight text-fg">دوّن</span>
        <span className="mt-1 text-xs font-medium uppercase tracking-[0.16em] text-fg-subtle">
          Dawwen
        </span>
      </div>
    </div>
  );
}
