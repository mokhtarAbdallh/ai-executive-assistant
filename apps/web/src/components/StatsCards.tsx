import { useTranslation } from "react-i18next";
import { CalendarCheck2, CheckSquare, Clock3, ListChecks } from "lucide-react";
import type { MeetingSummary } from "../types";
import { Card } from "./ui";
import { clockFromSeconds, formatNumber } from "../lib/format";

interface StatsCardsProps {
  meetings: MeetingSummary[];
}

export function StatsCards({ meetings }: StatsCardsProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const total = meetings.length;
  const pendingReview = meetings.filter((meeting) =>
    ["UPLOADED", "QUEUED", "TRANSCRIBING", "ANALYZING", "REVIEW_PENDING"].includes(meeting.status),
  ).length;
  const approved = meetings.filter((meeting) => meeting.status === "APPROVED").length;
  const decisions = meetings.reduce((sum, meeting) => sum + (meeting._count?.decisions ?? 0), 0);
  const tasks = meetings.reduce((sum, meeting) => sum + (meeting._count?.tasks ?? 0), 0);
  const recordedSeconds = meetings.reduce(
    (sum, meeting) => sum + (meeting.audioDurationSeconds ?? 0),
    0,
  );

  const items = [
    {
      key: "meetings",
      icon: <CalendarCheck2 />,
      label: t("stats.meetings"),
      value: formatNumber(total, lang),
      hint: t("stats.meetingsHint", { approved: formatNumber(approved, lang) }),
      tone: "text-brand bg-brand/10",
    },
    {
      key: "review",
      icon: <Clock3 />,
      label: t("stats.needsReview"),
      value: formatNumber(pendingReview, lang),
      hint: t("stats.needsReviewHint"),
      tone: "text-warning bg-warning/10",
    },
    {
      key: "decisions",
      icon: <ListChecks />,
      label: t("stats.decisions"),
      value: formatNumber(decisions, lang),
      hint: t("stats.decisionsHint"),
      tone: "text-info bg-info/10",
    },
    {
      key: "tasks",
      icon: <CheckSquare />,
      label: t("stats.tasks"),
      value: formatNumber(tasks, lang),
      hint: t("stats.tasksHint", { duration: clockFromSeconds(recordedSeconds) }),
      tone: "text-success bg-success/10",
    },
  ];

  return (
    <section aria-label={t("stats.sectionLabel")} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.key} className="p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-fg-muted">{item.label}</p>
            <span
              aria-hidden
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${item.tone} [&>svg]:h-4 [&>svg]:w-4`}
            >
              {item.icon}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular text-fg">{item.value}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">{item.hint}</p>
        </Card>
      ))}
    </section>
  );
}
