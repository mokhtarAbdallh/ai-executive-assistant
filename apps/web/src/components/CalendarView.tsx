import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import arLocale from "@fullcalendar/core/locales/ar";
import type { DatesSetArg, EventClickArg, EventContentArg } from "@fullcalendar/core";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Link2,
  MapPin,
  Mic,
  RefreshCw,
  Rows3,
  Unlink,
  Users,
} from "lucide-react";
import type { CalendarConnectionStatus, CalendarEventItem } from "../types";
import {
  connectCalendar,
  disconnectCalendar,
  fetchCalendarEvents,
  fetchCalendarStatus,
  syncCalendar,
} from "../api";
import { formatDate, formatDateTime, formatMonthYear, formatTime } from "../lib/format";
import { cn } from "../lib/cn";
import { CalendarStatusBadge } from "./CalendarStatusBadge";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Segmented,
  Skeleton,
  useToast,
} from "./ui";

type CalView = "month" | "week" | "list";

const EVENT_TIME_FORMAT = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  meridiem: "short",
} as const;

interface CalendarViewProps {
  onStartRecordingForMeeting: (title: string) => void;
  onOpenMeetingDetail: (meetingId: string) => void;
}

export function CalendarView({
  onStartRecordingForMeeting,
  onOpenMeetingDetail,
}: CalendarViewProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { toast } = useToast();

  const calendarRef = useRef<FullCalendar>(null);
  const [view, setView] = useState<CalView>(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches
      ? "list"
      : "month",
  );
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [status, setStatus] = useState<CalendarConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventItem | null>(null);
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eventList, connection] = await Promise.all([
        fetchCalendarEvents(),
        fetchCalendarStatus(),
      ]);
      setEvents(eventList);
      setStatus(connection);
    } catch {
      toast({ title: t("calendar.loadFailed"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const api = calendarRef.current?.getApi();
    if (!api || view === "list") return;
    const nextView = view === "month" ? "dayGridMonth" : "timeGridWeek";
    if (api.view.type !== nextView) api.changeView(nextView);
  }, [view]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncCalendar();
      setEvents(await fetchCalendarEvents());
      setStatus((current) =>
        current ? { ...current, lastSyncedAt: result.lastSyncedAt, connected: true } : current,
      );
      toast({ title: t("calendar.synced"), tone: "success" });
    } catch {
      toast({ title: t("calendar.syncFailed"), tone: "error" });
    } finally {
      setSyncing(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connectCalendar();
      setStatus(await fetchCalendarStatus());
      setEvents(await fetchCalendarEvents());
      toast({ title: t("calendar.connected"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectCalendar();
      setStatus((current) =>
        current
          ? { ...current, connected: false, lastSyncedAt: null }
          : { connected: false, provider: "google", lastSyncedAt: null },
      );
      toast({ title: t("calendar.disconnected"), tone: "info" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setDisconnectOpen(false);
    }
  };

  const fcEvents = useMemo(
    () =>
      events.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        classNames: [`status-${event.status}`],
        extendedProps: { status: event.status },
      })),
    [events],
  );

  const filteredForList = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events
      .filter((event) => (term ? event.title.toLowerCase().includes(term) : true))
      .slice()
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }, [events, search]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CalendarEventItem[]>();
    for (const event of filteredForList) {
      const key = formatDate(event.start, lang, "long");
      const bucket = groups.get(key);
      if (bucket) bucket.push(event);
      else groups.set(key, [event]);
    }
    return Array.from(groups.entries());
  }, [filteredForList, lang]);

  const onEventClick = useCallback(
    (arg: EventClickArg) => {
      const match = events.find((event) => event.id === arg.event.id);
      if (match) setSelectedEvent(match);
    },
    [events],
  );

  const onDatesSet = useCallback((arg: DatesSetArg) => {
    const next = arg.view.currentStart;
    setMonthDate((current) => (current.getTime() === next.getTime() ? current : next));
  }, []);

  // FullCalendar re-runs custom renderers whenever their identity changes; an inline
  // function here causes an infinite render/update loop.
  const renderEventContent = useCallback(
    (arg: EventContentArg) => (
      <div className="flex min-w-0 items-center gap-1.5 px-0.5">
        {arg.view.type === "timeGridWeek" && arg.timeText ? (
          <span className="shrink-0 text-[10px] tabular opacity-80">{arg.timeText}</span>
        ) : null}
        <span className="truncate text-[11px] font-medium" dir="auto">
          {arg.event.title}
        </span>
      </div>
    ),
    [],
  );

  const shift = (direction: -1 | 1) => {
    const api = calendarRef.current?.getApi();
    if (!api) return;
    if (direction === -1) api.prev();
    else api.next();
  };

  const connected = status?.connected ?? false;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t("calendar.title")}</h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted sm:text-sm">
            {t("calendar.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {connected ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                loading={syncing}
                onClick={handleSync}
              >
                {t("calendar.sync")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Unlink className="h-3.5 w-3.5" />}
                onClick={() => setDisconnectOpen(true)}
              >
                {t("calendar.disconnect")}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={<Link2 className="h-3.5 w-3.5" />}
              loading={connecting}
              onClick={handleConnect}
            >
              {t("calendar.connect")}
            </Button>
          )}
        </div>
      </header>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <IconButton
              label={t("calendar.previous")}
              icon={<ChevronRight className="h-4 w-4 ltr:rotate-180" />}
              onClick={() => shift(-1)}
              disabled={view === "list"}
            />
            <h2 className="min-w-36 text-center text-sm font-semibold tabular">
              {formatMonthYear(monthDate, lang)}
            </h2>
            <IconButton
              label={t("calendar.next")}
              icon={<ChevronLeft className="h-4 w-4 ltr:rotate-180" />}
              onClick={() => shift(1)}
              disabled={view === "list"}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                calendarRef.current?.getApi().today();
                setMonthDate(new Date());
              }}
              disabled={view === "list"}
            >
              {t("calendar.today")}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel={t("calendar.viewLabel")}
              value={view}
              onChange={setView}
              options={[
                { value: "month", label: t("calendar.viewMonth") },
                { value: "week", label: t("calendar.viewWeek") },
                { value: "list", label: t("calendar.viewList") },
              ]}
            />
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-success" : "bg-warning")}
              />
              {connected
                ? t("calendar.lastSynced", {
                    time: status?.lastSyncedAt ? formatTime(status.lastSyncedAt, lang) : "—",
                  })
                : t("calendar.notConnected")}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-2 p-4 sm:grid-cols-7">
            {Array.from({ length: 28 }).map((_, index) => (
              <Skeleton key={index} className="h-16" />
            ))}
          </div>
        ) : view === "list" ? (
          <div className="p-3 sm:p-4">
            <div className="relative mb-3 max-w-sm">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("calendar.searchPlaceholder")}
                aria-label={t("calendar.searchPlaceholder")}
                className="ps-3"
              />
            </div>

            {grouped.length === 0 ? (
              <EmptyState
                icon={<CalendarDays />}
                title={t("calendar.emptyTitle")}
                description={t("calendar.emptyBody")}
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<CalendarPlus className="h-4 w-4" />}
                    onClick={() => onStartRecordingForMeeting("")}
                  >
                    {t("calendar.schedule")}
                  </Button>
                }
                className="border-0 bg-transparent"
              />
            ) : (
              <div className="space-y-5">
                {grouped.map(([day, dayEvents]) => (
                  <section key={day}>
                    <h3 className="mb-2 text-xs font-medium text-fg-muted">{day}</h3>
                    <ul className="space-y-2">
                      {dayEvents.map((event) => (
                        <li key={event.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedEvent(event)}
                            className="flex w-full items-start gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-start transition-colors hover:border-line-strong hover:bg-raised/40"
                          >
                            <span className="mt-0.5 tabular text-xs font-medium text-fg-muted">
                              {formatTime(event.start, lang)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span
                                className="block truncate text-sm font-medium text-fg"
                                dir="auto"
                              >
                                {event.title}
                              </span>
                              {event.location ? (
                                <span className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle">
                                  <MapPin aria-hidden className="h-3 w-3" />
                                  <span className="truncate" dir="auto">
                                    {event.location}
                                  </span>
                                </span>
                              ) : null}
                            </span>
                            <CalendarStatusBadge status={event.status} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="dawwen-calendar p-1 sm:p-2">
            <FullCalendar
              key={`${i18n.language}-${view}`}
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={view === "week" ? "timeGridWeek" : "dayGridMonth"}
              locale={lang === "ar" ? "ar" : "en"}
              locales={[arLocale]}
              direction={i18n.dir()}
              firstDay={6}
              height="auto"
              expandRows
              fixedWeekCount={false}
              dayMaxEvents={3}
              eventDisplay="block"
              headerToolbar={false}
              events={fcEvents}
              eventClick={onEventClick}
              datesSet={onDatesSet}
              eventTimeFormat={EVENT_TIME_FORMAT}
              eventContent={renderEventContent}
            />
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-subtle">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-brand" />
          {t("calendar.legendScheduled")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-success" />
          {t("calendar.legendSummarized")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-info" />
          {t("calendar.legendProcessing")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-warning" />
          {t("calendar.legendReview")}
        </span>
      </div>

      <Modal
        open={selectedEvent !== null}
        onClose={() => setSelectedEvent(null)}
        placement="end"
        title={selectedEvent?.title ?? ""}
        footer={
          selectedEvent ? (
            <>
              {selectedEvent.htmlLink ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ExternalLink className="h-3.5 w-3.5" />}
                  onClick={() =>
                    window.open(selectedEvent.htmlLink, "_blank", "noopener,noreferrer")
                  }
                >
                  {t("calendar.openInGoogle")}
                </Button>
              ) : null}
              {selectedEvent.meetingId ? (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Rows3 className="h-3.5 w-3.5" />}
                  onClick={() => {
                    onOpenMeetingDetail(selectedEvent.meetingId as string);
                    setSelectedEvent(null);
                  }}
                >
                  {t("calendar.openMeeting")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Mic className="h-3.5 w-3.5" />}
                  onClick={() => {
                    onStartRecordingForMeeting(selectedEvent.title);
                    setSelectedEvent(null);
                  }}
                >
                  {t("calendar.recordThis")}
                </Button>
              )}
            </>
          ) : null
        }
      >
        {selectedEvent ? (
          <div className="space-y-4">
            <CalendarStatusBadge status={selectedEvent.status} />

            <div className="space-y-2.5 text-sm">
              <p className="flex items-start gap-2 text-fg-muted">
                <Clock3 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="tabular">
                  {formatDateTime(selectedEvent.start, lang)} —{" "}
                  {formatTime(selectedEvent.end, lang)}
                </span>
              </p>
              {selectedEvent.location ? (
                <p className="flex items-start gap-2 text-fg-muted">
                  <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <span dir="auto">{selectedEvent.location}</span>
                </p>
              ) : null}
              {selectedEvent.attendees && selectedEvent.attendees.length > 0 ? (
                <p className="flex items-start gap-2 text-fg-muted">
                  <Users aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all" dir="ltr">
                    {selectedEvent.attendees.join(" · ")}
                  </span>
                </p>
              ) : null}
            </div>

            {selectedEvent.description ? (
              <p
                className="rounded-xl border border-line bg-raised/40 p-3 text-xs leading-relaxed text-fg-muted"
                dir="auto"
              >
                {selectedEvent.description}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={disconnectOpen}
        title={t("calendar.disconnectTitle")}
        description={t("calendar.disconnectBody")}
        confirmLabel={t("calendar.disconnect")}
        onConfirm={handleDisconnect}
        onClose={() => setDisconnectOpen(false)}
      />
    </div>
  );
}
