import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Mail,
  Bell,
  Plus,
  Copy,
  Check,
  Send,
  Clock,
  User,
  ShieldAlert,
  Loader2,
  Trash2,
  AlertCircle,
} from "lucide-react";
import type { FollowUpDraft, Reminder, Proposal } from "../types";
import {
  fetchDrafts,
  createDraft,
  proposeSendDraft,
  fetchReminders,
  createReminder,
  cancelReminder,
} from "../api";

interface FollowUpTabProps {
  meetingId: string;
  meetingTitle: string;
  onProposalCreated?: (prop: Proposal) => void;
}

export const FollowUpTab: React.FC<FollowUpTabProps> = ({
  meetingId,
  meetingTitle,
  onProposalCreated,
}) => {
  const { i18n } = useTranslation();
  const isArabic = i18n.language === "ar";

  const [drafts, setDrafts] = useState<FollowUpDraft[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const [copiedDraftId, setCopiedDraftId] = useState<string | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [isCreatingReminder, setIsCreatingReminder] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // New Draft Form
  const [draftForm, setDraftForm] = useState({
    recipientName: "",
    recipientEmail: "",
    subject: `متابعة مخرجات: ${meetingTitle}`,
    body: "عزيزي العميل،\n\nنشكركم على الاجتماع المثمر اليوم. فيما يلي أهم النقاط التي تم الاتفاق عليها ومواعيد تسليم المهام.\n\nمع التحية،\nفريق العمل",
    channel: "email",
  });

  // New Reminder Form
  const [reminderForm, setReminderForm] = useState({
    note: "متابعة تسليم المهام مع الفريق",
    remindAtDate: new Date(Date.now() + 86400000).toISOString().split("T")[0],
    remindAtTime: "10:00",
    channel: "console",
  });

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [draftsRes, remindersRes] = await Promise.all([
        fetchDrafts(meetingId),
        fetchReminders(meetingId),
      ]);
      setDrafts(draftsRes.drafts);
      setReminders(remindersRes.reminders);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedDraftId(id);
    setTimeout(() => setCopiedDraftId(null), 2000);
  };

  const handleCreateDraftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createDraft({
        meetingId,
        recipientName: draftForm.recipientName || undefined,
        recipientEmail: draftForm.recipientEmail || undefined,
        subject: draftForm.subject,
        body: draftForm.body,
        channel: draftForm.channel,
      });
      setDrafts((prev) => [res.draft, ...prev]);
      setIsCreatingDraft(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleProposeSend = async (draftId: string) => {
    setActionLoadingId(draftId);
    try {
      const res = await proposeSendDraft(draftId);
      onProposalCreated?.(res.proposal);
      alert(
        isArabic
          ? "تم إنشاء مقترح إرسال الرسالة في صندوق المقترحات، ولن يتم الإرسال إلا بعد موافقتك الصريحة."
          : "An email dispatch proposal has been created in Proposals Inbox. It will only send after your explicit approval.",
      );
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCreateReminderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const remindAt = new Date(`${reminderForm.remindAtDate}T${reminderForm.remindAtTime}:00Z`);
      const res = await createReminder({
        meetingId,
        note: reminderForm.note,
        remindAt: remindAt.toISOString(),
        channel: reminderForm.channel,
        proposeOnly: true, // Invariant 1
      });

      if (res.proposal) {
        onProposalCreated?.(res.proposal);
        alert(
          isArabic
            ? "تم إنشاء مقترح تذكير جديد في صندوق المقترحات وهو بانتظار اعتمادك."
            : "A reminder proposal has been added to Proposals Inbox awaiting approval.",
        );
      } else if (res.reminder) {
        setReminders((prev) => [...prev, res.reminder!]);
      }
      setIsCreatingReminder(false);
      void loadData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleCancelReminder = async (remId: string) => {
    try {
      await cancelReminder(remId);
      setReminders((prev) =>
        prev.map((r) => (r.id === remId ? { ...r, status: "CANCELLED" } : r)),
      );
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
        <span className="text-sm font-semibold">{isArabic ? "جاري تحميل المتابعة..." : "Loading follow-up..."}</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Human-in-the-Loop Safety Banner (Invariant 1) */}
      <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/30 to-blue-950/20 flex items-start gap-3 text-cyan-300">
        <ShieldAlert className="w-5 h-5 shrink-0 text-cyan-400 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-bold">
            {isArabic
              ? "مبدأ الأمان: لا إرسال ولا تذكير بدون اعتمادك الصريح (Human-in-the-Loop)"
              : "Safety Invariant: No message is sent and no reminder triggers without your explicit approval"}
          </p>
          <p className="text-slate-400">
            {isArabic
              ? "كل إجراء متابعة مقترح يُحفظ كمسودة أو مقترح في صندوق المقترحات، ولا يتم تفعيله إلا بموافقتك."
              : "Every follow-up action is staged as a draft or proposal and requires authenticated confirmation before execution."}
          </p>
        </div>
      </div>

      {/* SECTION 1: DRAFT MESSAGES */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white">
              {isArabic ? "مسودات رسائل المتابعة" : "Follow-up Message Drafts"}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
              {drafts.length}
            </span>
          </div>

          <button
            onClick={() => setIsCreatingDraft(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isArabic ? "مسودة جديدة" : "New Draft"}</span>
          </button>
        </div>

        {/* Drafts List */}
        {drafts.length === 0 ? (
          <div className="p-8 rounded-xl border border-slate-800/80 bg-slate-900/30 text-center text-slate-400 text-xs space-y-2">
            <Mail className="w-8 h-8 mx-auto text-slate-600" />
            <p>{isArabic ? "لا توجد مسودات رسائل لهذا الاجتماع حتى الآن." : "No follow-up drafts for this meeting yet."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {drafts.map((draft) => {
              const isSent = draft.status === "sent";
              return (
                <div
                  key={draft.id}
                  className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3 hover:border-slate-700 transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white" dir="auto">
                          {draft.subject || (isArabic ? "بدون موضوع" : "Untitled Draft")}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            isSent
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                          }`}
                        >
                          {isSent
                            ? isArabic
                              ? "تم الإرسال"
                              : "Sent"
                            : isArabic
                              ? "مسودة"
                              : "Draft"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        {draft.recipientName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            <span>{draft.recipientName}</span>
                          </span>
                        )}
                        {draft.recipientEmail && (
                          <span className="text-cyan-400/80">{draft.recipientEmail}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopy(draft.id, draft.body)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition cursor-pointer"
                        title={isArabic ? "نسخ نص الرسالة" : "Copy body"}
                      >
                        {copiedDraftId === draft.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">{isArabic ? "تم النسخ" : "Copied"}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>{isArabic ? "نسخ" : "Copy"}</span>
                          </>
                        )}
                      </button>

                      {!isSent && (
                        <button
                          onClick={() => handleProposeSend(draft.id)}
                          disabled={actionLoadingId === draft.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition cursor-pointer disabled:opacity-50"
                        >
                          {actionLoadingId === draft.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>{isArabic ? "اقتراح الإرسال" : "Propose Send"}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Body Preview */}
                  <div
                    className="p-3.5 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 whitespace-pre-wrap leading-relaxed"
                    dir="auto"
                  >
                    {draft.body}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: SCHEDULED REMINDERS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">
              {isArabic ? "تذكيرات المهام والمتابعة" : "Scheduled Reminders"}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300">
              {reminders.length}
            </span>
          </div>

          <button
            onClick={() => setIsCreatingReminder(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isArabic ? "إضافة تذكير" : "Add Reminder"}</span>
          </button>
        </div>

        {reminders.length === 0 ? (
          <div className="p-8 rounded-xl border border-slate-800/80 bg-slate-900/30 text-center text-slate-400 text-xs space-y-2">
            <Bell className="w-8 h-8 mx-auto text-slate-600" />
            <p>{isArabic ? "لا توجد تذكيرات مجدولة لهذا الاجتماع." : "No reminders scheduled for this meeting."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reminders.map((rem) => {
              const isScheduled = rem.status === "SCHEDULED";
              const remDate = new Date(rem.remindAt);
              return (
                <div
                  key={rem.id}
                  className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex items-start justify-between gap-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          rem.status === "SENT"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : rem.status === "CANCELLED"
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                        }`}
                      >
                        {rem.status}
                      </span>
                      <span className="text-xs text-slate-400 font-mono flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>
                          {remDate.toLocaleDateString(isArabic ? "ar-EG" : "en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                    </div>

                    <p className="text-xs text-slate-200 font-medium" dir="auto">
                      {rem.task?.title || "تذكير بمتابعة مخرجات الاجتماع"}
                    </p>
                  </div>

                  {isScheduled && (
                    <button
                      onClick={() => handleCancelReminder(rem.id)}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                      title={isArabic ? "إلغاء التذكير" : "Cancel"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CREATE DRAFT MODAL */}
      {isCreatingDraft && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <Mail className="w-4 h-4 text-cyan-400" />
              <span>{isArabic ? "إنشاء مسودة رسالة متابعة جديدة" : "New Follow-up Draft"}</span>
            </h4>

            <form onSubmit={handleCreateDraftSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">{isArabic ? "اسم المستلم" : "Recipient Name"}</label>
                <input
                  type="text"
                  value={draftForm.recipientName}
                  onChange={(e) => setDraftForm({ ...draftForm, recipientName: e.target.value })}
                  placeholder="محمد أحمد (العميل)"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-cyan-500"
                  dir="auto"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{isArabic ? "البريد الإلكتروني للمستلم" : "Recipient Email"}</label>
                <input
                  type="email"
                  value={draftForm.recipientEmail}
                  onChange={(e) => setDraftForm({ ...draftForm, recipientEmail: e.target.value })}
                  placeholder="client@acme.com"
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{isArabic ? "موضوع الرسالة" : "Subject"}</label>
                <input
                  type="text"
                  value={draftForm.subject}
                  onChange={(e) => setDraftForm({ ...draftForm, subject: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-cyan-500"
                  dir="auto"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">{isArabic ? "نص الرسالة" : "Message Body"}</label>
                <textarea
                  rows={5}
                  value={draftForm.body}
                  onChange={(e) => setDraftForm({ ...draftForm, body: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-cyan-500 leading-relaxed"
                  dir="auto"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingDraft(false)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                >
                  {isArabic ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition cursor-pointer"
                >
                  {isArabic ? "حفظ المسودة" : "Save Draft"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE REMINDER MODAL */}
      {isCreatingReminder && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h4 className="text-base font-bold text-white flex items-center gap-2">
              <Bell className="w-4 h-4 text-amber-400" />
              <span>{isArabic ? "إضافة تذكير جديد" : "Add New Reminder"}</span>
            </h4>

            <form onSubmit={handleCreateReminderSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">{isArabic ? "نص التذكير / المهمة" : "Note / Task"}</label>
                <input
                  type="text"
                  value={reminderForm.note}
                  onChange={(e) => setReminderForm({ ...reminderForm, note: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-amber-500"
                  dir="auto"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">{isArabic ? "التاريخ" : "Date"}</label>
                  <input
                    type="date"
                    value={reminderForm.remindAtDate}
                    onChange={(e) => setReminderForm({ ...reminderForm, remindAtDate: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">{isArabic ? "الوقت" : "Time"}</label>
                  <input
                    type="time"
                    value={reminderForm.remindAtTime}
                    onChange={(e) => setReminderForm({ ...reminderForm, remindAtTime: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>
                  {isArabic
                    ? "وفقاً لمبدأ الأمان، سيتم إنشاء مقترح في صندوق المقترحات أولاً."
                    : "Per safety policy, this creates a proposal awaiting your approval first."}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreatingReminder(false)}
                  className="px-4 py-2 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
                >
                  {isArabic ? "إلغاء" : "Cancel"}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold transition cursor-pointer"
                >
                  {isArabic ? "إنشاء مقترح التذكير" : "Create Proposal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
