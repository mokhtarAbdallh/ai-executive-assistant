import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, MessageSquare, Search } from "lucide-react";
import type { TranscriptSegment } from "../../types";
import { clockFromSeconds } from "../../lib/format";
import { Avatar } from "../Avatar";
import { EmptyState, IconButton, Input, useToast } from "../ui";
import { cn } from "../../lib/cn";

interface TranscriptTabProps {
  segments: TranscriptSegment[];
  focusSegmentId: string | null;
  onFocusHandled: () => void;
}

export function TranscriptTab({ segments, focusSegmentId, onFocusHandled }: TranscriptTabProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return segments;
    return segments.filter(
      (segment) =>
        segment.text.toLowerCase().includes(term) ||
        (segment.speakerLabel ?? "").toLowerCase().includes(term),
    );
  }, [segments, query]);

  useEffect(() => {
    if (!focusSegmentId) return;
    const element = document.getElementById(`segment-${focusSegmentId}`);
    if (element) element.scrollIntoView({ behavior: "smooth", block: "center" });
    setActiveId(focusSegmentId);
    onFocusHandled();
  }, [focusSegmentId, onFocusHandled]);

  const copySegment = async (segment: TranscriptSegment) => {
    const speaker = segment.speakerLabel ?? t("meeting.transcript.unknownSpeaker");
    try {
      await navigator.clipboard.writeText(
        `[${clockFromSeconds(segment.startMs / 1000)}] ${speaker}: ${segment.text}`,
      );
      toast({ title: t("common.copied"), tone: "success" });
    } catch {
      toast({ title: t("common.copyFailed"), tone: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("meeting.transcript.searchPlaceholder")}
            aria-label={t("meeting.transcript.searchPlaceholder")}
            className="ps-9"
          />
        </div>
        <p className="text-xs text-fg-subtle">
          {t("meeting.transcript.count", {
            shown: filtered.length,
            total: segments.length,
          })}
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title={t("meeting.transcript.emptyTitle")}
          description={t("meeting.transcript.emptyBody")}
        />
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((segment) => {
            const active = activeId === segment.id;
            return (
              <li
                key={segment.id}
                id={`segment-${segment.id}`}
                className={cn(
                  "group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                  active
                    ? "border-brand/40 bg-brand/[0.06]"
                    : "border-transparent hover:border-line hover:bg-raised/40",
                )}
              >
                <Avatar
                  name={segment.speakerLabel ?? t("meeting.transcript.unknownSpeaker")}
                  size="sm"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-fg" dir="auto">
                      {segment.speakerLabel ?? t("meeting.transcript.unknownSpeaker")}
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveId(segment.id)}
                      className="rounded px-1 text-[11px] tabular text-fg-subtle transition-colors hover:bg-raised hover:text-brand"
                      title={t("meeting.transcript.jumpHint")}
                    >
                      {clockFromSeconds(segment.startMs / 1000)}
                    </button>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-fg" dir="auto">
                    {segment.text}
                  </p>
                </div>

                <IconButton
                  label={t("common.copy")}
                  icon={<Copy className="h-3.5 w-3.5" />}
                  size="icon-sm"
                  className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => copySegment(segment)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
