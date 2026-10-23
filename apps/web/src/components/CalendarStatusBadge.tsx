import { useTranslation } from "react-i18next";
import type { CalendarEventItem } from "../types";
import { Badge, type BadgeTone } from "./ui";

const TONE: Record<CalendarEventItem["status"], BadgeTone> = {
  scheduled: "brand",
  summarized: "success",
  processing: "info",
  needs_review: "warning",
};

export function CalendarStatusBadge({ status }: { status: CalendarEventItem["status"] }) {
  const { t } = useTranslation();
  return (
    <Badge tone={TONE[status]} dot>
      {t(`calendar.status.${status}`)}
    </Badge>
  );
}
