import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  Plus,
  Sparkles,
  Calendar,
  Clock,
  CheckCircle2,
  Trash2,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import type { MeetingSummary } from "../types";
import { StatsCards } from "./StatsCards";

interface MeetingsListProps {
  meetings: MeetingSummary[];
  isLoading: boolean;
  error: string | null;
  onSelectMeeting: (id: string) => void;
  onDeleteMeeting: (id: string) => void;
  onNewMeetingClick: () => void;
  onLoadDemoClick: () => void;
  onRetry: () => void;
}

export function MeetingsList({
  meetings,
  isLoading,
  error,
  onSelectMeeting,
  onDeleteMeeting,
  onNewMeetingClick,
  onLoadDemoClick,
  onRetry,
}: MeetingsListProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Filtering
  const filteredMeetings = meetings.filter((m) => {
    const matchesSearch =
      !searchTerm.trim() ||
      m.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "REVIEW_PENDING" && m.status === "REVIEW_PENDING") ||
      (statusFilter === "APPROVED" && m.status === "APPROVED") ||
      (statusFilter === "PROCESSING" &&
        (m.status === "QUEUED" ||
          m.status === "TRANSCRIBING" ||
          m.status === "ANALYZING" ||
          m.status === "UPLOADED"));
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-200">
      {/* 1. KPI Stats Summary */}
      <StatsCards meetings={meetings} />

      {/* 2. Controls & Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute top-3 start-3.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t("meetings.searchPlaceholder")}
            className="w-full ps-10 pe-4 py-2 rounded-xl border border-slate-800 bg-slate-950/80 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-cyan-500 transition"
            dir="auto"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-semibold p-1 rounded-xl bg-slate-950/80 border border-slate-800">
          <button
            onClick={() => setStatusFilter("ALL")}
            className={`px-3 py-1.5 rounded-lg transition whitespace-nowrap cursor-pointer ${
              statusFilter === "ALL"
                ? "bg-cyan-600 text-white shadow-sm font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t("meetings.filterAll")}
          </button>
          <button
            onClick={() => setStatusFilter("REVIEW_PENDING")}
            className={`px-3 py-1.5 rounded-lg transition whitespace-nowrap cursor-pointer ${
              statusFilter === "REVIEW_PENDING"
                ? "bg-cyan-600 text-white shadow-sm font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t("meetings.filterReviewPending")}
          </button>
          <button
            onClick={() => setStatusFilter("APPROVED")}
            className={`px-3 py-1.5 rounded-lg transition whitespace-nowrap cursor-pointer ${
              statusFilter === "APPROVED"
                ? "bg-cyan-600 text-white shadow-sm font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t("meetings.filterApproved")}
          </button>
        </div>
      </div>

      {/* 3. Loading Skeleton State */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="p-6 rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse flex flex-col gap-4"
            >
              <div className="h-4 bg-slate-800 rounded w-1/4"></div>
              <div className="h-6 bg-slate-800 rounded w-3/4"></div>
              <div className="h-4 bg-slate-800 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Error State */}
      {!isLoading && error && (
        <div className="p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20 text-center flex flex-col items-center gap-3">
          <AlertCircle className="w-8 h-8 text-rose-400" />
          <h3 className="text-base font-bold text-white">تعذر تحميل قائمة الاجتماعات</h3>
          <p className="text-xs text-rose-300 max-w-md">{error}</p>
          <button
            onClick={onRetry}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* 5. Empty State */}
      {!isLoading && !error && filteredMeetings.length === 0 && (
        <div className="p-8 sm:p-12 rounded-3xl border border-slate-800 bg-slate-900/30 text-center flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-2">
            <Calendar className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-extrabold text-white">{t("meetings.emptyTitle")}</h3>
          <p className="text-sm text-slate-400 max-w-md leading-relaxed" dir="auto">
            {t("meetings.emptyDesc")}
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-3 mt-2">
            <button
              onClick={onNewMeetingClick}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t("meetings.createFirst")}</span>
            </button>
            <button
              onClick={onLoadDemoClick}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>{t("meetings.loadDemo")}</span>
            </button>
          </div>
        </div>
      )}

      {/* 6. Meetings Grid */}
      {!isLoading && !error && filteredMeetings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredMeetings.map((m) => (
            <div
              key={m.id}
              onClick={() => onSelectMeeting(m.id)}
              className="group p-5 rounded-2xl border border-slate-800/80 hover:border-cyan-500/50 bg-slate-900/50 hover:bg-slate-900/80 transition duration-200 cursor-pointer flex flex-col justify-between gap-4 shadow-sm hover:shadow-cyan-500/5"
            >
              <div className="flex flex-col gap-2">
                {/* Status & Language Row */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {m.status === "APPROVED" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{t("meetings.statusApproved")}</span>
                      </span>
                    )}
                    {m.status === "REVIEW_PENDING" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Clock className="w-3 h-3" />
                        <span>{t("meetings.statusReviewPending")}</span>
                      </span>
                    )}
                    {m.status !== "APPROVED" && m.status !== "REVIEW_PENDING" && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300">
                        <span>{m.status}</span>
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400 font-medium">
                      {m.language === "mixed"
                        ? "عربي + English"
                        : m.language === "ar"
                          ? "العربية"
                          : "English"}
                    </span>
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("هل تريد بالتأكيد حذف هذا الاجتماع؟")) {
                        onDeleteMeeting(m.id);
                      }
                    }}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                    title={t("meetings.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Title */}
                <h3
                  className="text-base font-bold text-white group-hover:text-cyan-300 transition leading-snug"
                  dir="auto"
                >
                  {m.title}
                </h3>
              </div>

              {/* Stats Footer */}
              <div className="flex items-center justify-between text-xs text-slate-400 pt-3 border-t border-slate-800/60">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    <span>
                      {new Date(m.createdAt).toLocaleDateString(
                        i18n.language === "ar" ? "ar-EG" : "en-US",
                      )}
                    </span>
                  </span>

                  {m.audioDurationSeconds && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span>{Math.ceil(m.audioDurationSeconds / 60)} دقيقة</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1 text-cyan-400 font-semibold group-hover:translate-x-1 rtl:group-hover:-translate-x-1 transition">
                  <span>{t("meetings.viewDetails")}</span>
                  {isRtl ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
