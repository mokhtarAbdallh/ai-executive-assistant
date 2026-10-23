import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";

export type ToastTone = "success" | "error" | "info" | "warning";

interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
}

interface ToastItem extends Required<Omit<ToastInput, "description">> {
  id: number;
  description?: string;
}

interface ToastApi {
  toast: (input: ToastInput | string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: ReactNode; ring: string }> = {
  success: { icon: <CheckCircle2 className="h-4 w-4" />, ring: "text-success" },
  error: { icon: <XCircle className="h-4 w-4" />, ring: "text-danger" },
  warning: { icon: <AlertTriangle className="h-4 w-4" />, ring: "text-warning" },
  info: { icon: <Info className="h-4 w-4" />, ring: "text-info" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: ToastInput | string) => {
      const normalized: ToastInput = typeof input === "string" ? { title: input } : input;
      counter.current += 1;
      const id = counter.current;
      setItems((current) => [
        ...current.slice(-3),
        {
          id,
          title: normalized.title,
          description: normalized.description,
          tone: normalized.tone ?? "info",
        },
      ]);
      const timer = window.setTimeout(() => dismiss(id), 4800);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const api = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-6 sm:end-6 sm:items-end"
        >
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { t } = useTranslation();
  const tone = TONE_STYLES[item.tone];

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-pop animate-pop",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", tone.ring)} aria-hidden>
        {tone.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{item.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("common.dismiss")}
        className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-raised hover:text-fg"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
