import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Check, Inbox, MapPin, RefreshCw, ShieldCheck, Users, X } from "lucide-react";
import type { Proposal } from "../types";
import { approveProposal, fetchProposals, rejectProposal } from "../api";
import { formatDateTime, formatRelativeTime } from "../lib/format";
import { ProposalActionBadge, ProposalStatusBadge } from "./StatusBadges";
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  InlineAlert,
  ReasonDialog,
  Segmented,
  Skeleton,
  useToast,
} from "./ui";

type Filter = "pending" | "all" | "done" | "rejected";

interface ProposalsInboxProps {
  onProposalsCountChange?: (count: number) => void;
  onNavigateToCalendar?: () => void;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function ProposalsInbox({
  onProposalsCountChange,
  onNavigateToCalendar,
}: ProposalsInboxProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { toast } = useToast();

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Proposal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProposals();
      setProposals(data);
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = proposals.filter(
    (proposal) => proposal.status === "PENDING_APPROVAL",
  ).length;

  useEffect(() => {
    onProposalsCountChange?.(pendingCount);
  }, [pendingCount, onProposalsCountChange]);

  const visible = useMemo(() => {
    if (filter === "all") return proposals;
    if (filter === "pending") return proposals.filter((p) => p.status === "PENDING_APPROVAL");
    if (filter === "rejected") return proposals.filter((p) => p.status === "REJECTED");
    return proposals.filter((p) => p.status === "APPROVED" || p.status === "EXECUTED");
  }, [proposals, filter]);

  const patch = (id: string, next: Partial<Proposal>) =>
    setProposals((current) =>
      current.map((item) => (item.id === id ? { ...item, ...next } : item)),
    );

  const handleApprove = async (proposal: Proposal) => {
    setBusyId(proposal.id);
    try {
      const result = await approveProposal(proposal.id);
      patch(proposal.id, {
        status: (result.proposal?.status ?? "EXECUTED") as Proposal["status"],
      });
      toast({
        title: t("proposals.approvedToast"),
        description:
          proposal.actionType === "SCHEDULE_MEETING" ? t("proposals.approvedCalendar") : undefined,
        tone: "success",
      });
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

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t("proposals.title")}</h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted sm:text-sm">
            {t("proposals.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            loading={loading}
            onClick={load}
          >
            {t("common.refresh")}
          </Button>
          {onNavigateToCalendar ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              onClick={onNavigateToCalendar}
            >
              {t("proposals.openCalendar")}
            </Button>
          ) : null}
        </div>
      </header>

      <InlineAlert tone="info" title={t("proposals.guaranteeTitle")}>
        {t("proposals.guaranteeBody")}
      </InlineAlert>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          ariaLabel={t("proposals.filterLabel")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: t("proposals.filterPending"), count: pendingCount },
            { value: "all", label: t("common.all"), count: proposals.length },
            {
              value: "done",
              label: t("proposals.filterDone"),
              count: proposals.filter((p) => p.status === "APPROVED" || p.status === "EXECUTED")
                .length,
            },
            {
              value: "rejected",
              label: t("proposals.filterRejected"),
              count: proposals.filter((p) => p.status === "REJECTED").length,
            },
          ]}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-40 rounded-card" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={
            filter === "pending" ? t("proposals.emptyPendingTitle") : t("proposals.emptyTitle")
          }
          description={
            filter === "pending" ? t("proposals.emptyPendingBody") : t("proposals.emptyBody")
          }
        />
      ) : (
        <ul className="stagger space-y-3">
          {visible.map((proposal) => {
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
                <Card className={pending ? "border-warning/25" : undefined}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <ProposalActionBadge action={proposal.actionType} />
                        <ProposalStatusBadge status={proposal.status} />
                      </div>
                      <span className="text-[11px] text-fg-subtle">
                        {formatRelativeTime(proposal.createdAt, lang)}
                      </span>
                    </div>

                    <h2 className="text-sm font-semibold text-fg" dir="auto">
                      {title ?? t(`proposalAction.${proposal.actionType}`)}
                    </h2>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-muted">
                      {datetime ? (
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays aria-hidden className="h-3.5 w-3.5" />
                          <span className="tabular">{formatDateTime(datetime, lang)}</span>
                        </span>
                      ) : null}
                      {place ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin aria-hidden className="h-3.5 w-3.5" />
                          <span dir="auto">{place}</span>
                        </span>
                      ) : null}
                      {participants.length > 0 ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <Users aria-hidden className="h-3.5 w-3.5 shrink-0" />
                          <span className="break-all" dir="ltr">
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
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                        <p className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
                          <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
                          {t("proposals.needsYou")}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<X className="h-3.5 w-3.5" />}
                            disabled={busyId === proposal.id}
                            onClick={() => setRejecting(proposal)}
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
                            {proposal.actionType === "SCHEDULE_MEETING"
                              ? t("proposals.approveAndSchedule")
                              : t("proposals.approve")}
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
