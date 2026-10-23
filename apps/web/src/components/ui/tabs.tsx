import { useCallback, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/cn";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  alert?: boolean;
}

interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  className?: string;
}

export function Tabs({ tabs, value, onChange, ariaLabel, className }: TabsProps) {
  const { i18n } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  const isRtl = i18n.dir() === "rtl";

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const forward = isRtl ? "ArrowLeft" : "ArrowRight";
      const backward = isRtl ? "ArrowRight" : "ArrowLeft";
      if (![forward, backward, "Home", "End"].includes(event.key)) return;
      event.preventDefault();

      const index = tabs.findIndex((tab) => tab.id === value);
      let next = index;
      if (event.key === forward) next = (index + 1) % tabs.length;
      else if (event.key === backward) next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else next = tabs.length - 1;

      onChange(tabs[next].id);
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      buttons?.[next]?.focus();
    },
    [tabs, value, onChange, isRtl],
  );

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        "hide-scrollbar flex items-center gap-1 overflow-x-auto rounded-xl border border-line bg-raised/50 p-1",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            data-tab={tab.id}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150 sm:text-[13px]",
              active
                ? "bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,0.25)] ring-1 ring-line"
                : "text-fg-muted hover:bg-surface/60 hover:text-fg",
            )}
          >
            {tab.icon ? (
              <span aria-hidden className="[&>svg]:h-4 [&>svg]:w-4">
                {tab.icon}
              </span>
            ) : null}
            <span className="whitespace-nowrap">{tab.label}</span>
            {typeof tab.count === "number" && tab.count > 0 ? (
              <span
                className={cn(
                  "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular",
                  active ? "bg-brand/15 text-brand" : "bg-line text-fg-muted",
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {tab.alert ? (
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse-soft"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "hide-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-raised text-fg" : "text-fg-muted hover:text-fg",
            )}
          >
            {option.label}
            {typeof option.count === "number" && option.count > 0 ? (
              <span className="tabular text-[11px] text-fg-subtle">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
