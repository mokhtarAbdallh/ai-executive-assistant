import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  Copy,
  FileText,
  HelpCircle,
  Send,
  ShieldCheck,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import type { ChatMessage, Proposal, SearchCitation } from "../types";
import { approveProposal, askAgent } from "../api";
import { formatTime } from "../lib/format";
import { cn } from "../lib/cn";
import { Badge, Button, Card, useToast } from "./ui";

interface AskChatProps {
  meetingId?: string;
  meetingTitle?: string;
  onCitationClick?: (citation: SearchCitation) => void;
  onProposalApproved?: (proposal: Proposal) => void;
  className?: string;
}

export function AskChat({
  meetingId,
  meetingTitle,
  onCitationClick,
  onProposalApproved,
  className,
}: AskChatProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const lang = i18n.language;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // The greeting is localized, so it is derived rather than stored on mount.
  useEffect(() => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: meetingTitle
          ? t("ask.welcomeMeeting", { title: meetingTitle })
          : t("ask.welcomeGeneral"),
        timestamp: new Date().toISOString(),
      },
    ]);
  }, [t, meetingTitle]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isLoading]);

  const quickPrompts = [
    t("ask.chipDecisions"),
    t("ask.chipOwners"),
    t("ask.chipFollowUp"),
    t("ask.chipDraft"),
    t("ask.chipReminder"),
  ];

  const send = async (raw?: string) => {
    const text = (raw ?? query).trim();
    if (!text || isLoading) return;

    setQuery("");
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((current) => [...current, userMessage]);
    setIsLoading(true);

    try {
      const history = messages
        .filter((message) => message.id !== "welcome")
        .slice(-6)
        .map((message) => ({ role: message.role, content: message.content }));

      const response = await askAgent(text, meetingId, history);
      setMessages((current) => [
        ...current,
        {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: response.answer,
          timestamp: new Date().toISOString(),
          citations: response.citations,
          proposals: response.proposalsCreated,
          drafts: response.draftsCreated,
          honestUnknown: response.honestUnknown,
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: t("ask.errorBody"),
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const approve = async (proposal: Proposal) => {
    setApprovingId(proposal.id);
    try {
      const result = await approveProposal(proposal.id, true);
      onProposalApproved?.(result.proposal ?? proposal);
      setMessages((current) =>
        current.map((message) =>
          message.proposals
            ? {
                ...message,
                proposals: message.proposals.map((item) =>
                  item.id === proposal.id ? { ...item, status: "EXECUTED" } : item,
                ),
              }
            : message,
        ),
      );
      toast({ title: t("proposals.approvedToast"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setApprovingId(null);
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("common.copied"), tone: "success" });
    } catch {
      toast({ title: t("common.copyFailed"), tone: "error" });
    }
  };

  return (
    <Card className={cn("flex h-[min(70vh,680px)] flex-col overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand"
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-fg">
              {t("ask.title")}
              <Badge tone="brand" icon={<ShieldCheck className="h-3 w-3" />}>
                {t("ask.citedBadge")}
              </Badge>
            </p>
            <p className="truncate text-xs text-fg-subtle">{t("ask.subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.map((message) => {
          const isUser = message.role === "user";
          return (
            <div
              key={message.id}
              className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}
            >
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full",
                  isUser ? "bg-raised text-fg-muted" : "bg-brand/10 text-brand",
                )}
              >
                {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
              </span>

              <div className={cn("min-w-0 max-w-[88%] space-y-2", isUser && "items-end")}>
                <div
                  className={cn(
                    "whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    isUser
                      ? "rounded-ee-md bg-brand text-brand-fg"
                      : "rounded-es-md border border-line bg-raised/50 text-fg",
                  )}
                  dir="auto"
                >
                  {message.content}
                </div>

                <p className="px-1 text-[11px] tabular text-fg-subtle">
                  {formatTime(message.timestamp, lang)}
                </p>

                {message.honestUnknown ? (
                  <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-2.5 py-2 text-xs text-warning">
                    <HelpCircle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t("ask.honestUnknown")}
                  </p>
                ) : null}

                {message.citations && message.citations.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-fg-subtle">{t("ask.sources")}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {message.citations.map((citation, index) => (
                        <button
                          key={`${message.id}-citation-${index}`}
                          type="button"
                          onClick={() => onCitationClick?.(citation)}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-brand/25 bg-brand/10 px-2 py-1 text-start text-[11px] text-brand transition-colors hover:bg-brand/15"
                          title={citation.text}
                        >
                          <span className="shrink-0 tabular opacity-80">{citation.timestamp}</span>
                          <span className="truncate" dir="auto">
                            {citation.meetingTitle}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {message.proposals && message.proposals.length > 0 ? (
                  <div className="space-y-2">
                    {message.proposals.map((proposal) => (
                      <div
                        key={proposal.id}
                        className="rounded-xl border border-line bg-surface p-3"
                      >
                        <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                          <ShieldCheck aria-hidden className="h-3.5 w-3.5 text-warning" />
                          {t("ask.proposalNeedsApproval")}
                        </p>
                        <p className="mt-1 text-xs text-fg-muted" dir="auto">
                          {String(proposal.payload?.title ?? proposal.actionType)}
                        </p>
                        {proposal.status === "PENDING_APPROVAL" ? (
                          <Button
                            size="sm"
                            variant="primary"
                            className="mt-2"
                            icon={<Check className="h-3.5 w-3.5" />}
                            loading={approvingId === proposal.id}
                            onClick={() => approve(proposal)}
                          >
                            {t("proposals.approve")}
                          </Button>
                        ) : (
                          <Badge tone="success" className="mt-2">
                            {t("proposalStatus.EXECUTED")}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}

                {message.drafts && message.drafts.length > 0 ? (
                  <div className="space-y-2">
                    {message.drafts.map((draft) => (
                      <div key={draft.id} className="rounded-xl border border-line bg-surface p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                            <FileText aria-hidden className="h-3.5 w-3.5 text-info" />
                            {draft.subject ?? t("ask.draftFallback")}
                          </p>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("common.copy")}
                            onClick={() => copyText(draft.body)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <p
                          className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-fg-muted"
                          dir="auto"
                        >
                          {draft.body}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-fg-subtle">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-brand"
            >
              <Bot className="h-3.5 w-3.5" />
            </span>
            <span className="flex gap-1" aria-label={t("ask.thinking")}>
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-subtle"
                  style={{ animationDelay: `${dot * 0.12}s` }}
                />
              ))}
            </span>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      {messages.length <= 1 ? (
        <div className="hide-scrollbar flex gap-2 overflow-x-auto border-t border-line px-3 py-2">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => send(prompt)}
              className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-brand/40 hover:text-brand"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 border-t border-line p-3"
      >
        <label htmlFor="ask-input" className="sr-only">
          {t("ask.inputLabel")}
        </label>
        <textarea
          id="ask-input"
          rows={1}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={t("ask.placeholder")}
          dir="auto"
          className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
        />
        <Button
          type="submit"
          variant="primary"
          size="icon"
          aria-label={t("ask.send")}
          disabled={!query.trim() || isLoading}
        >
          <Send className={cn("h-4 w-4", lang === "ar" && "-scale-x-100")} />
        </Button>
      </form>
    </Card>
  );
}
