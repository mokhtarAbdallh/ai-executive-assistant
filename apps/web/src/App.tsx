import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wordmark } from "./components/Wordmark";
import { setLanguage } from "./i18n";
import { Activity, ShieldCheck, Globe, CheckCircle2, AlertCircle } from "lucide-react";

export function App() {
  const { t, i18n } = useTranslation();
  const [healthStatus, setHealthStatus] = useState<"connecting" | "connected" | "offline">("connecting");
  const [uptime, setUptime] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const checkHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) {
          const data = (await res.json()) as { status: string; uptimeSeconds?: number };
          if (mounted && data.status === "ok") {
            setHealthStatus("connected");
            setUptime(data.uptimeSeconds ?? null);
            return;
          }
        }
        if (mounted) setHealthStatus("offline");
      } catch {
        if (mounted) setHealthStatus("offline");
      }
    };

    void checkHealth();
    const interval = setInterval(() => void checkHealth(), 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const currentLang = i18n.language as "ar" | "en";

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Wordmark className="h-9" />

          <div className="flex items-center gap-4">
            {/* API Health Status Badge */}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border border-slate-800 bg-slate-900">
              <Activity className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-400">{t("app.status")}:</span>
              {healthStatus === "connected" && (
                <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t("app.connected")}
                  {uptime !== null && <span className="text-slate-500 text-[10px]">({uptime}s)</span>}
                </span>
              )}
              {healthStatus === "connecting" && (
                <span className="text-amber-400 font-semibold animate-pulse">{t("app.connecting")}</span>
              )}
              {healthStatus === "offline" && (
                <span className="flex items-center gap-1 text-rose-400 font-semibold">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {t("app.offline")}
                </span>
              )}
            </div>

            {/* Language Switcher */}
            <div className="flex items-center rounded-lg border border-slate-800 p-0.5 bg-slate-900 text-xs">
              <button
                onClick={() => setLanguage("ar")}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  currentLang === "ar" ? "bg-cyan-500 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                عربي
              </button>
              <button
                onClick={() => setLanguage("en")}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  currentLang === "en" ? "bg-cyan-500 text-white shadow-sm" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                English
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex flex-col gap-6">
        {/* Human-in-the-loop Invariant Banner */}
        <div className="rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-slate-900/40 p-4 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold text-cyan-300 me-2">مبدأ الإنسان في الحلقة:</span>
            <span className="text-slate-300" dir="auto">{t("app.humanInTheLoopNotice")}</span>
          </div>
        </div>

        {/* Hero Section */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 sm:p-12 text-center flex flex-col items-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 mb-6">
            <Globe className="w-3.5 h-3.5" />
            <span>عربي مصري + English Code-Switching</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
            {t("app.tagline")}
          </h1>
          <p className="text-base sm:text-lg text-slate-400 max-w-2xl mb-8 leading-relaxed" dir="auto">
            {t("app.description")}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-3xl text-start">
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="text-xs text-slate-400 mb-1">{t("nav.dashboard")}</div>
              <div className="text-sm font-semibold text-white">الملخصات والمهام</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="text-xs text-slate-400 mb-1">{t("nav.meetings")}</div>
              <div className="text-sm font-semibold text-white">تسجيل ورفع الصوت</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="text-xs text-slate-400 mb-1">{t("nav.calendar")}</div>
              <div className="text-sm font-semibold text-white">Google Calendar</div>
            </div>
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60">
              <div className="text-xs text-slate-400 mb-1">{t("nav.proposals")}</div>
              <div className="text-sm font-semibold text-white">صندوق الاعتماد</div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-6 text-center text-xs text-slate-500">
        <div>دوّن (Dawwen) — AI Meeting Assistant • Phase 0 Foundation</div>
      </footer>
    </div>
  );
}
