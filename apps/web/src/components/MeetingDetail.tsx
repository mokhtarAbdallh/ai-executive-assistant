import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  History,
  Inbox,
  Mail,
  MessageSquare,
  Pencil,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Decision, MeetingDetail as MeetingDetailType, Task } from "../types";
import { approveAllMeetingItems, deleteMeeting, updateDecision, updateMeeting } from "../api";
import { clockFromSeconds, formatDate } from "../lib/format";
import { Avatar } from "./Avatar";
import { AskChat } from "./AskChat";
import { FollowUpTab } from "./FollowUpTab";
import { MeetingStatusBadge } from "./StatusBadges";
import { SummaryTab } from "./meeting/SummaryTab";
import { TasksTab } from "./meeting/TasksTab";
import { ProposalsTab } from "./meeting/ProposalsTab";
import { TranscriptTab } from "./meeting/TranscriptTab";
import {
  Button,
  Card,
  ConfirmDialog,
  IconButton,
  Input,
  ProgressBar,
  Tabs,
  useToast,
  type TabItem,
} from "./ui";

export type MeetingTab = "summary" | "tasks" | "proposals" | "followup" | "transcript" | "ask";

interface MeetingDetailProps {
  meeting: MeetingDetailType;
  onBack: () => void;
  onMeetingUpdated: (updated: MeetingDetailType) => void;
  initialTab?: MeetingTab;
}

export function MeetingDetail({
  meeting: initialMeeting,
  onBack,
  onMeetingUpdated,
  initialTab = "summary",
}: MeetingDetailProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { toast } = useToast();

  const [meeting, setMeeting] = useState(initialMeeting);
  const [tab, setTab] = useState<MeetingTab>(initialTab);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialMeeting.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [approvingAll, setApprovingAll] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [focusSegmentId, setFocusSegmentId] = useState<string | null>(null);

  useEffect(() => {
    setMeeting(initialMeeting);
    setTitleDraft(initialMeeting.title);
  }, [initialMeeting]);

  const pendingTasks = meeting.tasks.filter((task) => !task.approved).length;
  const pendingDecisions = meeting.decisions.filter((decision) => !decision.approved).length;
  const pendingTotal = pendingTasks + pendingDecisions;
  const approvedTotal = meeting.tasks.length + meeting.decisions.length - pendingTotal;
  const totalApprovable = meeting.tasks.length + meeting.decisions.length;

  const tabs: TabItem[] = useMemo(
    () => [
      { id: "summary", label: t("meeting.tabs.summary"), icon: <FileText /> },
      {
        id: "tasks",
        label: t("meeting.tabs.tasks"),
        icon: <CheckSquare />,
        count: meeting.tasks.length,
      },
      {
        id: "proposals",
        label: t("meeting.tabs.proposals"),
        icon: <Inbox />,
        count: meeting.proposals.length,
      },
      { id: "followup", label: t("meeting.tabs.followup"), icon: <Mail /> },
      { id: "transcript", label: t("meeting.tabs.transcript"), icon: <MessageSquare /> },
      { id: "ask", label: t("meeting.tabs.ask"), icon: <Sparkles /> },
    ],
    [t, meeting.tasks.length, meeting.proposals.length],
  );

  const sync = (next: MeetingDetailType) => {
    setMeeting(next);
    onMeetingUpdated(next);
  };

  const patchTasks = (tasks: Task[]) => sync({ ...meeting, tasks });
  const patchDecisions = (decisions: Decision[]) => sync({ ...meeting, decisions });

  const handleApproveAll = async () => {
    setApprovingAll(true);
    try {
      await approveAllMeetingItems(meeting.id);
      sync({
        ...meeting,
        status: "APPROVED",
        tasks: meeting.tasks.map((task) => ({ ...task, approved: true })),
        decisions: meeting.decisions.map((decision) => ({ ...decision, approved: true })),
      });
      toast({ title: t("meeting.approveAllSuccess"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setApprovingAll(false);
    }
  };

  const handleSaveTitle = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle || nextTitle === meeting.title) {
      setIsEditingTitle(false);
      setTitleDraft(meeting.title);
      return;
    }
    setSavingTitle(true);
    try {
      await updateMeeting(meeting.id, { title: nextTitle });
      sync({ ...meeting, title: nextTitle });
      setIsEditingTitle(false);
      toast({ title: t("meeting.titleSaved"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setSavingTitle(false);
    }
  };

  const handleCopySummary = async () => {
    const parts = [
      meeting.analysis?.tldr ?? "",
      meeting.analysis?.purpose
        ? `${t("meeting.summary.purpose")}: ${meeting.analysis.purpose}`
        : "",
      ...meeting.decisions.map((decision) => `• ${decision.text}`),
      ...meeting.tasks.map(
        (task) => `• ${task.title}${task.ownerName ? ` — ${task.ownerName}` : ""}`,
      ),
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      toast({ title: t("meeting.copied"), tone: "success" });
    } catch {
      toast({ title: t("common.copyFailed"), tone: "error" });
    }
  };

  const jumpToSource = (ts: string) => {
    const target = meeting.transcriptSegments.find(
      (segment) => clockFromSeconds(segment.startMs / 1000) === ts,
    );
    setTab("transcript");
    if (target) setFocusSegmentId(target.id);
  };

  const handleDecisionApprove = async (decision: Decision) => {
    try {
      await updateDecision(meeting.id, decision.id, { approved: !decision.approved });
      patchDecisions(
        meeting.decisions.map((item) =>
          item.id === decision.id ? { ...item, approved: !item.approved } : item,
        ),
      );
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteMeeting(meeting.id);
      toast({ title: t("meeting.deleted"), tone: "success" });
      onBack();
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
      setDeleting(false);
    }
  };

  const languageLabel =
    meeting.language === "mixed"
      ? t("meeting.langMixed")
      : meeting.language === "en"
        ? t("language.english")
        : t("language.arabic");

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
      >
        {i18n.dir() === "rtl" ? (
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
        )}
        {t("meeting.backToMeetings")}
      </button>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  aria-label={t("meeting.editTitle")}
                  dir="auto"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleSaveTitle();
                    if (event.key === "Escape") {
                      setIsEditingTitle(false);
                      setTitleDraft(meeting.title);
                    }
                  }}
                />
                <Button size="sm" variant="primary" loading={savingTitle} onClick={handleSaveTitle}>
                  {t("common.save")}
                </Button>
                <IconButton
                  label={t("common.cancel")}
                  icon={<X className="h-4 w-4" />}
                  onClick={() => {
                    setIsEditingTitle(false);
                    setTitleDraft(meeting.title);
                  }}
                />
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <h1 className="text-xl font-semibold leading-snug sm:text-2xl" dir="auto">
                  {meeting.title}
                </h1>
                <IconButton
                  label={t("meeting.editTitle")}
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  size="icon-sm"
                  className="mt-1"
                  onClick={() => setIsEditingTitle(true)}
                />
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-muted">
              <MeetingStatusBadge status={meeting.status} />
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                <span className="tabular">
                  {formatDate(meeting.scheduledStart ?? meeting.createdAt, lang)}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock3 aria-hidden className="h-3.5 w-3.5" />
                <span className="tabular">{clockFromSeconds(meeting.audioDurationSeconds)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden className="h-3.5 w-3.5" />
                {languageLabel}
              </span>
              {meeting.participants.length > 0 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="flex -space-x-1.5 space-x-reverse">
                    {meeting.participants.slice(0, 3).map((participant) => (
                      <Avatar key={participant.id} name={participant.name} size="sm" />
                    ))}
                  </span>
                  <span>
                    {t("meeting.participantCount", { count: meeting.participants.length })}
                  </span>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <IconButton
              label={t("meeting.copySummary")}
              icon={<Copy className="h-4 w-4" />}
              onClick={handleCopySummary}
            />
            <IconButton
              label={t("meeting.deleteMeeting")}
              icon={<Trash2 className="h-4 w-4" />}
              onClick={() => setDeleteOpen(true)}
            />
          </div>
        </div>
      </header>

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(next) => setTab(next as MeetingTab)}
        ariaLabel={t("meeting.tabs.label")}
      />

      <div key={tab} className="animate-fade-up">
        {tab === "summary" ? (
          <SummaryTab
            meeting={meeting}
            onJumpToSource={jumpToSource}
            onApproveDecision={handleDecisionApprove}
          />
        ) : null}

        {tab === "tasks" ? (
          <TasksTab
            meetingId={meeting.id}
            tasks={meeting.tasks}
            onTasksChange={patchTasks}
            onJumpToSource={jumpToSource}
            onApprovedAll={() =>
              sync({
                ...meeting,
                tasks: meeting.tasks.map((task) => ({ ...task, approved: true })),
              })
            }
          />
        ) : null}

        {tab === "proposals" ? (
          <ProposalsTab
            proposals={meeting.proposals}
            onProposalsChange={(proposals) => sync({ ...meeting, proposals })}
          />
        ) : null}

        {tab === "followup" ? (
          <FollowUpTab
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            onProposalCreated={(proposal) =>
              sync({ ...meeting, proposals: [proposal, ...meeting.proposals] })
            }
          />
        ) : null}

        {tab === "transcript" ? (
          <TranscriptTab
            segments={meeting.transcriptSegments}
            focusSegmentId={focusSegmentId}
            onFocusHandled={() => setFocusSegmentId(null)}
          />
        ) : null}

        {tab === "ask" ? (
          <AskChat
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            onCitationClick={(citation) => {
              setTab("transcript");
              if (citation.segmentId) setFocusSegmentId(citation.segmentId);
            }}
          />
        ) : null}
      </div>

      {pendingTotal > 0 && tab !== "ask" ? (
        <div className="sticky bottom-20 z-10 lg:bottom-4">
          <Card className="flex flex-col gap-3 border-warning/30 bg-surface/95 p-3 shadow-pop backdrop-blur sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <ShieldCheck aria-hidden className="h-4 w-4 text-warning" />
                {t("meeting.reviewBar", { count: pendingTotal })}
              </p>
              {totalApprovable > 0 ? (
                <ProgressBar
                  value={(approvedTotal / totalApprovable) * 100}
                  tone={pendingTotal === 0 ? "success" : "warning"}
                  className="max-w-xs"
                />
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setTab("summary")}>
                {t("meeting.reviewNow")}
              </Button>
              <Button variant="primary" size="sm" loading={approvingAll} onClick={handleApproveAll}>
                {t("meeting.approveAll")}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}

      <details className="group rounded-card border border-line bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
          <span className="inline-flex items-center gap-2">
            <History aria-hidden className="h-4 w-4" />
            {t("meeting.history.title")}
            <span className="text-xs text-fg-subtle">
              {t("meeting.history.count", { count: meeting.editHistories.length })}
            </span>
          </span>
          <ChevronDown aria-hidden className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-line px-4 py-3">
          {meeting.editHistories.length === 0 ? (
            <p className="text-xs text-fg-subtle">{t("meeting.history.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {meeting.editHistories.slice(0, 8).map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-2 text-xs text-fg-muted"
                >
                  <span className="rounded-md bg-raised px-1.5 py-0.5 font-medium text-fg-muted">
                    {entry.entityType}
                  </span>
                  <span className="tabular text-fg-subtle">
                    {formatDate(entry.createdAt, lang, "short")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <ConfirmDialog
        open={deleteOpen}
        title={t("meeting.deleteTitle")}
        description={t("meeting.deleteBody", { title: meeting.title })}
        confirmLabel={t("common.delete")}
        loading={deleting}
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
