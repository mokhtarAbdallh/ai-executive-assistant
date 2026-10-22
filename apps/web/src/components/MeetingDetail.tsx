import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Globe,
  Sparkles,
  Check,
  Edit2,
  Calendar,
  AlertTriangle,
  Search,
  Copy,
  CheckSquare,
  ShieldCheck,
  History,
  FileText,
  Mail,
  Bot,
  Trash2,
} from "lucide-react";
import type { MeetingDetail as MeetingDetailType, Task, Decision } from "../types";
import {
  updateMeeting,
  updateTask,
  updateDecision,
  approveAllMeetingItems,
  deleteMeeting,
} from "../api";
import { AskChat } from "./AskChat";
import { FollowUpTab } from "./FollowUpTab";

interface MeetingDetailProps {
  meeting: MeetingDetailType;
  onBack: () => void;
  onMeetingUpdated: (updated: MeetingDetailType) => void;
}

export function MeetingDetail({
  meeting: initialMeeting,
  onBack,
  onMeetingUpdated,
}: MeetingDetailProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";

  const [meeting, setMeeting] = useState<MeetingDetailType>(initialMeeting);
  const [activeTab, setActiveTab] = useState<
    "summary" | "decisions" | "tasks" | "proposals" | "followup" | "ask" | "transcript" | "history"
  >("summary");

  // Editable title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(meeting.title);

  // Active audio timestamp simulation
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);

  // Transcript search
  const [transcriptSearch, setTranscriptSearch] = useState("");

  // Copy TL;DR feedback
  const [copiedTldr, setCopiedTldr] = useState(false);

  // Inline editing task modal/inline
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<Partial<Task>>({});

  // Inline editing decision
  const [editingDecisionId, setEditingDecisionId] = useState<string | null>(null);
  const [decisionText, setDecisionText] = useState("");

  // Delete meeting confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteMeeting = async () => {
    try {
      setIsDeleting(true);
      await deleteMeeting(meeting.id);
      onBack();
    } catch (err) {
      console.error("Delete meeting failed:", err);
      setIsDeleting(false);
    }
  };

  const handleSaveTitle = async () => {
    if (!editTitleValue.trim()) return;
    try {
      await updateMeeting(meeting.id, { title: editTitleValue.trim() });
      const updated = { ...meeting, title: editTitleValue.trim() };
      setMeeting(updated);
      onMeetingUpdated(updated);
      setIsEditingTitle(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleApproveAll = async () => {
    try {
      await approveAllMeetingItems(meeting.id);
      const updatedTasks = meeting.tasks.map((t) => ({ ...t, approved: true }));
      const updatedDecisions = meeting.decisions.map((d) => ({ ...d, approved: true }));
      const updated = {
        ...meeting,
        status: "APPROVED" as const,
        tasks: updatedTasks,
        decisions: updatedDecisions,
      };
      setMeeting(updated);
      onMeetingUpdated(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleTaskApproval = async (task: Task) => {
    const newApproved = !task.approved;
    try {
      await updateTask(meeting.id, task.id, { approved: newApproved });
      const updatedTasks = meeting.tasks.map((t) =>
        t.id === task.id ? { ...t, approved: newApproved } : t,
      );
      const updated = { ...meeting, tasks: updatedTasks };
      setMeeting(updated);
      onMeetingUpdated(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleDecisionApproval = async (decision: Decision) => {
    const newApproved = !decision.approved;
    try {
      await updateDecision(meeting.id, decision.id, { approved: newApproved });
      const updatedDecisions = meeting.decisions.map((d) =>
        d.id === decision.id ? { ...d, approved: newApproved } : d,
      );
      const updated = { ...meeting, decisions: updatedDecisions };
      setMeeting(updated);
      onMeetingUpdated(updated);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveTaskEdit = async (taskId: string) => {
    try {
      await updateTask(meeting.id, taskId, taskForm);
      const updatedTasks = meeting.tasks.map((t) =>
        t.id === taskId ? { ...t, ...taskForm } : t,
      );
      const updated = { ...meeting, tasks: updatedTasks };
      setMeeting(updated);
      onMeetingUpdated(updated);
      setEditingTaskId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveDecisionEdit = async (decisionId: string) => {
    try {
      await updateDecision(meeting.id, decisionId, { text: decisionText });
      const updatedDecisions = meeting.decisions.map((d) =>
        d.id === decisionId ? { ...d, text: decisionText } : d,
      );
      const updated = { ...meeting, decisions: updatedDecisions };
      setMeeting(updated);
      onMeetingUpdated(updated);
      setEditingDecisionId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyTldr = () => {
    if (meeting.analysis?.tldr) {
      void navigator.clipboard.writeText(meeting.analysis.tldr);
      setCopiedTldr(true);
      setTimeout(() => setCopiedTldr(false), 2000);
    }
  };

  const handleCitationClick = (segmentIds: string[]) => {
    if (segmentIds.length > 0) {
      setActiveSegmentId(segmentIds[0] ?? null);
      setActiveTab("transcript");
    }
  };

  // Filtered transcript segments
  const filteredSegments = meeting.transcriptSegments.filter((s) => {
    if (!transcriptSearch.trim()) return true;
    const term = transcriptSearch.toLowerCase();
    return (
      s.text.toLowerCase().includes(term) ||
      (s.speakerLabel && s.speakerLabel.toLowerCase().includes(term))
    );
  });

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      {/* Top Header & Actions */}
      <div className="flex flex-col gap-4">
        {/* Back Button */}
        <div>
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-cyan-400 transition cursor-pointer"
          >
            {isRtl ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
            <span>{t("details.back")}</span>
          </button>
        </div>

        {/* Title Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              {/* Status Badge */}
              {meeting.status === "APPROVED" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t("meetings.statusApproved")}
                </span>
              )}
              {meeting.status === "REVIEW_PENDING" && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Clock className="w-3.5 h-3.5" />
                  {t("meetings.statusReviewPending")}
                </span>
              )}

              {/* Language Badge */}
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                <Globe className="w-3 h-3 text-cyan-400" />
                <span>
                  {meeting.language === "mixed"
                    ? "عربي + English"
                    : meeting.language === "ar"
                      ? "عربي"
                      : "English"}
                </span>
              </span>

              {/* Duration Badge */}
              {meeting.audioDurationSeconds && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                  <Clock className="w-3 h-3" />
                  <span>{Math.ceil(meeting.audioDurationSeconds / 60)} دقيقة</span>
                </span>
              )}
            </div>

            {/* Editable Title */}
            {isEditingTitle ? (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-cyan-500 bg-slate-800 text-white font-bold text-lg md:text-2xl focus:outline-none"
                  dir="auto"
                />
                <button
                  onClick={handleSaveTitle}
                  className="p-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition"
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl md:text-2xl font-black text-white tracking-tight" dir="auto">
                  {meeting.title}
                </h1>
                <button
                  onClick={() => {
                    setEditTitleValue(meeting.title);
                    setIsEditingTitle(true);
                  }}
                  className="p-1 rounded text-slate-500 hover:text-slate-300 transition"
                  title={t("details.edit")}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Actions: Delete & Approve All */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition cursor-pointer"
              title={t("settings.deleteMeetingBtn")}
            >
              <Trash2 className="w-4 h-4" />
              <span>{t("settings.deleteMeetingBtn")}</span>
            </button>

            {meeting.status !== "APPROVED" ? (
              <button
                onClick={handleApproveAll}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white shadow-lg shadow-emerald-500/20 transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{t("details.approveAll")}</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <ShieldCheck className="w-4 h-4" />
                <span>{t("details.approvedBanner")}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Meeting Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 text-red-400 mx-auto flex items-center justify-center text-xl">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-white">
              {t("settings.deleteMeetingBtn")}
            </h3>
            <p className="text-xs text-slate-300">
              {t("settings.confirmDeleteMeeting")}
            </p>
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-300 font-semibold text-xs hover:bg-slate-800 transition"
              >
                {t("details.cancel")}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteMeeting}
                className="flex-1 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition text-xs shadow-lg shadow-red-500/20 disabled:opacity-50"
              >
                {isDeleting ? "جاري الحذف..." : "تأكيد الحذف"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center gap-1 border-b border-slate-800 pb-px overflow-x-auto text-xs font-semibold">
        <button
          onClick={() => setActiveTab("summary")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "summary"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>{t("details.tabs.summary")}</span>
        </button>

        <button
          onClick={() => setActiveTab("decisions")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "decisions"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>{t("details.tabs.decisions")}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
            {meeting.decisions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("tasks")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "tasks"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>{t("details.tabs.tasks")}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
            {meeting.tasks.length}
          </span>
          {meeting.tasks.some((t) => t.needsReview) && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          )}
        </button>

        <button
          onClick={() => setActiveTab("proposals")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "proposals"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>{t("details.tabs.proposals")}</span>
          {meeting.proposals.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300">
              {meeting.proposals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("followup")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "followup"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Mail className="w-4 h-4" />
          <span>{t("details.tabs.followup")}</span>
        </button>

        <button
          onClick={() => setActiveTab("ask")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "ask"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>{t("details.tabs.ask")}</span>
        </button>

        <button
          onClick={() => setActiveTab("transcript")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "transcript"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>{t("details.tabs.transcript")}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300">
            {meeting.transcriptSegments.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 px-4 py-3 border-b-2 transition whitespace-nowrap cursor-pointer ${
            activeTab === "history"
              ? "border-cyan-500 text-cyan-400 bg-cyan-500/5 font-bold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <History className="w-4 h-4" />
          <span>{t("details.tabs.history")}</span>
        </button>
      </div>

      {/* Tab Content 1: Summary & Agenda */}
      {activeTab === "summary" && (
        <div className="flex flex-col gap-6">
          {/* Executive Summary TL;DR */}
          <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                <span>{t("details.tldr")}</span>
              </h2>
              <button
                onClick={handleCopyTldr}
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition"
              >
                {copiedTldr ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedTldr ? "تم النسخ" : "نسخ الملخص"}</span>
              </button>
            </div>
            <p className="text-slate-200 text-sm md:text-base leading-relaxed" dir="auto">
              {meeting.analysis?.tldr || "جاري استخراج الملخص التنفيذي..."}
            </p>
          </div>

          {/* Purpose & Agenda Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Purpose */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span>{t("details.purpose")}</span>
              </h3>
              <p className="text-slate-300 text-sm leading-relaxed" dir="auto">
                {meeting.analysis?.purpose || "هدف الاجتماع غير محدد"}
              </p>
            </div>

            {/* Agenda */}
            <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 flex flex-col gap-3">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-cyan-400" />
                <span>{t("details.agenda")}</span>
              </h3>
              <ul className="flex flex-col gap-2 text-sm text-slate-300">
                {meeting.agendaItems.map((item, idx) => (
                  <li key={item.id} className="flex items-start gap-2" dir="auto">
                    <span className="text-cyan-400 font-bold shrink-0">{idx + 1}.</span>
                    <span>{item.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Topics Breakdown */}
          <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 flex flex-col gap-4">
            <h3 className="text-sm font-bold text-slate-200">{t("details.topics")}</h3>
            <div className="grid grid-cols-1 gap-3">
              {meeting.topics.map((topic) => (
                <div
                  key={topic.id}
                  className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/80 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-white" dir="auto">
                      {topic.title}
                    </h4>
                    {topic.sourceTs && (
                      <button
                        onClick={() => handleCitationClick(topic.sourceSegmentIds)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-950/60 text-cyan-400 border border-cyan-500/20 hover:border-cyan-400 transition"
                        title="انتقل لموضع الحديث في التسجيل"
                      >
                        <Clock className="w-3 h-3" />
                        <span>[{topic.sourceTs}]</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed" dir="auto">
                    {topic.summary}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab Content 2: Decisions */}
      {activeTab === "decisions" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4">
            {meeting.decisions.map((dec) => (
              <div
                key={dec.id}
                className={`p-5 rounded-2xl border transition flex flex-col gap-3 ${
                  dec.approved
                    ? "border-emerald-500/30 bg-emerald-950/10"
                    : "border-slate-800 bg-slate-900/60"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {editingDecisionId === dec.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={decisionText}
                          onChange={(e) => setDecisionText(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-cyan-500 bg-slate-800 text-white text-sm"
                          dir="auto"
                        />
                        <button
                          onClick={() => handleSaveDecisionEdit(dec.id)}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-bold"
                        >
                          {t("details.save")}
                        </button>
                        <button
                          onClick={() => setEditingDecisionId(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs"
                        >
                          {t("details.cancel")}
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm md:text-base font-semibold text-white leading-relaxed" dir="auto">
                        {dec.text}
                      </p>
                    )}
                  </div>

                  {/* Actions & Status */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleDecisionApproval(dec)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                        dec.approved
                          ? "bg-emerald-500 text-white shadow-sm"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{dec.approved ? t("details.approvedBadge") : t("details.markApproved")}</span>
                    </button>

                    <button
                      onClick={() => {
                        setEditingDecisionId(dec.id);
                        setDecisionText(dec.text);
                      }}
                      className="p-1.5 rounded text-slate-400 hover:text-white"
                      title={t("details.edit")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Footer with citation (Hard Invariant 2) */}
                <div className="flex items-center gap-3 pt-2 border-t border-slate-800/60 text-xs text-slate-400">
                  {dec.sourceTs && (
                    <button
                      onClick={() => handleCitationClick(dec.sourceSegmentIds)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-950/60 text-cyan-400 border border-cyan-500/20 hover:border-cyan-400 transition"
                    >
                      <Clock className="w-3 h-3" />
                      <span>{t("details.sourceCitation")} [{dec.sourceTs}]</span>
                    </button>
                  )}
                  {dec.needsReview && (
                    <span className="inline-flex items-center gap-1 text-amber-400 font-medium">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{t("details.needsReviewBadge")}</span>
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Content 3: Tasks (Action Items) */}
      {activeTab === "tasks" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4">
            {meeting.tasks.map((task) => (
              <div
                key={task.id}
                className={`p-5 rounded-2xl border transition flex flex-col gap-3 ${
                  task.approved
                    ? "border-emerald-500/30 bg-emerald-950/10"
                    : task.needsReview
                      ? "border-amber-500/30 bg-amber-950/10"
                      : "border-slate-800 bg-slate-900/60"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 flex flex-col gap-1.5">
                    {/* Task Title */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm md:text-base font-bold text-white leading-relaxed" dir="auto">
                        {task.title}
                      </h4>
                      {/* Priority Pill */}
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                          task.priority === "HIGH" || task.priority === "URGENT"
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            : task.priority === "MEDIUM"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                              : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {t(`details.priority.${task.priority.toLowerCase()}`)}
                      </span>
                    </div>

                    {/* Metadata: Owner & Due Date */}
                    <div className="flex items-center gap-4 text-xs text-slate-300 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">{t("details.taskOwner")}</span>
                        <span className="font-semibold text-white">
                          {task.ownerName || <span className="text-amber-400">{t("details.unassigned")}</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">{t("details.taskDueDate")}</span>
                        <span className="font-semibold text-white">
                          {task.dueDate
                            ? new Date(task.dueDate).toLocaleDateString(i18n.language === "ar" ? "ar-EG" : "en-US")
                            : <span className="text-amber-400">{t("details.noDueDate")}</span>}
                        </span>
                      </div>
                    </div>

                    {/* Hard Invariant 3 Alert Banner if unassigned */}
                    {task.needsReview && (
                      <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-950/20 text-[11px] text-amber-300 flex items-center gap-2 mt-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                        <span dir="auto">{t("details.invariant3Warning")}</span>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleToggleTaskApproval(task)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                        task.approved
                          ? "bg-emerald-500 text-white shadow-sm"
                          : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{task.approved ? t("details.approvedBadge") : t("details.markApproved")}</span>
                    </button>

                    <button
                      onClick={() => {
                        setEditingTaskId(task.id);
                        setTaskForm({
                          title: task.title,
                          ownerName: task.ownerName,
                          dueDate: task.dueDate,
                          priority: task.priority,
                        });
                      }}
                      className="p-1.5 rounded text-slate-400 hover:text-white"
                      title={t("details.edit")}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Inline Edit Form */}
                {editingTaskId === task.id && (
                  <div className="p-4 rounded-xl border border-cyan-500/40 bg-slate-800/90 flex flex-col gap-3 mt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">{t("details.taskOwner")}</label>
                        <input
                          type="text"
                          value={taskForm.ownerName ?? ""}
                          onChange={(e) => setTaskForm({ ...taskForm, ownerName: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs"
                          placeholder="أدخل اسم المسؤول..."
                          dir="auto"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-slate-400 block mb-1">{t("details.taskDueDate")}</label>
                        <input
                          type="date"
                          value={taskForm.dueDate ? taskForm.dueDate.split("T")[0] : ""}
                          onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
                          className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditingTaskId(null)}
                        className="px-3 py-1 rounded bg-slate-700 text-slate-300 text-xs"
                      >
                        {t("details.cancel")}
                      </button>
                      <button
                        onClick={() => handleSaveTaskEdit(task.id)}
                        className="px-3 py-1 rounded bg-cyan-600 text-white text-xs font-bold"
                      >
                        {t("details.save")}
                      </button>
                    </div>
                  </div>
                )}

                {/* Footer Citation (Hard Invariant 2) */}
                <div className="flex items-center gap-3 pt-2 border-t border-slate-800/60 text-xs text-slate-400">
                  {task.sourceTs && (
                    <button
                      onClick={() => handleCitationClick(task.sourceSegmentIds)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-cyan-950/60 text-cyan-400 border border-cyan-500/20 hover:border-cyan-400 transition"
                    >
                      <Clock className="w-3 h-3" />
                      <span>{t("details.sourceCitation")} [{task.sourceTs}]</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Content 4: Proposals (Hard Invariant 1: Human-In-The-Loop) */}
      {activeTab === "proposals" && (
        <div className="flex flex-col gap-6">
          <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 to-slate-900/40 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-300">
              <span className="font-bold text-cyan-300 me-2">مبدأ الإنسان في الحلقة (Invariant 1):</span>
              <span>
                المساعد الذكي يقترح المواعيد والرسائل فقط. لا يتم إضافة أي حدث لتقويمك أو إرسال أي إيميل إلا بعد أن تضغط بنفسك على زر الموافقة.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {meeting.proposals.map((prop) => (
              <div
                key={prop.id}
                className="p-6 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-cyan-400" />
                    <span>{t("details.proposalTitle")}</span>
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    في انتظار اعتمادك
                  </span>
                </div>

                <p className="text-xs text-slate-400" dir="auto">
                  {t("details.proposalDesc")}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border border-slate-800 bg-slate-950/60 text-xs">
                  <div>
                    <span className="text-slate-500 block mb-0.5">{t("details.proposedDate")}</span>
                    <span className="font-semibold text-white">
                      {prop.payload?.proposedDatetime
                        ? new Date(String(prop.payload.proposedDatetime)).toLocaleString(
                            i18n.language === "ar" ? "ar-EG" : "en-US",
                          )
                        : "الأسبوع القادم"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block mb-0.5">{t("details.proposedPlatform")}</span>
                    <span className="font-semibold text-white">{String(prop.payload?.place || "Google Meet")}</span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={() => alert("تم رفض المقترح ولم يتم إجراء أي تغيير.")}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
                  >
                    {t("details.rejectProposal")}
                  </button>
                  <button
                    onClick={() => alert("تم اعتماد المقترح وسيتم مزامنته مع التقويم في Phase 4!")}
                    className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-500/20 transition cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>{t("details.approveProposal")}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Content: Follow-up & Reminders */}
      {activeTab === "followup" && (
        <FollowUpTab
          meetingId={meeting.id}
          meetingTitle={meeting.title}
          onProposalCreated={(prop) => {
            setMeeting((prev) => ({
              ...prev,
              proposals: [prop, ...prev.proposals],
            }));
          }}
        />
      )}

      {/* Tab Content: Ask Chat Agent */}
      {activeTab === "ask" && (
        <div className="h-[600px]">
          <AskChat
            meetingId={meeting.id}
            meetingTitle={meeting.title}
            onCitationClick={(citation) => {
              if (citation.segmentId) {
                setActiveSegmentId(citation.segmentId);
                setActiveTab("transcript");
              }
            }}
            onProposalApproved={(prop) => {
              setMeeting((prev) => ({
                ...prev,
                proposals: prev.proposals.map((p) =>
                  p.id === prop.id ? prop : p,
                ),
              }));
            }}
          />
        </div>
      )}

      {/* Tab Content 5: Full Transcript */}
      {activeTab === "transcript" && (
        <div className="flex flex-col gap-4">
          {/* Search inside transcript */}
          <div className="relative">
            <Search className="w-4 h-4 absolute top-3.5 start-3.5 text-slate-400" />
            <input
              type="text"
              value={transcriptSearch}
              onChange={(e) => setTranscriptSearch(e.target.value)}
              placeholder={t("details.transcriptSearch")}
              className="w-full ps-10 pe-4 py-2.5 rounded-xl border border-slate-800 bg-slate-900/60 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500 transition"
            />
          </div>

          {/* Transcript Turns */}
          <div className="flex flex-col gap-3">
            {filteredSegments.map((seg) => {
              const startSec = (seg.startMs / 1000).toFixed(0);
              const mins = Math.floor(Number(startSec) / 60);
              const remaining = Number(startSec) % 60;
              const formattedTs = `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
              const isHighlighted = activeSegmentId === seg.id;

              return (
                <div
                  key={seg.id}
                  className={`p-4 rounded-xl border transition flex flex-col gap-1.5 ${
                    isHighlighted
                      ? "border-cyan-500 bg-cyan-950/20 shadow-md shadow-cyan-500/10"
                      : "border-slate-800/80 bg-slate-900/40 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-cyan-400">{seg.speakerLabel || "Speaker"}</span>
                    <span className="font-mono text-slate-500 text-[11px]">[{formattedTs}]</span>
                  </div>
                  {/* dir="auto" is vital for Egyptian Arabic & English code-switching! */}
                  <p className="text-sm text-slate-200 leading-relaxed font-sans" dir="auto">
                    {seg.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab Content 6: Audit & History */}
      {activeTab === "history" && (
        <div className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <History className="w-4 h-4 text-cyan-400" />
            <span>{t("details.auditTrail")}</span>
          </h3>

          {meeting.editHistories && meeting.editHistories.length > 0 ? (
            <div className="flex flex-col gap-3">
              {meeting.editHistories.map((edit) => (
                <div key={edit.id} className="p-3 rounded-xl border border-slate-800 bg-slate-900/80 text-xs">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="font-semibold text-white">{edit.entityType}</span>
                    <span>{new Date(edit.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="text-slate-300">
                    تم تعديل العنصر بواسطة المستخدم.
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400 py-6 text-center">
              {t("details.noEdits")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
