import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { cn } from "../../lib/cn";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-card border border-dashed border-line-strong bg-surface/40 text-center",
        compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14",
        className,
      )}
    >
      {icon ? (
        <span className="grid h-11 w-11 place-items-center rounded-full bg-raised text-fg-subtle [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </span>
      ) : null}
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? (
          <p className="text-xs leading-relaxed text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

export function ProgressBar({
  value,
  label,
  tone = "brand",
  className,
}: {
  value: number;
  label?: string;
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const fill = {
    brand: "bg-brand",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>{label}</span>
          <span className="tabular">{Math.round(clamped)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", fill)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

type AlertTone = "info" | "warning" | "danger" | "success";

const ALERT_ICON: Record<AlertTone, ReactNode> = {
  info: <Info className="h-4 w-4" />,
  warning: <ShieldAlert className="h-4 w-4" />,
  danger: <AlertTriangle className="h-4 w-4" />,
  success: <CheckCircle2 className="h-4 w-4" />,
};

const ALERT_STYLE: Record<AlertTone, string> = {
  info: "border-info/25 bg-info/5 text-info",
  warning: "border-warning/25 bg-warning/5 text-warning",
  danger: "border-danger/25 bg-danger/5 text-danger",
  success: "border-success/25 bg-success/5 text-success",
};

export function InlineAlert({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-3 py-2.5",
        ALERT_STYLE[tone],
        className,
      )}
    >
      <span className="mt-0.5 shrink-0" aria-hidden>
        {ALERT_ICON[tone]}
      </span>
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        {title ? <p className="font-semibold text-fg">{title}</p> : null}
        {children ? <div className="text-fg-muted">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
