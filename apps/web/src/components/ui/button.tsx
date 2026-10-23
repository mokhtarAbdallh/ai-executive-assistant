import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "soft" | "danger";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const BASE =
  "inline-flex select-none items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.985]";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-fg shadow-[0_10px_24px_-14px_var(--color-brand)] hover:bg-brand-hover",
  secondary: "border border-line bg-surface text-fg hover:border-line-strong hover:bg-raised",
  ghost: "text-fg-muted hover:bg-raised hover:text-fg",
  soft: "bg-brand/10 text-brand hover:bg-brand/15",
  danger: "border border-danger/25 bg-danger/10 text-danger hover:bg-danger/15",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
  icon: "h-9 w-9",
  "icon-sm": "h-8 w-8",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconEnd?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = "secondary",
    size = "md",
    loading = false,
    icon,
    iconEnd,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : icon}
      {children}
      {!loading && iconEnd}
    </button>
  );
});

interface IconButtonProps extends Omit<ButtonProps, "children" | "icon" | "iconEnd" | "size"> {
  /** Accessible name — required because these buttons have no visible text. */
  label: string;
  icon: ReactNode;
  size?: "icon" | "icon-sm";
}

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "icon",
  ...props
}: IconButtonProps) {
  return (
    <Button aria-label={label} title={label} variant={variant} size={size} icon={icon} {...props} />
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 aria-hidden className={cn("h-4 w-4 animate-spin text-fg-muted", className)} />;
}
