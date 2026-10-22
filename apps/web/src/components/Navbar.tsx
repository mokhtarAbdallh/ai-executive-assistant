import { useTranslation } from "react-i18next";
import { Wordmark } from "./Wordmark";
import { setLanguage } from "../i18n";
import { Activity, ShieldCheck, Plus, CheckCircle2, AlertCircle } from "lucide-react";

interface NavbarProps {
  healthStatus: "connecting" | "connected" | "offline";
  uptime: number | null;
  onNewMeetingClick: () => void;
  onHomeClick: () => void;
}

export function Navbar({
  healthStatus,
  uptime,
  onNewMeetingClick,
  onHomeClick,
}: NavbarProps) {
  const { t, i18n } = useTranslation();
  const currentLang = i18n.language as "ar" | "en";

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand / Logo */}
        <div className="flex items-center gap-6">
          <button
            onClick={onHomeClick}
            className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-lg p-1"
          >
            <Wordmark className="h-9 transition group-hover:opacity-90" />
          </button>

          {/* Hard Invariant 1 Banner Pill */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border border-cyan-500/20 bg-cyan-950/30 text-cyan-300">
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate max-w-xs">{t("app.humanInTheLoopNotice")}</span>
          </div>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center gap-3">
          {/* New Meeting CTA */}
          <button
            onClick={onNewMeetingClick}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-sm shadow-cyan-500/20 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t("nav.newMeeting")}</span>
          </button>

          {/* API Health Status Badge */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-medium border border-slate-800 bg-slate-900">
            <Activity className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">{t("app.status")}:</span>
            {healthStatus === "connected" && (
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3 h-3" />
                {t("app.connected")}
                {uptime !== null && <span className="text-slate-500 text-[10px]">({uptime}s)</span>}
              </span>
            )}
            {healthStatus === "connecting" && (
              <span className="text-amber-400 font-semibold animate-pulse">{t("app.connecting")}</span>
            )}
            {healthStatus === "offline" && (
              <span className="flex items-center gap-1 text-rose-400 font-semibold">
                <AlertCircle className="w-3 h-3" />
                {t("app.offline")}
              </span>
            )}
          </div>

          {/* Language Switcher */}
          <div className="flex items-center rounded-lg border border-slate-800 p-0.5 bg-slate-900 text-xs font-medium">
            <button
              onClick={() => setLanguage("ar")}
              className={`px-2.5 py-1 rounded-md transition ${
                currentLang === "ar"
                  ? "bg-cyan-500 text-white shadow-sm font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              عربي
            </button>
            <button
              onClick={() => setLanguage("en")}
              className={`px-2.5 py-1 rounded-md transition ${
                currentLang === "en"
                  ? "bg-cyan-500 text-white shadow-sm font-bold"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              En
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
