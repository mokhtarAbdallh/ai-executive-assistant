import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  Users,
  ExternalLink,
  Inbox,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { Proposal } from "../types";
import { fetchProposals, approveProposal, rejectProposal } from "../api";

interface ProposalsInboxProps {
  onProposalsCountChange?: (count: number) => void;
  onNavigateToCalendar?: () => void;
}

export function ProposalsInbox({
  onProposalsCountChange,
  onNavigateToCalendar,
}: ProposalsInboxProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === "ar";

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const loadProposals = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchProposals();
      setProposals(data);
      const count = data.filter((p) => p.status === "PENDING_APPROVAL").length;
      onProposalsCountChange?.(count);
    } catch (err: unknown) {
      console.error("Failed to load proposals", err);
    } finally {
      setIsLoading(false);
    }
  }, [onProposalsCountChange]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  const handleApprove = async (id: string) => {
    setActionLoadingId(id);
    setSuccessNotice(null);
    try {
      const result = await approveProposal(id, true);
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "EXECUTED" as const } : p)),
      );
      setSuccessNotice(
        `تم اعتماد المقترح وحجز الموعد بنجاح على تقويم Google Calendar: "${result.details.title || "اجتماع متابعة"}"`,
      );
      const pendingCount = proposals.filter(
        (p) => p.id !== id && p.status === "PENDING_APPROVAL",
      ).length;
      onProposalsCountChange?.(pendingCount);
    } catch (err: unknown) {
      alert("فشل تنفيذ المقترح: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = prompt("سبب رفض المقترح (اختياري):", "الوقت غير مناسب أو تم التنسيق هاتفياً");
    if (reason === null) return;

    setActionLoadingId(id);
    try {
      await rejectProposal(id, reason);
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "REJECTED" as const, reason } : p)),
      );
      const pendingCount = proposals.filter(
        (p) => p.id !== id && p.status === "PENDING_APPROVAL",
      ).length;
      onProposalsCountChange?.(pendingCount);
    } catch (err: unknown) {
      alert("فشل رفض المقترح: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoadingId(null);
    }
  };

  const filtered = proposals.filter((p) => {
    if (filterStatus === "ALL") return true;
    return p.status === filterStatus;
  });

  const pendingCount = proposals.filter((p) => p.status === "PENDING_APPROVAL").length;

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              {t("proposalsInbox.title")}
            </h1>
            {pendingCount > 0 && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-slate-950 animate-pulse">
                {pendingCount} {t("proposalsInbox.filterPending")}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {t("proposalsInbox.subtitle")}
          </p>
        </div>

        {onNavigateToCalendar && (
          <button
            onClick={onNavigateToCalendar}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-700 bg-slate-800 hover:bg-slate-700 text-white transition self-start sm:self-auto cursor-pointer"
          >
            <Calendar className="w-4 h-4 text-cyan-400" />
            <span>عرض التقويم</span>
          </button>
        )}
      </div>

      {/* Hard Invariant 1 Alert Banner */}
      <div className="flex items-start gap-3 p-4 rounded-2xl border border-cyan-500/30 bg-cyan-950/20 text-cyan-200 text-xs sm:text-sm">
        <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <span className="font-bold block mb-0.5">
            مبدأ الأمان الإلزامي (Hard Invariant 1 — Human-in-the-Loop):
          </span>
          <p className="text-cyan-300/90 text-xs leading-relaxed">
            {t("proposalsInbox.invariantNotice")}
          </p>
        </div>
      </div>

      {/* Success Banner if action just executed */}
      {successNotice && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 text-emerald-300 text-xs animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successNotice}</span>
          </div>
          <button
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-400 hover:text-white text-xs font-semibold"
          >
            إغلاق
          </button>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-xl border border-slate-800 bg-slate-900/60 w-fit text-xs">
        <button
          onClick={() => setFilterStatus("ALL")}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            filterStatus === "ALL"
              ? "bg-slate-800 text-cyan-400 shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {t("proposalsInbox.filterAll")} ({proposals.length})
        </button>
        <button
          onClick={() => setFilterStatus("PENDING_APPROVAL")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
            filterStatus === "PENDING_APPROVAL"
              ? "bg-amber-500/20 border border-amber-500/40 text-amber-300 shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          <span>{t("proposalsInbox.filterPending")}</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500 text-slate-950">
            {pendingCount}
          </span>
        </button>
        <button
          onClick={() => setFilterStatus("EXECUTED")}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            filterStatus === "EXECUTED"
              ? "bg-slate-800 text-emerald-400 shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {t("proposalsInbox.filterExecuted")}
        </button>
        <button
          onClick={() => setFilterStatus("REJECTED")}
          className={`px-3 py-1.5 rounded-lg font-semibold transition ${
            filterStatus === "REJECTED"
              ? "bg-slate-800 text-rose-400 shadow-sm"
              : "text-slate-400 hover:text-white"
          }`}
        >
          {t("proposalsInbox.filterRejected")}
        </button>
      </div>

      {/* Proposals List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 rounded-2xl border border-slate-800 bg-slate-900/30">
          <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 px-4 rounded-2xl border border-dashed border-slate-800 bg-slate-900/20">
          <Inbox className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-white mb-1">
            {t("proposalsInbox.emptyPending")}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            {t("proposalsInbox.emptyDesc")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((prop) => {
            const isPending = prop.status === "PENDING_APPROVAL";
            const isExecuted = prop.status === "EXECUTED";
            const isRejected = prop.status === "REJECTED";
            const payload = prop.payload || {};

            return (
              <div
                key={prop.id}
                className={`p-5 rounded-2xl border transition flex flex-col gap-4 ${
                  isPending
                    ? "border-amber-500/30 bg-slate-900/80 shadow-lg shadow-amber-500/5 hover:border-amber-500/50"
                    : isExecuted
                    ? "border-emerald-500/30 bg-slate-900/50"
                    : "border-slate-800 bg-slate-950/40 opacity-75"
                }`}
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="p-2 rounded-xl bg-slate-950 border border-slate-800 text-cyan-400">
                      <Calendar className="w-4 h-4" />
                    </span>
                    <div>
                      <span className="text-xs font-semibold text-slate-400 block">
                        {t("proposalsInbox.actionSchedule")}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {new Date(prop.createdAt).toLocaleString(isRtl ? "ar-EG" : "en-US")}
                      </span>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {isPending && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-950/80 border border-amber-500/50 text-amber-300 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                        {t("proposalsInbox.filterPending")}
                      </span>
                    )}
                    {isExecuted && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        {t("proposalsInbox.filterExecuted")}
                      </span>
                    )}
                    {isRejected && (
                      <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-950/80 border border-rose-500/50 text-rose-300 flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 text-rose-400" />
                        {t("proposalsInbox.filterRejected")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Proposed Meeting Details */}
                <div className="flex flex-col gap-2">
                  <h3 className="text-base font-bold text-white" dir="auto">
                    {payload.title || "اجتماع متابعة مقترح من الذكاء الاصطناعي"}
                  </h3>

                  {prop.reason && (
                    <p className="text-xs text-slate-300 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80 leading-relaxed" dir="auto">
                      <span className="text-slate-500 font-semibold block mb-0.5">
                        سياق الاقتراح من محضر الاجتماع:
                      </span>
                      {prop.reason}
                    </p>
                  )}
                </div>

                {/* Metadata Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950 text-xs">
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <span className="text-slate-500 block text-[11px]">الموعد المقترح:</span>
                      <span className="font-semibold text-white">
                        {payload.proposedDatetime
                          ? new Date(payload.proposedDatetime).toLocaleString(isRtl ? "ar-EG" : "en-US")
                          : "الأسبوع القادم"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <MapPin className="w-4 h-4 text-cyan-400 shrink-0" />
                    <div>
                      <span className="text-slate-500 block text-[11px]">المكان / المنصة:</span>
                      <span className="font-semibold text-white">
                        {payload.place || "Google Meet"}
                      </span>
                    </div>
                  </div>

                  {payload.participants && payload.participants.length > 0 && (
                    <div className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <span className="text-slate-500 block text-[11px]">المشاركون:</span>
                        <span className="font-semibold text-white truncate max-w-[150px] block">
                          {payload.participants.join(", ")}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions Footer */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <div className="text-[11px] text-slate-500">
                    معرف المقترح: <code className="text-slate-400">{prop.id}</code>
                  </div>

                  <div className="flex items-center gap-2.5 ms-auto">
                    {isPending ? (
                      <>
                        <button
                          onClick={() => handleReject(prop.id)}
                          disabled={actionLoadingId === prop.id}
                          className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition disabled:opacity-50 cursor-pointer"
                        >
                          {t("proposalsInbox.reject")}
                        </button>
                        <button
                          onClick={() => handleApprove(prop.id)}
                          disabled={actionLoadingId === prop.id}
                          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-md shadow-emerald-500/20 transition disabled:opacity-50 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {actionLoadingId === prop.id
                              ? "جاري الحجز بالتقويم..."
                              : t("proposalsInbox.approveAndBook")}
                          </span>
                        </button>
                      </>
                    ) : isExecuted ? (
                      <a
                        href="https://calendar.google.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border border-emerald-500/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-900/30 transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>{t("proposalsInbox.viewCalendarEvent")}</span>
                      </a>
                    ) : (
                      <span className="text-xs text-rose-400">
                        تم الرفض {prop.reason ? `(${prop.reason})` : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
