import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Send,
  Sparkles,
  Bot,
  User as UserIcon,
  CheckCircle,
  ExternalLink,
  Loader2,
  Calendar,
  Bell,
  Mail,
  HelpCircle,
} from "lucide-react";
import type { ChatMessage, SearchCitation, Proposal } from "../types";
import { askAgent, approveProposal } from "../api";

interface AskChatProps {
  meetingId?: string;
  meetingTitle?: string;
  onCitationClick?: (citation: SearchCitation) => void;
  onProposalApproved?: (proposal: Proposal) => void;
  className?: string;
}

export const AskChat: React.FC<AskChatProps> = ({
  meetingId,
  meetingTitle,
  onCitationClick,
  onProposalApproved,
  className = "",
}) => {
  const { i18n } = useTranslation();
  const isArabic = i18n.language === "ar";

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome-msg",
      role: "assistant",
      content: isArabic
        ? meetingTitle
          ? `أهلاً بك! أنا مساعد دوّن الذكي للاجتماع "${meetingTitle}". يمكنك سؤالي عن أي قرار أو مهمة أو توقيت ورد في الاجتماع، أو طلبي باقتراح موعد أو كتابة مسودة رسالة.`
          : "أهلاً بك! أنا مساعد دوّن الذكي. يمكنك سؤالي عن أي شيء اتقال في اجتماعاتك السابقة وسأجيبك دائماً مع المصدر والتوقيت الدقيق."
        : meetingTitle
          ? `Welcome! I am Dawwen AI Assistant for "${meetingTitle}". Ask me anything discussed, or ask me to propose next meetings, reminders, or draft messages.`
          : "Welcome! I am Dawwen AI Assistant. Ask me about anything discussed across your recorded meetings.",
      timestamp: new Date().toLocaleTimeString(isArabic ? "ar-EG" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const [inputQuery, setInputQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [approvingPropId, setApprovingPropId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async (queryToSend?: string) => {
    const q = (queryToSend || inputQuery).trim();
    if (!q || isLoading) return;

    setInputQuery("");

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: "user",
      content: q,
      timestamp: new Date().toLocaleTimeString(isArabic ? "ar-EG" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // Build conversation history for API
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const response = await askAgent(q, meetingId, history);

      const assistantMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: response.answer,
        timestamp: new Date().toLocaleTimeString(isArabic ? "ar-EG" : "en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        citations: response.citations,
        proposals: response.proposalsCreated,
        drafts: response.draftsCreated,
        honestUnknown: response.honestUnknown,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: isArabic
          ? "عذراً، حدث خطأ أثناء معالجة السؤال. يُرجى المحاولة مرة أخرى."
          : "Sorry, an error occurred while processing your request. Please try again.",
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApproveInline = async (prop: Proposal) => {
    setApprovingPropId(prop.id);
    try {
      const result = await approveProposal(prop.id, true);
      onProposalApproved?.(result.proposal);

      // Update proposal state in messages
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.proposals) return m;
          return {
            ...m,
            proposals: m.proposals.map((p) =>
              p.id === prop.id ? { ...p, status: "EXECUTED" } : p,
            ),
          };
        }),
      );
    } catch (err) {
      console.error(err);
    } finally {
      setApprovingPropId(null);
    }
  };

  const quickChips = isArabic
    ? [
        "ما هي القرارات المعتمدة؟",
        "مين المسؤول عن المهام القادمة؟",
        "احجز اجتماع متابعة الأسبوع القادم",
        "اكتب مسودة رسالة للعميل",
        "فكرني بمراجعة التقرير",
      ]
    : [
        "What decisions were made?",
        "Who owns upcoming tasks?",
        "Schedule a follow-up meeting",
        "Draft email to client",
        "Remind me to review report",
      ];

  return (
    <div className={`flex flex-col h-full bg-slate-900/60 rounded-2xl border border-slate-800 backdrop-blur-xl overflow-hidden shadow-2xl ${className}`}>
      {/* Chat Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-900/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-md shadow-cyan-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>{isArabic ? "مساعد دوّن التفاعلي" : "Dawwen AI Chat"}</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {isArabic ? "موثّق بالمصادر" : "Cited Sources"}
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              {isArabic
                ? "إجابات دقيقة من تفريغ الاجتماعات دون تخمين"
                : "Honest grounded answers directly from meeting transcripts"}
            </p>
          </div>
        </div>
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                  isUser
                    ? "bg-slate-700 text-slate-200"
                    : "bg-gradient-to-tr from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/20"
                }`}
              >
                {isUser ? <UserIcon className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>

              <div className={`max-w-[85%] space-y-2.5 ${isUser ? "items-end" : "items-start"}`}>
                {/* Bubble */}
                <div
                  className={`p-4 rounded-2xl text-xs md:text-sm leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? "bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-te-none shadow-md shadow-cyan-600/15"
                      : "bg-slate-800/90 text-slate-100 border border-slate-700/60 rounded-ts-none"
                  }`}
                  dir="auto"
                >
                  {msg.content}

                  {/* Honest Unknown Badge */}
                  {msg.honestUnknown && (
                    <div className="mt-3 pt-2.5 border-t border-slate-700/60 flex items-center gap-2 text-amber-400 text-xs font-semibold">
                      <HelpCircle className="w-4 h-4 shrink-0" />
                      <span>
                        {isArabic
                          ? "ضمان الصدق: لم يتم اختلاق أي معلومة لعدم ورودها في التسجيل."
                          : "Honesty guarantee: No fabrication. Information not found in meeting recording."}
                      </span>
                    </div>
                  )}
                </div>

                {/* Citations Pills (Invariant 2) */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                      <span>{isArabic ? "المصادر الموثقة:" : "Verified Sources:"}</span>
                    </span>
                    {msg.citations.map((c, idx) => (
                      <button
                        key={idx}
                        onClick={() => onCitationClick?.(c)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-800/80 hover:bg-cyan-950/40 text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 hover:border-cyan-400 transition cursor-pointer shadow-sm"
                        title={c.text}
                      >
                        <span className="font-mono">{c.timestamp}</span>
                        <span className="text-slate-400 max-w-[120px] truncate">{c.meetingTitle}</span>
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Proposals Card (Hard Invariant 1: human confirmation required) */}
                {msg.proposals && msg.proposals.length > 0 && (
                  <div className="space-y-2 pt-1 w-full">
                    {msg.proposals.map((prop) => {
                      const isExecuted = prop.status === "EXECUTED";
                      return (
                        <div
                          key={prop.id}
                          className={`p-3.5 rounded-xl border transition ${
                            isExecuted
                              ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
                              : "bg-slate-800/90 border-cyan-500/30 text-slate-200"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                {prop.actionType === "SCHEDULE_MEETING" && (
                                  <Calendar className="w-4 h-4 text-cyan-400" />
                                )}
                                {prop.actionType === "SEND_REMINDER" && (
                                  <Bell className="w-4 h-4 text-amber-400" />
                                )}
                                {prop.actionType === "DRAFT_EMAIL" && (
                                  <Mail className="w-4 h-4 text-blue-400" />
                                )}
                                <span className="text-xs font-bold text-white">
                                  {prop.actionType === "SCHEDULE_MEETING"
                                    ? isArabic
                                      ? "مقترح حجز اجتماع"
                                      : "Meeting Proposal"
                                    : prop.actionType === "SEND_REMINDER"
                                      ? isArabic
                                        ? "مقترح تذكير بالمهام"
                                        : "Reminder Proposal"
                                      : isArabic
                                        ? "مقترح إرسال رسالة"
                                        : "Email Proposal"}
                                </span>
                                <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  {isExecuted
                                    ? isArabic
                                      ? "تم الاعتماد والتنفيذ"
                                      : "Executed"
                                    : isArabic
                                      ? "بانتظار موافقتك"
                                      : "Pending Approval"}
                                </span>
                              </div>
                              <p className="text-xs text-slate-300" dir="auto">
                                {prop.reason || "مقترح جديد من المساعد الذكي"}
                              </p>
                            </div>

                            {!isExecuted && (
                              <button
                                onClick={() => handleApproveInline(prop)}
                                disabled={approvingPropId === prop.id}
                                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition cursor-pointer disabled:opacity-50"
                              >
                                {approvingPropId === prop.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle className="w-3.5 h-3.5" />
                                )}
                                <span>{isArabic ? "اعتمد ونفّذ" : "Approve & Run"}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="text-[10px] text-slate-500 px-1">{msg.timestamp}</div>
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="flex gap-3 items-center text-slate-400 text-xs">
            <div className="w-8 h-8 rounded-full bg-cyan-600/30 text-cyan-400 flex items-center justify-center">
              <Bot className="w-4 h-4 animate-spin" />
            </div>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-800/80 border border-slate-700/50">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
              <span>{isArabic ? "جاري البحث في التفريغ وتوثيق المصادر..." : "Searching transcript & verifying sources..."}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Prompt Chips */}
      <div className="px-4 py-2 border-t border-slate-800/60 bg-slate-950/40 flex items-center gap-2 overflow-x-auto text-[11px] no-scrollbar">
        <span className="text-slate-500 shrink-0 font-medium">{isArabic ? "اقتراحات:" : "Quick:"}</span>
        {quickChips.map((chip, i) => (
          <button
            key={i}
            onClick={() => handleSend(chip)}
            disabled={isLoading}
            className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700/80 whitespace-nowrap transition cursor-pointer disabled:opacity-50"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Input Box */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/90">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder={
              isArabic
                ? "اسأل عن أي حاجة اتقالت في الاجتماع، أو اطلب حجز موعد..."
                : "Ask about what was discussed, or request meeting scheduling..."
            }
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-950/70 border border-slate-700/80 text-white text-xs md:text-sm placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition"
            dir="auto"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim() || isLoading}
            className="p-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white transition disabled:opacity-40 cursor-pointer shadow-lg shadow-cyan-500/20"
          >
            <Send className="w-4 h-4 rtl:rotate-180" />
          </button>
        </form>
      </div>
    </div>
  );
};
