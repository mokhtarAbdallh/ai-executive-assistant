import { Clock3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";

/**
 * Every AI-extracted decision/task carries a source timestamp.
 * The chip sits inline with the item meta so it is never orphaned
 * on the far side of the card.
 */
export function SourceChip({
  ts,
  onJump,
  className,
}: {
  ts: string | null | undefined;
  onJump?: (ts: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!ts) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[11px] text-fg-subtle",
          className,
        )}
      >
        {t("meeting.noSource")}
      </span>
    );
  }

  const content = (
    <>
      <Clock3 aria-hidden className="h-3 w-3" />
      <span className="tabular">{ts}</span>
    </>
  );

  if (!onJump) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-0.5 text-[11px] font-medium text-fg-muted",
          className,
        )}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onJump(ts)}
      title={t("meeting.jumpToSource", { time: ts })}
      aria-label={t("meeting.jumpToSource", { time: ts })}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-[11px] font-medium text-brand transition-colors hover:bg-brand/20",
        className,
      )}
    >
      {content}
    </button>
  );
}
