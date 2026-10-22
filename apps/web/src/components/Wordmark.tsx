export function Wordmark({ className = "h-8" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-auto aspect-square text-cyan-400"
      >
        <rect width="36" height="36" rx="10" fill="currentColor" fillOpacity="0.15" />
        <path
          d="M10 24C12 20 16 14 26 12M12 26C15 25 21 24 26 17"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="26" cy="12" r="2.5" fill="currentColor" />
      </svg>
      <div className="flex flex-col leading-none">
        <span className="text-xl font-bold tracking-tight text-white font-sans">دوّن</span>
        <span className="text-[10px] font-semibold text-cyan-400 tracking-wider uppercase">Dawwen</span>
      </div>
    </div>
  );
}
