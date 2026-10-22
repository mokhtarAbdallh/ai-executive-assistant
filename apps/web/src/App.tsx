import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Navbar } from "./components/Navbar";
import { MeetingsList } from "./components/MeetingsList";
import { MeetingDetail } from "./components/MeetingDetail";
import { NewMeetingModal } from "./components/NewMeetingModal";
import {
  fetchHealth,
  fetchMeetings,
  fetchMeetingDetail,
  deleteMeeting,
  createMeeting,
  processDemoMeeting,
} from "./api";
import type { MeetingSummary, MeetingDetail as MeetingDetailType } from "./types";

export function App() {
  const { i18n } = useTranslation();

  // Navigation State
  const [currentView, setCurrentView] = useState<"list" | "detail">("list");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  // Data State
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [activeMeetingDetail, setActiveMeetingDetail] = useState<MeetingDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isNewMeetingOpen, setIsNewMeetingOpen] = useState(false);

  // Health State
  const [healthStatus, setHealthStatus] = useState<"connecting" | "connected" | "offline">(
    "connecting",
  );
  const [uptime, setUptime] = useState<number | null>(null);

  // Sync HTML lang and dir attribute with i18n
  useEffect(() => {
    const dir = i18n.dir();
    const lang = i18n.language;
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
  }, [i18n, i18n.language]);

  // Load meetings
  const loadMeetings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchMeetings();
      setMeetings(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "فشل الاتصال بالخادم");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check health periodically
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await fetchHealth();
        if (mounted && res.status === "ok") {
          setHealthStatus("connected");
          setUptime(res.uptimeSeconds ?? null);
          return;
        }
        if (mounted) setHealthStatus("offline");
      } catch {
        if (mounted) setHealthStatus("offline");
      }
    };

    void check();
    const interval = setInterval(() => void check(), 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Initial load
  useEffect(() => {
    void loadMeetings();
  }, [loadMeetings]);

  // View detail
  const handleSelectMeeting = async (id: string) => {
    setSelectedMeetingId(id);
    setIsLoading(true);
    try {
      const detail = await fetchMeetingDetail(id);
      setActiveMeetingDetail(detail);
      setCurrentView("detail");
    } catch (err: unknown) {
      alert("تعذر جلب تفاصيل الاجتماع: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  // Delete meeting
  const handleDeleteMeeting = async (id: string) => {
    try {
      await deleteMeeting(id);
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      if (selectedMeetingId === id) {
        setCurrentView("list");
        setActiveMeetingDetail(null);
      }
    } catch (err: unknown) {
      alert("فشل حذف الاجتماع: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // Load Demo Meeting Shortcut
  const handleLoadDemoMeeting = async () => {
    setIsLoading(true);
    try {
      const created = await createMeeting({
        title: "اجتماع السبرنت التجريبي — التحقق من الـ Auth والـ Bedrock Pipeline",
        language: "mixed",
      });
      const processed = await processDemoMeeting(created.id);
      setActiveMeetingDetail(processed);
      setSelectedMeetingId(processed.id);
      setCurrentView("detail");
      void loadMeetings();
    } catch (err: unknown) {
      alert("حدث خطأ أثناء تشغيل الديمو التجريبي: " + (err instanceof Error ? err.message : String(err)));
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500 selection:text-white antialiased">
      {/* Navigation Bar */}
      <Navbar
        healthStatus={healthStatus}
        uptime={uptime}
        onNewMeetingClick={() => setIsNewMeetingOpen(true)}
        onHomeClick={() => {
          setCurrentView("list");
          setSelectedMeetingId(null);
          void loadMeetings();
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex flex-col">
        {currentView === "detail" && activeMeetingDetail ? (
          <MeetingDetail
            meeting={activeMeetingDetail}
            onBack={() => {
              setCurrentView("list");
              setSelectedMeetingId(null);
              void loadMeetings();
            }}
            onMeetingUpdated={(updated) => {
              setActiveMeetingDetail(updated);
              setMeetings((prev) =>
                prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)),
              );
            }}
          />
        ) : (
          <MeetingsList
            meetings={meetings}
            isLoading={isLoading}
            error={error}
            onSelectMeeting={handleSelectMeeting}
            onDeleteMeeting={handleDeleteMeeting}
            onNewMeetingClick={() => setIsNewMeetingOpen(true)}
            onLoadDemoClick={handleLoadDemoMeeting}
            onRetry={loadMeetings}
          />
        )}
      </main>

      {/* New Meeting Modal */}
      <NewMeetingModal
        isOpen={isNewMeetingOpen}
        onClose={() => setIsNewMeetingOpen(false)}
        onMeetingCreated={(createdMeeting) => {
          setActiveMeetingDetail(createdMeeting);
          setSelectedMeetingId(createdMeeting.id);
          setCurrentView("detail");
          void loadMeetings();
        }}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            دوّن (Dawwen) — المساعد الذكي للاجتماعات • المرحلة الثالثة (Meetings UI & Review)
          </div>
          <div className="text-[11px] text-slate-500">
            RTL-First • Egyptian Arabic & English Code-Switching • Human-In-The-Loop
          </div>
        </div>
      </footer>
    </div>
  );
}
