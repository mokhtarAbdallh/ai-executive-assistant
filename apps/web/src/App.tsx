import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell, type AppView } from "./components/AppShell";
import { MeetingsList } from "./components/MeetingsList";
import { MeetingDetail, type MeetingTab } from "./components/MeetingDetail";
import { NewMeetingModal } from "./components/NewMeetingModal";
import { CalendarView } from "./components/CalendarView";
import { ProposalsInbox } from "./components/ProposalsInbox";
import { AskChat } from "./components/AskChat";
import { SearchModal } from "./components/SearchModal";
import { BillingView } from "./components/BillingView";
import { SettingsView } from "./components/SettingsView";
import { Skeleton, ToastProvider, useToast } from "./components/ui";
import {
  createMeeting,
  deleteMeeting,
  fetchHealth,
  fetchMeetingDetail,
  fetchMeetings,
  fetchProposals,
  processDemoMeeting,
} from "./api";
import { setLanguage } from "./i18n";
import { useTheme } from "./lib/theme";
import type { MeetingDetail as MeetingDetailType, MeetingSummary, SearchCitation } from "./types";

type View = AppView | "detail";

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const [view, setView] = useState<View>("meetings");
  const [meetingTab, setMeetingTab] = useState<MeetingTab>("summary");
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [pendingProposalsCount, setPendingProposalsCount] = useState(0);

  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [activeMeetingDetail, setActiveMeetingDetail] = useState<MeetingDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newMeetingOpen, setNewMeetingOpen] = useState(false);
  const [initialMeetingTitle, setInitialMeetingTitle] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [healthStatus, setHealthStatus] = useState<"connecting" | "connected" | "offline">(
    "connecting",
  );

  const language = i18n.language.startsWith("en") ? "en" : "ar";

  const loadMeetings = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setMeetings(await fetchMeetings());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("errors.generic"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const loadPendingProposals = useCallback(async () => {
    try {
      const proposals = await fetchProposals();
      setPendingProposalsCount(
        proposals.filter((proposal) => proposal.status === "PENDING_APPROVAL").length,
      );
    } catch {
      // The inbox is the source of truth; a failed badge is not worth an error toast.
    }
  }, []);

  useEffect(() => {
    void loadMeetings();
    void loadPendingProposals();
  }, [loadMeetings, loadPendingProposals]);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const result = await fetchHealth();
      if (mounted) setHealthStatus(result.status === "ok" ? "connected" : "offline");
    };
    void check();
    const interval = window.setInterval(() => void check(), 15_000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const openMeeting = useCallback(
    async (id: string, tab: MeetingTab = "summary") => {
      setSelectedMeetingId(id);
      setMeetingTab(tab);
      setDetailLoading(true);
      try {
        const detail = await fetchMeetingDetail(id);
        setActiveMeetingDetail(detail);
        setView("detail");
      } catch {
        toast({ title: t("meeting.loadFailed"), tone: "error" });
      } finally {
        setDetailLoading(false);
      }
    },
    [t, toast],
  );

  const handleDeleteMeeting = async (id: string) => {
    await deleteMeeting(id);
    setMeetings((current) => current.filter((meeting) => meeting.id !== id));
    if (selectedMeetingId === id) {
      setSelectedMeetingId(null);
      setActiveMeetingDetail(null);
      setView("meetings");
    }
    void loadPendingProposals();
  };

  const handleLoadDemo = async () => {
    try {
      const created = await createMeeting({
        title: t("dashboard.demoMeetingTitle"),
        language: "mixed",
      });
      const processed = await processDemoMeeting(created.id);
      setActiveMeetingDetail(processed);
      setSelectedMeetingId(processed.id);
      setMeetingTab("summary");
      setView("detail");
      await loadMeetings();
      toast({ title: t("dashboard.demoLoaded"), tone: "success" });
    } catch {
      toast({ title: t("dashboard.demoFailed"), tone: "error" });
    }
  };

  const handleNewMeetingClick = () => {
    setInitialMeetingTitle("");
    setNewMeetingOpen(true);
  };

  const handleNavigate = (next: AppView) => {
    setView(next);
    if (next === "meetings") {
      setSelectedMeetingId(null);
      setActiveMeetingDetail(null);
      void loadMeetings();
    }
  };

  const onSearchResult = (citation: SearchCitation) => {
    void openMeeting(citation.meetingId);
  };

  return (
    <AppShell
      view={view === "detail" ? "meetings" : view}
      pendingProposals={pendingProposalsCount}
      health={healthStatus}
      theme={theme}
      language={language}
      onNavigate={handleNavigate}
      onNewMeeting={handleNewMeetingClick}
      onOpenSearch={() => setSearchOpen(true)}
      onToggleTheme={toggleTheme}
      onChangeLanguage={(next) => setLanguage(next)}
    >
      <div key={view} className="animate-page">
        {view === "detail" ? (
          detailLoading || !activeMeetingDetail ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-16 w-3/4" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-64 w-full rounded-card" />
            </div>
          ) : (
            <MeetingDetail
              key={`${activeMeetingDetail.id}-${meetingTab}`}
              meeting={activeMeetingDetail}
              initialTab={meetingTab}
              onBack={() => {
                setView("meetings");
                setSelectedMeetingId(null);
                setActiveMeetingDetail(null);
                void loadMeetings();
              }}
              onMeetingUpdated={(updated) => {
                setActiveMeetingDetail(updated);
                setMeetings((current) =>
                  current.map((meeting) =>
                    meeting.id === updated.id
                      ? {
                          ...meeting,
                          title: updated.title,
                          status: updated.status,
                          _count: {
                            tasks: updated.tasks.length,
                            decisions: updated.decisions.length,
                            transcriptSegments: updated.transcriptSegments.length,
                          },
                        }
                      : meeting,
                  ),
                );
              }}
            />
          )
        ) : view === "calendar" ? (
          <CalendarView
            onStartRecordingForMeeting={(title) => {
              setInitialMeetingTitle(title);
              setNewMeetingOpen(true);
            }}
            onOpenMeetingDetail={(id) => void openMeeting(id)}
          />
        ) : view === "proposals" ? (
          <ProposalsInbox
            onProposalsCountChange={setPendingProposalsCount}
            onNavigateToCalendar={() => setView("calendar")}
          />
        ) : view === "chat" ? (
          <div className="min-h-[540px]">
            <AskChat
              className="h-[calc(100dvh-13rem)] min-h-[540px]"
              onCitationClick={onSearchResult}
              onProposalApproved={() => void loadPendingProposals()}
            />
          </div>
        ) : view === "billing" ? (
          <BillingView />
        ) : view === "settings" ? (
          <SettingsView />
        ) : (
          <MeetingsList
            meetings={meetings}
            isLoading={isLoading}
            error={error}
            pendingProposals={pendingProposalsCount}
            onSelectMeeting={(id) => void openMeeting(id)}
            onDeleteMeeting={handleDeleteMeeting}
            onNewMeetingClick={handleNewMeetingClick}
            onLoadDemoClick={handleLoadDemo}
            onRetry={loadMeetings}
            onOpenProposals={() => setView("proposals")}
          />
        )}
      </div>

      <SearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectResult={onSearchResult}
      />

      <NewMeetingModal
        isOpen={newMeetingOpen}
        initialTitle={initialMeetingTitle}
        onClose={() => {
          setNewMeetingOpen(false);
          setInitialMeetingTitle("");
        }}
        onMeetingCreated={(created) => {
          setActiveMeetingDetail(created);
          setSelectedMeetingId(created.id);
          setMeetingTab("summary");
          setView("detail");
          void loadMeetings();
        }}
      />
    </AppShell>
  );
}
