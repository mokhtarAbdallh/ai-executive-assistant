import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ChevronLeft,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { MeetingSummary } from "../types";
import { StatsCards } from "./StatsCards";
import { MeetingStatusBadge } from "./StatusBadges";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Segmented,
  Skeleton,
  useToast,
} from "./ui";
import { clockFromSeconds, formatDate, formatNumber } from "../lib/format";
import { cn } from "../lib/cn";

type StatusFilter = "ALL" | "review" | "approved" | "processing" | "failed";

interface MeetingsListProps {
  meetings: MeetingSummary[];
  isLoading: boolean;
  error: string | null;
  pendingProposals?: number;
  onSelectMeeting: (id: string) => void;
  onDeleteMeeting: (id: string) => void;
  onNewMeetingClick: () => void;
  onLoadDemoClick: () => void;
  onRetry: () => void;
  onOpenProposals?: () => void;
  demoLoading?: boolean;
}

function matchesFilter(meeting: MeetingSummary, filter: StatusFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "review") return meeting.status === "REVIEW_PENDING";
  if (filter === "approved") return meeting.status === "APPROVED";
  if (filter === "failed") return meeting.status === "FAILED";
  return ["UPLOADED", "QUEUED", "TRANSCRIBING", "ANALYZING"].includes(meeting.status);
}

export function MeetingsList({
  meetings,
  isLoading,
  error,
  pendingProposals = 0,
  onSelectMeeting,
  onDeleteMeeting,
  onNewMeetingClick,
  onLoadDemoClick,
  onRetry,
  onOpenProposals,
  demoLoading = false,
}: MeetingsListProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { toast } = useToast();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [pendingDelete, setPendingDelete] = useState<MeetingSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return meetings
      .filter((meeting) => matchesFilter(meeting, statusFilter))
      .filter((meeting) => (term ? meeting.title.toLowerCase().includes(term) : true))
      .sort((a, b) => {
        const aTime = new Date(a.scheduledStart ?? a.createdAt).getTime();
        const bTime = new Date(b.scheduledStart ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }, [meetings, searchTerm, statusFilter]);

  const filters: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: t("meetings.filterAll") },
    { value: "review", label: t("meetings.filterReview") },
    { value: "approved", label: t("meetings.filterApproved") },
    { value: "processing", label: t("meetings.filterProcessing") },
  ];

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await Promise.resolve(onDeleteMeeting(pendingDelete.id));
      toast({ title: t("meetings.deleted"), tone: "success" });
      setPendingDelete(null);
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("meetings.title")}</h1>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted sm:text-sm">
          {t("meetings.subtitle")}
        </p>
      </header>

      <StatsCards meetings={meetings} />

      {pendingProposals > 0 ? (
        <Card className="flex flex-col gap-3 border-warning/25 bg-warning/[0.04] p-4 sm:flex-row sm:items-center">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warning/15 text-warning"
          >
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">
              {t("dashboard.pendingTitle", { count: pendingProposals })}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">{t("dashboard.pendingBody")}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onOpenProposals}>
            {t("dashboard.pendingCta")}
          </Button>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
            />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t("meetings.searchPlaceholder")}
              aria-label={t("meetings.searchPlaceholder")}
              className="ps-9"
            />
          </div>

          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <Segmented
              options={filters}
              value={statusFilter}
              onChange={setStatusFilter}
              ariaLabel={t("meetings.filterLabel")}
            />
            <span className="hidden whitespace-nowrap text-xs text-fg-subtle sm:inline">
              {t("meetings.resultCount", { value: formatNumber(filtered.length, lang) })}
            </span>
          </div>
        </div>

        {isLoading ? (
          <div className="divide-y divide-line">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-3 px-4 py-4">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="flex flex-col items-start gap-3 rounded-xl border border-danger/25 bg-danger/5 p-4 sm:flex-row sm:items-center">
              <AlertCircle aria-hidden className="h-5 w-5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{t("meetings.errorTitle")}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{t("meetings.errorBody")}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  {t("common.retry")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={onLoadDemoClick}
                  loading={demoLoading}
                  icon={<Sparkles className="h-4 w-4" />}
                >
                  {t("dashboard.loadDemo")}
                </Button>
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<Search />}
              title={
                meetings.length === 0 ? t("meetings.emptyTitle") : t("meetings.noMatchesTitle")
              }
              description={
                meetings.length === 0 ? t("meetings.emptyBody") : t("meetings.noMatchesBody")
              }
              action={
                meetings.length === 0 ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      variant="primary"
                      icon={<Plus className="h-4 w-4" />}
                      onClick={onNewMeetingClick}
                    >
                      {t("nav.newMeeting")}
                    </Button>
                    <Button
                      variant="secondary"
                      icon={<Sparkles className="h-4 w-4" />}
                      onClick={onLoadDemoClick}
                      loading={demoLoading}
                    >
                      {t("dashboard.loadDemo")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm("");
                      setStatusFilter("ALL");
                    }}
                  >
                    {t("common.clearFilters")}
                  </Button>
                )
              }
              className="border-0 bg-transparent"
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((meeting) => {
              const when = meeting.scheduledStart ?? meeting.createdAt;
              return (
                <li
                  key={meeting.id}
                  data-meeting-card
                  className="group relative transition-colors hover:bg-raised/40 focus-within:bg-raised/40"
                >
                  <button
                    type="button"
                    onClick={() => onSelectMeeting(meeting.id)}
                    aria-label={t("meetings.openMeeting", { title: meeting.title })}
                    className="absolute inset-0 z-0 rounded-none"
                  />

                  <div className="pointer-events-none flex items-start gap-3 py-3.5 pe-20 ps-4">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                        meeting.status === "APPROVED"
                          ? "bg-success/10 text-success"
                          : meeting.status === "FAILED"
                            ? "bg-danger/10 text-danger"
                            : "bg-brand/10 text-brand",
                      )}
                    >
                      {meeting.status === "ANALYZING" || meeting.status === "TRANSCRIBING" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <MeetingGlyph />
                      )}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          className="min-w-0 truncate text-sm font-medium text-fg"
                          dir="auto"
                          title={meeting.title}
                        >
                          {meeting.title}
                        </h3>
                        <MeetingStatusBadge status={meeting.status} />
                      </div>

                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
                        <span className="tabular">{formatDate(when, lang)}</span>
                        {meeting.audioDurationSeconds ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="tabular">
                              {clockFromSeconds(meeting.audioDurationSeconds)}
                            </span>
                          </>
                        ) : null}
                        <span aria-hidden>·</span>
                        <span className="tabular">
                          {t("meetings.metaTasks", { count: meeting._count?.tasks ?? 0 })}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="tabular">
                          {t("meetings.metaDecisions", { count: meeting._count?.decisions ?? 0 })}
                        </span>
                      </p>
                    </div>
                  </div>

                  <div className="absolute end-3 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1">
                    <IconButton
                      label={t("meetings.deleteMeeting")}
                      icon={<Trash2 className="h-4 w-4" />}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => setPendingDelete(meeting)}
                    />
                    <ChevronLeft
                      aria-hidden
                      className="hidden h-4 w-4 text-fg-subtle sm:block ltr:rotate-180"
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("meetings.deleteTitle")}
        description={t("meetings.deleteBody", { title: pendingDelete?.title ?? "" })}
        confirmLabel={t("common.delete")}
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function MeetingGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4">
      <path
        d="M6 15.5c1.4-3 4.2-7 9.5-8M7.5 17c2-.7 5.6-1.6 8.5-5.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="16.6" cy="6.4" r="1.6" fill="currentColor" />
    </svg>
  );
}
