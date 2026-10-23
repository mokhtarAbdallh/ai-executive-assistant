import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line-strong bg-raised text-fg-muted",
  brand: "border-brand/25 bg-brand/10 text-brand",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
  info: "border-info/25 bg-info/10 text-info",
};

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-fg-subtle",
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  icon?: ReactNode;
  dot?: boolean;
  className?: string;
  title?: string;
}

export function Badge({
  tone = "neutral",
  children,
  icon,
  dot = false,
  className,
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium leading-5",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} /> : null}
      {icon}
      {children}
    </span>
  );
}

export function CountBadge({ count, tone = "brand" }: { count: number; tone?: BadgeTone }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular",
        tone === "brand" && "bg-brand text-brand-fg",
        tone === "danger" && "bg-danger text-white",
        tone === "neutral" && "bg-raised text-fg-muted",
      )}
    >
      {count}
    </span>
  );
}
