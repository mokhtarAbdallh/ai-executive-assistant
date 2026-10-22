import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Navbar } from "./components/Navbar";
import { MeetingsList } from "./components/MeetingsList";
import { MeetingDetail } from "./components/MeetingDetail";
import { NewMeetingModal } from "./components/NewMeetingModal";
import { CalendarView } from "./components/CalendarView";
import { ProposalsInbox } from "./components/ProposalsInbox";
import { AskChat } from "./components/AskChat";
import { SearchModal } from "./components/SearchModal";
import { BillingView } from "./components/BillingView";
import { SettingsView } from "./components/SettingsView";
import {
  fetchHealth,
  fetchMeetings,
  fetchMeetingDetail,
  deleteMeeting,
  createMeeting,
  processDemoMeeting,
} from "./api";
import type { MeetingSummary, MeetingDetail as MeetingDetailType, SearchCitation } from "./types";

export function App() {
  const { i18n } = useTranslation();

  // Navigation State
  const [currentView, setCurrentView] = useState<
    "list" | "detail" | "calendar" | "proposals" | "chat" | "billing" | "settings"
  >("list");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [pendingProposalsCount, setPendingProposalsCount] = useState<number>(2);

  // Data State
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [activeMeetingDetail, setActiveMeetingDetail] = useState<MeetingDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isNewMeetingOpen, setIsNewMeetingOpen] = useState(false);
  const [initialMeetingTitle, setInitialMeetingTitle] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);

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

  // Global Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

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
      setError(err instanceof Error ? err.message : "فشل تحميل تفاصيل الاجتماع");
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
        setSelectedMeetingId(null);
        setActiveMeetingDetail(null);
        setCurrentView("list");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "فشل حذف الاجتماع");
    }
  };

  // Load demo meeting directly
  const handleLoadDemoMeeting = async () => {
    setIsLoading(true);
    try {
      const created = await createMeeting({
        title: "اجتماع تسعير الباقات وسبرنت الـ Agent (Demo)",
        language: "mixed",
      });
      const processed = await processDemoMeeting(created.id);
      setActiveMeetingDetail(processed);
      setSelectedMeetingId(processed.id);
      setCurrentView("detail");
      void loadMeetings();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "فشل تحميل الاجتماع التجريبي");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchResultClick = (citation: SearchCitation) => {
    void handleSelectMeeting(citation.meetingId);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20 selection:text-cyan-200">
      {/* Top Navbar */}
      <Navbar
        healthStatus={healthStatus}
        uptime={uptime}
        currentView={currentView}
        pendingProposalsCount={pendingProposalsCount}
        onNavigate={(view) => {
          setCurrentView(view);
          if (view === "list") setSelectedMeetingId(null);
        }}
        onNewMeetingClick={() => {
          setInitialMeetingTitle("");
          setIsNewMeetingOpen(true);
        }}
        onHomeClick={() => {
          setCurrentView("list");
          setSelectedMeetingId(null);
          void loadMeetings();
        }}
        onSearchClick={() => setIsSearchOpen(true)}
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
        ) : currentView === "calendar" ? (
          <CalendarView
            onStartRecordingForMeeting={(title) => {
              setInitialMeetingTitle(title);
              setIsNewMeetingOpen(true);
            }}
            onOpenMeetingDetail={handleSelectMeeting}
          />
        ) : currentView === "proposals" ? (
          <ProposalsInbox
            onProposalsCountChange={setPendingProposalsCount}
            onNavigateToCalendar={() => setCurrentView("calendar")}
          />
        ) : currentView === "chat" ? (
          <div className="h-[750px] w-full flex flex-col">
            <AskChat
              onCitationClick={handleSearchResultClick}
              onProposalApproved={() => {
                setPendingProposalsCount((prev) => Math.max(0, prev - 1));
              }}
            />
          </div>
        ) : currentView === "billing" ? (
          <BillingView />
        ) : currentView === "settings" ? (
          <SettingsView />
        ) : (
          <MeetingsList
            meetings={meetings}
            isLoading={isLoading}
            error={error}
            onSelectMeeting={handleSelectMeeting}
            onDeleteMeeting={handleDeleteMeeting}
            onNewMeetingClick={() => {
              setInitialMeetingTitle("");
              setIsNewMeetingOpen(true);
            }}
            onLoadDemoClick={handleLoadDemoMeeting}
            onRetry={loadMeetings}
          />
        )}
      </main>

      {/* Global Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectResult={handleSearchResultClick}
      />

      {/* New Meeting Modal */}
      <NewMeetingModal
        isOpen={isNewMeetingOpen}
        initialTitle={initialMeetingTitle}
        onClose={() => {
          setIsNewMeetingOpen(false);
          setInitialMeetingTitle("");
        }}
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
            دوّن (Dawwen) — المساعد الذكي للاجتماعات • المرحلة السادسة (Billing & Settings)
          </div>
          <div className="text-[11px] text-slate-500">
            RTL-First • Egyptian Arabic & English Code-Switching • Human-In-The-Loop • Pay-As-You-Go
          </div>
        </div>
      </footer>
    </div>
  );
}
