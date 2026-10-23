import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Check, Inbox, MapPin, Users, X } from "lucide-react";
import type { Proposal } from "../../types";
import { approveProposal, rejectProposal } from "../../api";
import { formatDateTime } from "../../lib/format";
import { ProposalActionBadge, ProposalStatusBadge } from "../StatusBadges";
import { Button, Card, CardBody, EmptyState, ReasonDialog, useToast } from "../ui";

interface ProposalsTabProps {
  proposals: Proposal[];
  onProposalsChange: (proposals: Proposal[]) => void;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function ProposalsTab({ proposals, onProposalsChange }: ProposalsTabProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Proposal | null>(null);

  const patch = (id: string, next: Partial<Proposal>) =>
    onProposalsChange(proposals.map((item) => (item.id === id ? { ...item, ...next } : item)));

  const handleApprove = async (proposal: Proposal) => {
    setBusyId(proposal.id);
    try {
      const result = await approveProposal(proposal.id);
      patch(proposal.id, {
        status: (result.proposal?.status ?? "APPROVED") as Proposal["status"],
      });
      toast({ title: t("proposals.approvedToast"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejecting) return;
    const proposal = rejecting;
    setBusyId(proposal.id);
    try {
      await rejectProposal(proposal.id, reason);
      patch(proposal.id, { status: "REJECTED", reason: reason || null });
      toast({ title: t("proposals.rejectedToast"), tone: "info" });
      setRejecting(null);
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setBusyId(null);
    }
  };

  if (proposals.length === 0) {
    return (
      <EmptyState
        icon={<Inbox />}
        title={t("meeting.proposals.emptyTitle")}
        description={t("meeting.proposals.emptyBody")}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-muted">{t("meeting.proposals.hint")}</p>

      <ul className="stagger space-y-3">
        {proposals.map((proposal) => {
          const payload = proposal.payload ?? {};
          const datetime = asText(payload.proposedDatetime);
          const place = asText(payload.place);
          const title = asText(payload.title);
          const participants = Array.isArray(payload.participants)
            ? payload.participants.filter((item): item is string => typeof item === "string")
            : [];
          const pending = proposal.status === "PENDING_APPROVAL";

          return (
            <li key={proposal.id}>
              <Card>
                <CardBody className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <ProposalActionBadge action={proposal.actionType} />
                      <ProposalStatusBadge status={proposal.status} />
                    </div>
                    <span className="text-[11px] tabular text-fg-subtle">
                      {formatDateTime(proposal.createdAt, i18n.language)}
                    </span>
                  </div>

                  {title ? (
                    <h3 className="text-sm font-medium text-fg" dir="auto">
                      {title}
                    </h3>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
                    {datetime ? (
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                        <span className="tabular">{formatDateTime(datetime, i18n.language)}</span>
                      </span>
                    ) : null}
                    {place ? (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin aria-hidden className="h-3.5 w-3.5" />
                        <span dir="auto">{place}</span>
                      </span>
                    ) : null}
                    {participants.length > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Users aria-hidden className="h-3.5 w-3.5" />
                        <span className="truncate" dir="ltr">
                          {participants.join(" · ")}
                        </span>
                      </span>
                    ) : null}
                  </div>

                  {proposal.reason ? (
                    <p className="rounded-lg border border-line bg-raised/40 px-3 py-2 text-xs text-fg-muted">
                      <span className="font-medium text-fg">{t("common.reason")}: </span>
                      <span dir="auto">{proposal.reason}</span>
                    </p>
                  ) : null}

                  {pending ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<X className="h-3.5 w-3.5" />}
                        onClick={() => setRejecting(proposal)}
                        disabled={busyId === proposal.id}
                      >
                        {t("proposals.reject")}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={<Check className="h-3.5 w-3.5" />}
                        loading={busyId === proposal.id}
                        onClick={() => handleApprove(proposal)}
                      >
                        {t("proposals.approve")}
                      </Button>
                    </div>
                  ) : null}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>

      <ReasonDialog
        open={rejecting !== null}
        title={t("proposals.rejectTitle")}
        description={t("proposals.rejectHint")}
        confirmLabel={t("proposals.reject")}
        loading={busyId === rejecting?.id}
        onSubmit={handleReject}
        onClose={() => setRejecting(null)}
      />
    </div>
  );
}
