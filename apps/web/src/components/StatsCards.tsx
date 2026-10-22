import { useTranslation } from "react-i18next";
import { Calendar, CheckSquare, Clock, AlertTriangle } from "lucide-react";
import type { MeetingSummary } from "../types";

interface StatsCardsProps {
  meetings: MeetingSummary[];
}

export function StatsCards({ meetings }: StatsCardsProps) {
  const { t } = useTranslation();

  const totalMeetings = meetings.length;
  const pendingReview = meetings.filter(
    (m) => m.status === "REVIEW_PENDING" || m.status === "QUEUED" || m.status === "ANALYZING",
  ).length;
  const totalDecisions = meetings.reduce((acc, m) => acc + (m._count?.decisions ?? 0), 0);
  const totalDurationSeconds = meetings.reduce((acc, m) => acc + (m.audioDurationSeconds ?? 0), 0);
  // Estimated post-meeting time saved: approx 2.5x the recording duration
  const timeSavedHours = ((totalDurationSeconds * 2.5) / 3600).toFixed(1);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Total Meetings */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1">{t("stats.totalMeetings")}</div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white">{totalMeetings}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-between p-2.5 text-cyan-400">
          <Calendar className="w-full h-full" />
        </div>
      </div>

      {/* 2. Pending Review */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1">{t("stats.pendingReview")}</div>
          <div className="text-2xl sm:text-3xl font-extrabold text-amber-400">{pendingReview}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between p-2.5 text-amber-400">
          <AlertTriangle className="w-full h-full" />
        </div>
      </div>

      {/* 3. Documented Decisions */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1">{t("stats.decisionsMade")}</div>
          <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400">{totalDecisions}</div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between p-2.5 text-emerald-400">
          <CheckSquare className="w-full h-full" />
        </div>
      </div>

      {/* 4. Time Saved */}
      <div className="p-4 sm:p-5 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-slate-400 mb-1">{t("stats.timeSaved")}</div>
          <div className="text-2xl sm:text-3xl font-extrabold text-indigo-400">
            {timeSavedHours} <span className="text-xs font-normal text-slate-400">{t("stats.hours")}</span>
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-between p-2.5 text-indigo-400">
          <Clock className="w-full h-full" />
        </div>
      </div>
    </div>
  );
}
