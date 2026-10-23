import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";
import { IconButton } from "./button";

type Placement = "center" | "end" | "bottom";

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
} as const;

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  placement?: Placement;
  size?: keyof typeof SIZES;
  hideClose?: boolean;
  dismissible?: boolean;
  className?: string;
  bodyClassName?: string;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  placement = "center",
  size = "md",
  hideClose = false,
  dismissible = true,
  className,
  bodyClassName,
}: ModalProps) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), 180);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Lock page scroll while a dialog is on screen.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Move focus in, trap it, and restore it on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }, 30);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose, dismissible]);

  if (!mounted) return null;

  const placementClasses =
    placement === "bottom"
      ? "items-end justify-center p-0 sm:p-4"
      : placement === "end"
        ? "items-stretch justify-end p-0"
        : "items-center justify-center p-4";

  const panelClasses =
    placement === "bottom"
      ? "w-full max-w-none rounded-t-2xl border-x-0 border-b-0 sm:max-w-lg sm:rounded-card sm:border"
      : placement === "end"
        ? "ms-auto h-full w-full max-w-md rounded-none border-y-0 border-e-0"
        : "w-full rounded-panel border";

  const motionClasses =
    placement === "center"
      ? open
        ? "scale-100 opacity-100"
        : "scale-[0.97] opacity-0"
      : open
        ? "translate-y-0 translate-x-0 opacity-100"
        : placement === "bottom"
          ? "translate-y-6 opacity-0"
          : "translate-x-6 opacity-0";

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={dismissible ? onClose : undefined}
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div className={cn("absolute inset-0 flex overflow-y-auto", placementClasses)}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cn(
            "relative flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden border-line bg-surface shadow-pop outline-none transition-all duration-200",
            panelClasses,
            placement === "end" ? "my-0" : "",
            SIZES[size],
            motionClasses,
            placement === "end" && "max-w-md",
            className,
          )}
        >
          {title ? (
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-base font-semibold text-fg">
                  {title}
                </h2>
                {description ? (
                  <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-fg-muted">
                    {description}
                  </p>
                ) : null}
              </div>
              {hideClose ? null : (
                <IconButton
                  label={t("common.close")}
                  icon={<X className="h-4 w-4" />}
                  onClick={onClose}
                />
              )}
            </div>
          ) : null}

          <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", bodyClassName)}>
            {children}
          </div>

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
