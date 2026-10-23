import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarClock, Check, CheckSquare, Pencil, UserRound, X } from "lucide-react";
import type { Task, TaskStatus } from "../../types";
import { updateTask } from "../../api";
import { formatDate, formatNumber } from "../../lib/format";
import { Avatar } from "../Avatar";
import { SourceChip } from "../SourceChip";
import { PriorityBadge, TaskStatusBadge } from "../StatusBadges";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  IconButton,
  Input,
  Segmented,
  Select,
  useToast,
} from "../ui";

type Filter = "pending" | "approved" | "all";

interface TasksTabProps {
  meetingId: string;
  tasks: Task[];
  onTasksChange: (tasks: Task[]) => void;
  onJumpToSource: (ts: string) => void;
  onApprovedAll?: () => void;
}

export function TasksTab({ meetingId, tasks, onTasksChange, onJumpToSource }: TasksTabProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const lang = i18n.language;

  const [filter, setFilter] = useState<Filter>("pending");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ ownerName: string; dueDate: string; status: TaskStatus }>({
    ownerName: "",
    dueDate: "",
    status: "NEW",
  });
  const [saving, setSaving] = useState(false);

  const pendingCount = tasks.filter((task) => !task.approved).length;
  const approvedCount = tasks.length - pendingCount;

  const visible = useMemo(() => {
    const filtered =
      filter === "pending"
        ? tasks.filter((task) => !task.approved)
        : filter === "approved"
          ? tasks.filter((task) => task.approved)
          : tasks;
    return filtered.slice().sort((a, b) => Number(a.approved) - Number(b.approved));
  }, [tasks, filter]);

  const startEditing = (task: Task) => {
    setEditingId(task.id);
    setDraft({
      ownerName: task.ownerName ?? "",
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
      status: task.status,
    });
  };

  const saveTask = async (task: Task) => {
    setSaving(true);
    try {
      const patch: Partial<Task> = {
        ownerName: draft.ownerName.trim() || null,
        dueDate: draft.dueDate ? new Date(draft.dueDate).toISOString() : null,
        status: draft.status,
      };
      await updateTask(meetingId, task.id, patch);
      onTasksChange(tasks.map((item) => (item.id === task.id ? { ...item, ...patch } : item)));
      setEditingId(null);
      toast({ title: t("meeting.task.saved"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const toggleApproved = async (task: Task) => {
    const approved = !task.approved;
    onTasksChange(tasks.map((item) => (item.id === task.id ? { ...item, approved } : item)));
    try {
      await updateTask(meetingId, task.id, { approved });
    } catch {
      onTasksChange(tasks);
      toast({ title: t("errors.generic"), tone: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          ariaLabel={t("meeting.task.filterLabel")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: t("meeting.task.pending"), count: pendingCount },
            { value: "approved", label: t("meeting.approved"), count: approvedCount },
            { value: "all", label: t("common.all"), count: tasks.length },
          ]}
        />
        <p className="text-xs text-fg-subtle">
          {t("meeting.task.summary", {
            pending: formatNumber(pendingCount, lang),
            total: formatNumber(tasks.length, lang),
          })}
        </p>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<CheckSquare />}
          title={t("meeting.task.emptyTitle")}
          description={t("meeting.task.emptyBody")}
        />
      ) : (
        <ul className="stagger space-y-3">
          {visible.map((task) => {
            const editing = editingId === task.id;
            const needsOwner = !task.ownerName;
            const needsDue = !task.dueDate;

            return (
              <li key={task.id}>
                <Card className={task.approved ? "border-success/20" : undefined}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium text-fg" dir="auto">
                            {task.title}
                          </h3>
                          <PriorityBadge priority={task.priority} />
                          <TaskStatusBadge status={task.status} />
                          {task.needsReview ? (
                            <Badge tone="warning">{t("meeting.needsReview")}</Badge>
                          ) : null}
                        </div>
                        {task.description ? (
                          <p className="mt-1 text-xs leading-relaxed text-fg-muted" dir="auto">
                            {task.description}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <IconButton
                          label={t("common.edit")}
                          icon={<Pencil className="h-3.5 w-3.5" />}
                          size="icon-sm"
                          onClick={() => (editing ? setEditingId(null) : startEditing(task))}
                        />
                        <Button
                          size="sm"
                          variant={task.approved ? "ghost" : "secondary"}
                          icon={
                            task.approved ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <CheckSquare className="h-3.5 w-3.5" />
                            )
                          }
                          onClick={() => toggleApproved(task)}
                        >
                          {task.approved ? t("meeting.approved") : t("meeting.approve")}
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
                      <span className="inline-flex items-center gap-1.5">
                        {task.ownerName ? (
                          <Avatar name={task.ownerName} size="sm" />
                        ) : (
                          <UserRound aria-hidden className="h-3.5 w-3.5 text-warning" />
                        )}
                        <span className={needsOwner ? "text-warning" : undefined} dir="auto">
                          {task.ownerName ?? t("meeting.task.noOwner")}
                        </span>
                      </span>

                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock
                          aria-hidden
                          className={needsDue ? "h-3.5 w-3.5 text-warning" : "h-3.5 w-3.5"}
                        />
                        <span className={needsDue ? "text-warning" : "tabular"}>
                          {task.dueDate ? formatDate(task.dueDate, lang) : t("meeting.task.noDue")}
                        </span>
                      </span>

                      <SourceChip ts={task.sourceTs} onJump={onJumpToSource} />
                    </div>

                    {editing ? (
                      <div className="space-y-3 rounded-xl border border-line bg-raised/30 p-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label={t("meeting.task.owner")} htmlFor={`owner-${task.id}`}>
                            <Input
                              id={`owner-${task.id}`}
                              value={draft.ownerName}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  ownerName: event.target.value,
                                }))
                              }
                              placeholder={t("meeting.task.ownerPlaceholder")}
                              dir="auto"
                            />
                          </Field>
                          <Field label={t("meeting.task.due")} htmlFor={`due-${task.id}`}>
                            <Input
                              id={`due-${task.id}`}
                              type="date"
                              value={draft.dueDate}
                              onChange={(event) =>
                                setDraft((current) => ({ ...current, dueDate: event.target.value }))
                              }
                              className="tabular"
                            />
                          </Field>
                          <Field
                            label={t("meeting.task.statusLabel")}
                            htmlFor={`status-${task.id}`}
                          >
                            <Select
                              id={`status-${task.id}`}
                              value={draft.status}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  status: event.target.value as TaskStatus,
                                }))
                              }
                            >
                              <option value="NEW">{t("taskStatus.NEW")}</option>
                              <option value="IN_PROGRESS">{t("taskStatus.IN_PROGRESS")}</option>
                              <option value="COMPLETED">{t("taskStatus.COMPLETED")}</option>
                              <option value="CANCELLED">{t("taskStatus.CANCELLED")}</option>
                            </Select>
                          </Field>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<X className="h-3.5 w-3.5" />}
                            onClick={() => setEditingId(null)}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            loading={saving}
                            onClick={() => saveTask(task)}
                          >
                            {t("common.save")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
