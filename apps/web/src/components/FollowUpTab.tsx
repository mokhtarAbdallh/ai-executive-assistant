import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Check,
  Clock3,
  Copy,
  Info,
  Mail,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";
import type { FollowUpDraft, Proposal, Reminder } from "../types";
import {
  cancelReminder,
  createDraft,
  createReminder,
  fetchDrafts,
  fetchReminders,
  proposeSendDraft,
} from "../api";
import { formatDateTime } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  Modal,
  Skeleton,
  Textarea,
  useToast,
} from "./ui";

interface FollowUpTabProps {
  meetingId: string;
  meetingTitle: string;
  onProposalCreated?: (proposal: Proposal) => void;
}

function tomorrow(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

export function FollowUpTab({ meetingId, meetingTitle, onProposalCreated }: FollowUpTabProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { toast } = useToast();

  const [drafts, setDrafts] = useState<FollowUpDraft[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [draftOpen, setDraftOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);

  const [draftForm, setDraftForm] = useState({
    recipientName: "",
    recipientEmail: "",
    subject: "",
    body: "",
  });
  const [reminderForm, setReminderForm] = useState({
    note: "",
    date: tomorrow(),
    time: "10:00",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [draftsResponse, remindersResponse] = await Promise.all([
        fetchDrafts(meetingId),
        fetchReminders(meetingId),
      ]);
      setDrafts(draftsResponse.drafts);
      setReminders(remindersResponse.reminders);
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [meetingId, t, toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openDraftModal = () => {
    setDraftForm({
      recipientName: "",
      recipientEmail: "",
      subject: t("followUp.draftDefaultSubject", { title: meetingTitle }),
      body: t("followUp.draftDefaultBody"),
    });
    setDraftOpen(true);
  };

  const openReminderModal = () => {
    setReminderForm({
      note: t("followUp.reminderDefaultNote"),
      date: tomorrow(),
      time: "10:00",
    });
    setReminderOpen(true);
  };

  const copyBody = async (draft: FollowUpDraft) => {
    try {
      await navigator.clipboard.writeText(draft.body);
      toast({ title: t("common.copied"), tone: "success" });
    } catch {
      toast({ title: t("common.copyFailed"), tone: "error" });
    }
  };

  const submitDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draftForm.body.trim()) return;
    setSavingDraft(true);
    try {
      const result = await createDraft({
        meetingId,
        recipientName: draftForm.recipientName.trim() || undefined,
        recipientEmail: draftForm.recipientEmail.trim() || undefined,
        subject: draftForm.subject.trim(),
        body: draftForm.body,
        channel: "email",
      });
      setDrafts((current) => [result.draft, ...current]);
      setDraftOpen(false);
      toast({ title: t("followUp.draftSaved"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setSavingDraft(false);
    }
  };

  const proposeSend = async (draft: FollowUpDraft) => {
    setBusyId(draft.id);
    try {
      const result = await proposeSendDraft(draft.id);
      onProposalCreated?.(result.proposal);
      toast({
        title: t("followUp.sendProposed"),
        description: t("followUp.sendProposedHint"),
        tone: "success",
      });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const submitReminder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reminderForm.note.trim()) return;
    setSavingReminder(true);
    try {
      const remindAt = new Date(`${reminderForm.date}T${reminderForm.time}:00Z`);
      const result = await createReminder({
        meetingId,
        note: reminderForm.note.trim(),
        remindAt: remindAt.toISOString(),
        channel: "console",
        proposeOnly: true,
      });

      if (result.proposal) {
        onProposalCreated?.(result.proposal);
        toast({ title: t("followUp.reminderProposed"), tone: "success" });
      } else if (result.reminder) {
        setReminders((current) => [...current, result.reminder as Reminder]);
        toast({ title: t("followUp.reminderCreated"), tone: "success" });
      }
      setReminderOpen(false);
      await loadData();
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setSavingReminder(false);
    }
  };

  const cancel = async (reminder: Reminder) => {
    setBusyId(reminder.id);
    try {
      await cancelReminder(reminder.id);
      setReminders((current) =>
        current.map((item) =>
          item.id === reminder.id ? { ...item, status: "CANCELLED" as const } : item,
        ),
      );
      toast({ title: t("followUp.reminderCancelled"), tone: "info" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-card" />
        <Skeleton className="h-40 rounded-card" />
        <Skeleton className="h-28 rounded-card" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InlineAlert tone="info" title={t("followUp.safetyTitle")}>
        {t("followUp.safetyBody")}
      </InlineAlert>

      <Card>
        <CardHeader
          icon={<Mail className="h-4 w-4" />}
          title={t("followUp.draftsTitle")}
          description={t("followUp.draftsHint")}
          action={
            <>
              <Badge tone="neutral">{drafts.length}</Badge>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={openDraftModal}
              >
                {t("followUp.newDraft")}
              </Button>
            </>
          }
        />
        <CardBody className="space-y-3">
          {drafts.length === 0 ? (
            <EmptyState
              compact
              icon={<Mail />}
              title={t("followUp.noDraftsTitle")}
              description={t("followUp.noDraftsBody")}
              className="border-0 bg-transparent"
            />
          ) : (
            drafts.map((draft) => {
              const sent = draft.status === "sent";
              return (
                <article
                  key={draft.id}
                  className="rounded-xl border border-line bg-raised/20 p-3.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-fg" dir="auto">
                          {draft.subject || t("followUp.untitledDraft")}
                        </h3>
                        <Badge tone={sent ? "success" : "brand"}>
                          {sent ? t("followUp.sent") : t("followUp.draft")}
                        </Badge>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                        {draft.recipientName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <UserRound aria-hidden className="h-3.5 w-3.5" />
                            <span dir="auto">{draft.recipientName}</span>
                          </span>
                        ) : null}
                        {draft.recipientEmail ? (
                          <span className="break-all text-fg-subtle" dir="ltr">
                            {draft.recipientEmail}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <IconButton
                        label={t("common.copy")}
                        icon={<Copy className="h-3.5 w-3.5" />}
                        size="icon-sm"
                        onClick={() => copyBody(draft)}
                      />
                      {sent ? (
                        <Badge tone="success" icon={<Check className="h-3 w-3" />}>
                          {t("followUp.sent")}
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="soft"
                          icon={<Send className="h-3.5 w-3.5" />}
                          loading={busyId === draft.id}
                          onClick={() => proposeSend(draft)}
                        >
                          {t("followUp.proposeSend")}
                        </Button>
                      )}
                    </div>
                  </div>

                  <p
                    className="mt-2.5 whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-fg-muted"
                    dir="auto"
                  >
                    {draft.body}
                  </p>
                </article>
              );
            })
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<Bell className="h-4 w-4" />}
          title={t("followUp.remindersTitle")}
          description={t("followUp.remindersHint")}
          action={
            <>
              <Badge tone="neutral">{reminders.length}</Badge>
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={openReminderModal}
              >
                {t("followUp.newReminder")}
              </Button>
            </>
          }
        />
        <CardBody>
          {reminders.length === 0 ? (
            <EmptyState
              compact
              icon={<Bell />}
              title={t("followUp.noRemindersTitle")}
              description={t("followUp.noRemindersBody")}
              className="border-0 bg-transparent"
            />
          ) : (
            <ul className="space-y-2">
              {reminders.map((reminder) => {
                const scheduled = reminder.status === "SCHEDULED";
                return (
                  <li
                    key={reminder.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-line bg-raised/20 p-3"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge
                          tone={
                            reminder.status === "SENT"
                              ? "success"
                              : reminder.status === "CANCELLED"
                                ? "neutral"
                                : "warning"
                          }
                          dot
                        >
                          {t(`followUp.reminderStatus.${reminder.status}`)}
                        </Badge>
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] tabular text-fg-subtle">
                          <Clock3 aria-hidden className="h-3 w-3" />
                          {formatDateTime(reminder.remindAt, lang)}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-fg" dir="auto">
                        {reminder.task?.title ?? t("followUp.reminderFallback")}
                      </p>
                    </div>

                    {scheduled ? (
                      <IconButton
                        label={t("followUp.cancelReminder")}
                        icon={<Trash2 className="h-4 w-4" />}
                        size="icon-sm"
                        loading={busyId === reminder.id}
                        onClick={() => cancel(reminder)}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title={t("followUp.newDraftTitle")}
        description={t("followUp.newDraftHint")}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraftOpen(false)} disabled={savingDraft}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={savingDraft} onClick={submitDraft}>
              {t("followUp.saveDraft")}
            </Button>
          </>
        }
      >
        <form onSubmit={submitDraft} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("followUp.recipientName")} htmlFor="draft-name">
              <Input
                id="draft-name"
                value={draftForm.recipientName}
                onChange={(event) =>
                  setDraftForm((current) => ({ ...current, recipientName: event.target.value }))
                }
                placeholder={t("followUp.recipientNamePlaceholder")}
                dir="auto"
              />
            </Field>
            <Field label={t("followUp.recipientEmail")} htmlFor="draft-email">
              <Input
                id="draft-email"
                type="email"
                value={draftForm.recipientEmail}
                onChange={(event) =>
                  setDraftForm((current) => ({ ...current, recipientEmail: event.target.value }))
                }
                placeholder="client@company.com"
                dir="ltr"
              />
            </Field>
          </div>

          <Field label={t("followUp.subject")} htmlFor="draft-subject">
            <Input
              id="draft-subject"
              value={draftForm.subject}
              onChange={(event) =>
                setDraftForm((current) => ({ ...current, subject: event.target.value }))
              }
              dir="auto"
            />
          </Field>

          <Field label={t("followUp.body")} htmlFor="draft-body" required>
            <Textarea
              id="draft-body"
              rows={7}
              value={draftForm.body}
              onChange={(event) =>
                setDraftForm((current) => ({ ...current, body: event.target.value }))
              }
              dir="auto"
              required
            />
          </Field>

          <p className="flex items-start gap-2 rounded-lg border border-line bg-raised/40 p-2.5 text-[11px] leading-relaxed text-fg-subtle">
            <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t("followUp.draftIsLocal")}
          </p>

          <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
        </form>
      </Modal>

      <Modal
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        title={t("followUp.newReminderTitle")}
        description={t("followUp.newReminderHint")}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setReminderOpen(false)}
              disabled={savingReminder}
            >
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={savingReminder} onClick={submitReminder}>
              {t("followUp.createReminderProposal")}
            </Button>
          </>
        }
      >
        <form onSubmit={submitReminder} className="space-y-3">
          <Field label={t("followUp.reminderNote")} htmlFor="reminder-note" required>
            <Input
              id="reminder-note"
              value={reminderForm.note}
              onChange={(event) =>
                setReminderForm((current) => ({ ...current, note: event.target.value }))
              }
              dir="auto"
              required
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("followUp.date")} htmlFor="reminder-date">
              <Input
                id="reminder-date"
                type="date"
                value={reminderForm.date}
                onChange={(event) =>
                  setReminderForm((current) => ({ ...current, date: event.target.value }))
                }
                className="tabular"
                required
              />
            </Field>
            <Field label={t("followUp.time")} htmlFor="reminder-time">
              <Input
                id="reminder-time"
                type="time"
                value={reminderForm.time}
                onChange={(event) =>
                  setReminderForm((current) => ({ ...current, time: event.target.value }))
                }
                className="tabular"
                required
              />
            </Field>
          </div>

          <InlineAlert tone="warning" title={t("followUp.reminderNeedsApproval")}>
            {t("followUp.reminderNeedsApprovalBody")}
          </InlineAlert>

          <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
        </form>
      </Modal>

      <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-fg-subtle">
        <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
        {t("followUp.footerNote")}
      </p>
    </div>
  );
}
