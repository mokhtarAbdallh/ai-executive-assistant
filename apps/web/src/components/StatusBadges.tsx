import { useTranslation } from "react-i18next";
import { Badge, type BadgeTone } from "./ui/badge";
import type { MeetingStatus, Priority, Proposal, TaskStatus } from "../types";

const MEETING_TONE: Record<MeetingStatus, BadgeTone> = {
  UPLOADED: "neutral",
  QUEUED: "info",
  TRANSCRIBING: "info",
  ANALYZING: "brand",
  REVIEW_PENDING: "warning",
  APPROVED: "success",
  FAILED: "danger",
};

const PRIORITY_TONE: Record<Priority, BadgeTone> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const TASK_TONE: Record<TaskStatus, BadgeTone> = {
  NEW: "brand",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

const PROPOSAL_TONE: Record<Proposal["status"], BadgeTone> = {
  PENDING_APPROVAL: "warning",
  APPROVED: "brand",
  EXECUTED: "success",
  REJECTED: "neutral",
  FAILED: "danger",
};

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={MEETING_TONE[status]} dot>
      {t(`status.${status}`)}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { t } = useTranslation();
  return <Badge tone={PRIORITY_TONE[priority]}>{t(`priority.${priority}`)}</Badge>;
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TASK_TONE[status]}>{t(`taskStatus.${status}`)}</Badge>;
}

export function ProposalStatusBadge({ status }: { status: Proposal["status"] }) {
  const { t } = useTranslation();
  return (
    <Badge tone={PROPOSAL_TONE[status]} dot>
      {t(`proposalStatus.${status}`)}
    </Badge>
  );
}

export function ProposalActionBadge({ action }: { action: string }) {
  const { t } = useTranslation();
  return <Badge tone="brand">{t(`proposalAction.${action}`)}</Badge>;
}
