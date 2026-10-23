import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

const CONTROL =
  "w-full rounded-xl border border-line bg-surface text-sm text-fg shadow-[0_1px_0_0_rgb(255_255_255_/_0.02)_inset] transition-colors placeholder:text-fg-subtle hover:border-line-strong focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:opacity-60";

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1 text-xs font-medium text-fg-muted"
      >
        {label}
        {required ? <span className="text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-relaxed text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-10 px-3", className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(CONTROL, "resize-y px-3 py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(CONTROL, "h-10 appearance-none ps-3 pe-9", className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
        />
      </div>
    );
  },
);

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  description?: ReactNode;
  tone?: "default" | "danger";
}

export function Checkbox({
  label,
  description,
  tone = "default",
  className,
  id,
  ...props
}: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
        tone === "danger"
          ? "border-danger/30 bg-danger/5 hover:bg-danger/10"
          : "border-line bg-raised/40 hover:border-line-strong",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong accent-brand"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
