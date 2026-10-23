import { useTranslation } from "react-i18next";
import { Check, HelpCircle, ListChecks, Target, Users, X } from "lucide-react";
import type { Decision, MeetingDetail } from "../../types";
import { Avatar } from "../Avatar";
import { SourceChip } from "../SourceChip";
import { Badge, Card, CardBody, CardHeader, EmptyState } from "../ui";
import { cn } from "../../lib/cn";

interface SummaryTabProps {
  meeting: MeetingDetail;
  onJumpToSource: (ts: string) => void;
  onApproveDecision: (decision: Decision) => void;
}

export function SummaryTab({ meeting, onJumpToSource, onApproveDecision }: SummaryTabProps) {
  const { t } = useTranslation();
  const analysis = meeting.analysis;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card className="overflow-hidden">
          <div className="border-s-2 border-brand bg-brand/[0.04] px-4 py-4 sm:px-5">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand">
              <ListChecks aria-hidden className="h-3.5 w-3.5" />
              {t("meeting.summary.tldr")}
            </p>
            <p className="text-sm leading-relaxed text-fg" dir="auto">
              {analysis?.tldr || t("meeting.summary.noTldr")}
            </p>
          </div>
          <div className="grid sm:grid-cols-2">
            <div className="border-line p-4 sm:border-e sm:p-5">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <Target aria-hidden className="h-3.5 w-3.5" />
                {t("meeting.summary.purpose")}
              </p>
              <p className="text-xs leading-relaxed text-fg" dir="auto">
                {analysis?.purpose || t("meeting.summary.emptyValue")}
              </p>
            </div>
            <div className="border-t border-line p-4 sm:border-t-0 sm:p-5">
              <p className="mb-2 text-xs font-medium text-fg-muted">
                {t("meeting.summary.agenda")}
              </p>
              {meeting.agendaItems.length === 0 ? (
                <p className="text-xs text-fg-subtle">{t("meeting.summary.emptyValue")}</p>
              ) : (
                <ol className="space-y-1.5">
                  {meeting.agendaItems
                    .slice()
                    .sort((a, b) => a.orderIndex - b.orderIndex)
                    .map((item, index) => (
                      <li key={item.id} className="flex gap-2 text-xs leading-relaxed text-fg">
                        <span className="tabular text-fg-subtle">{index + 1}.</span>
                        <span dir="auto">{item.title}</span>
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            icon={<ListChecks className="h-4 w-4" />}
            title={t("meeting.summary.topics")}
            description={t("meeting.summary.topicsHint")}
            action={<Badge tone="neutral">{meeting.topics.length}</Badge>}
          />
          <CardBody className="space-y-3">
            {meeting.topics.length === 0 ? (
              <p className="text-xs text-fg-subtle">{t("meeting.summary.noTopics")}</p>
            ) : (
              meeting.topics
                .slice()
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((topic) => (
                  <article
                    key={topic.id}
                    className="rounded-xl border border-line bg-raised/30 p-3.5"
                  >
                    <h4 className="text-sm font-medium text-fg" dir="auto">
                      {topic.title}
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-fg-muted" dir="auto">
                      {topic.summary}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SourceChip ts={topic.sourceTs} onJump={onJumpToSource} />
                    </div>
                  </article>
                ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon={<Check className="h-4 w-4" />}
            title={t("meeting.summary.decisions")}
            description={t("meeting.summary.decisionsHint")}
            action={<Badge tone="neutral">{meeting.decisions.length}</Badge>}
          />
          <ul className="divide-y divide-line">
            {meeting.decisions.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-fg-subtle">
                {t("meeting.summary.noDecisions")}
              </li>
            ) : (
              meeting.decisions.map((decision) => (
                <li key={decision.id} className="flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onApproveDecision(decision)}
                    aria-pressed={decision.approved}
                    aria-label={
                      decision.approved ? t("meeting.unapprove") : t("meeting.approveDecision")
                    }
                    className={cn(
                      "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors",
                      decision.approved
                        ? "border-success/40 bg-success/15 text-success"
                        : "border-line-strong text-transparent hover:border-brand/50 hover:text-brand/60",
                    )}
                  >
                    <Check aria-hidden className="h-3.5 w-3.5" />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-fg" dir="auto">
                      {decision.text}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <SourceChip ts={decision.sourceTs} onJump={onJumpToSource} />
                      {decision.needsReview ? (
                        <Badge tone="warning">{t("meeting.needsReview")}</Badge>
                      ) : null}
                      <Badge tone={decision.approved ? "success" : "neutral"}>
                        {decision.approved ? t("meeting.approved") : t("meeting.pendingApproval")}
                      </Badge>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader
            icon={<HelpCircle className="h-4 w-4" />}
            title={t("meeting.summary.questions")}
            description={t("meeting.summary.questionsHint")}
          />
          <CardBody className="space-y-3">
            {meeting.openQuestions.length === 0 ? (
              <p className="text-xs text-fg-subtle">{t("meeting.summary.noQuestions")}</p>
            ) : (
              meeting.openQuestions.map((question) => (
                <div key={question.id} className="rounded-lg border border-line bg-raised/30 p-3">
                  <p className="text-xs leading-relaxed text-fg" dir="auto">
                    {question.question}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-fg-subtle">
                    {question.askedBy ? <span dir="auto">{question.askedBy}</span> : null}
                    <SourceChip ts={question.sourceTs} onJump={onJumpToSource} />
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            icon={<Users className="h-4 w-4" />}
            title={t("meeting.summary.participants")}
          />
          <CardBody className="space-y-2.5">
            {meeting.participants.length === 0 ? (
              <p className="text-xs text-fg-subtle">{t("meeting.summary.noParticipants")}</p>
            ) : (
              meeting.participants.map((participant) => (
                <div key={participant.id} className="flex items-center gap-2.5">
                  <Avatar name={participant.name} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-fg" dir="auto">
                      {participant.name}
                    </p>
                    {participant.role ? (
                      <p className="truncate text-[11px] text-fg-subtle" dir="auto">
                        {participant.role}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        {meeting.decisions.some((decision) => decision.needsReview) ? (
          <EmptyState
            compact
            icon={<X />}
            title={t("meeting.summary.needsReviewTitle")}
            description={t("meeting.summary.needsReviewBody")}
            className="bg-warning/[0.03]"
          />
        ) : null}
      </div>
    </div>
  );
}
