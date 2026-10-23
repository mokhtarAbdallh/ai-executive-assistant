import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  CreditCard,
  Inbox,
  LayoutList,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { cn } from "../lib/cn";
import type { Theme } from "../lib/theme";
import { Wordmark } from "./Wordmark";
import { Button, CountBadge, IconButton, Modal } from "./ui";

export type AppView = "meetings" | "calendar" | "proposals" | "chat" | "billing" | "settings";

type Health = "connecting" | "connected" | "offline";

interface NavEntry {
  view: AppView;
  labelKey: string;
  icon: ReactNode;
}

const PRIMARY_NAV: NavEntry[] = [
  { view: "meetings", labelKey: "nav.meetings", icon: <LayoutList /> },
  { view: "calendar", labelKey: "nav.calendar", icon: <CalendarDays /> },
  { view: "proposals", labelKey: "nav.proposals", icon: <Inbox /> },
  { view: "chat", labelKey: "nav.ask", icon: <Sparkles /> },
];

const SECONDARY_NAV: NavEntry[] = [
  { view: "billing", labelKey: "nav.billing", icon: <CreditCard /> },
  { view: "settings", labelKey: "nav.settings", icon: <Settings /> },
];

const HEALTH_DOT: Record<Health, string> = {
  connecting: "bg-warning animate-pulse-soft",
  connected: "bg-success",
  offline: "bg-danger",
};

interface AppShellProps {
  view: AppView;
  pendingProposals: number;
  health: Health;
  theme: Theme;
  language: "ar" | "en";
  onNavigate: (view: AppView) => void;
  onNewMeeting: () => void;
  onOpenSearch: () => void;
  onToggleTheme: () => void;
  onChangeLanguage: (language: "ar" | "en") => void;
  children: ReactNode;
}

export function AppShell({
  view,
  pendingProposals,
  health,
  theme,
  language,
  onNavigate,
  onNewMeeting,
  onOpenSearch,
  onToggleTheme,
  onChangeLanguage,
  children,
}: AppShellProps) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);

  const healthLabel = t(`health.${health}`);
  const themeLabel = theme === "dark" ? t("theme.toggleToLight") : t("theme.toggleToDark");

  const renderNavItem = (entry: NavEntry, mobile = false) => {
    const active = view === entry.view;
    const badge = entry.view === "proposals" ? pendingProposals : 0;

    return (
      <button
        key={entry.view}
        type="button"
        data-nav={entry.view}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          onNavigate(entry.view);
          setMoreOpen(false);
        }}
        className={cn(
          "group flex items-center gap-3 rounded-lg text-sm transition-colors",
          mobile ? "flex-col gap-1 rounded-xl px-2 py-1.5 text-[11px]" : "h-10 w-full px-3",
          active
            ? mobile
              ? "text-brand"
              : "bg-brand/10 font-medium text-brand"
            : mobile
              ? "text-fg-subtle hover:text-fg"
              : "text-fg-muted hover:bg-raised hover:text-fg",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "[&>svg]:h-4 [&>svg]:w-4",
            mobile && "[&>svg]:h-5 [&>svg]:w-5",
            active ? "text-brand" : "text-fg-subtle group-hover:text-fg",
          )}
        >
          {entry.icon}
        </span>
        <span className={cn("whitespace-nowrap", !mobile && "flex-1 text-start")}>
          {mobile ? (
            <span className="inline-flex items-center gap-1">
              {t(entry.labelKey)}
              {badge > 0 ? (
                <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
              ) : null}
            </span>
          ) : (
            t(entry.labelKey)
          )}
        </span>
        {!mobile && badge > 0 ? <CountBadge count={badge} tone="brand" /> : null}
      </button>
    );
  };

  return (
    <div className="min-h-dvh bg-app">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-brand-fg"
      >
        {t("common.skipToContent")}
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-e border-line bg-surface lg:flex">
        <div className="flex h-[var(--header-h)] items-center px-5">
          <Wordmark />
        </div>

        <nav aria-label={t("nav.primary")} className="flex flex-col gap-1 px-3 pt-2">
          {PRIMARY_NAV.map((entry) => renderNavItem(entry))}
        </nav>

        <div className="mx-5 my-4 h-px bg-line" />

        <nav aria-label={t("nav.account")} className="flex flex-col gap-1 px-3">
          {SECONDARY_NAV.map((entry) => renderNavItem(entry))}
        </nav>

        <div className="mt-auto space-y-3 border-t border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <LanguageSwitch language={language} onChange={onChangeLanguage} />
            <IconButton
              label={themeLabel}
              icon={theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              onClick={onToggleTheme}
            />
          </div>

          <div
            className="flex items-center gap-2 px-1 text-xs text-fg-subtle"
            title={t("health.hint")}
          >
            <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[health])} />
            <span>{healthLabel}</span>
          </div>
        </div>
      </aside>

      <div className="lg:ps-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-[var(--header-h)] items-center gap-2 border-b border-line bg-app/85 px-4 backdrop-blur sm:px-6">
          <div className="lg:hidden">
            <Wordmark />
          </div>

          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSearch}
              className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-xs text-fg-subtle transition-colors hover:border-line-strong hover:text-fg-muted md:flex xl:w-72"
            >
              <Search aria-hidden className="h-4 w-4" />
              <span className="flex-1 text-start">{t("search.trigger")}</span>
              <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 text-[11px] tabular text-fg-subtle">
                Ctrl K
              </kbd>
            </button>

            <IconButton
              label={t("search.trigger")}
              icon={<Search className="h-4 w-4" />}
              onClick={onOpenSearch}
              className="md:hidden"
            />
            <IconButton
              label={themeLabel}
              icon={theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              onClick={onToggleTheme}
              className="lg:hidden"
            />

            <Button
              variant="primary"
              size="md"
              className="hidden sm:inline-flex"
              icon={<Plus className="h-4 w-4" />}
              onClick={onNewMeeting}
            >
              {t("nav.newMeeting")}
            </Button>
            <Button
              variant="primary"
              size="icon"
              className="sm:hidden"
              aria-label={t("nav.newMeeting")}
              onClick={onNewMeeting}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main
          id="main-content"
          className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-5 sm:px-6 lg:pb-14"
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav
        aria-label={t("nav.primary")}
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-1 border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur lg:hidden"
      >
        {PRIMARY_NAV.map((entry) => renderNavItem(entry, true))}
        <button
          type="button"
          data-nav="more"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "flex flex-1 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[11px] transition-colors",
            ["billing", "settings"].includes(view) ? "text-brand" : "text-fg-subtle hover:text-fg",
          )}
        >
          <Menu aria-hidden className="h-5 w-5" />
          <span>{t("nav.more")}</span>
        </button>
      </nav>

      <Modal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={t("nav.more")}
        placement="bottom"
        bodyClassName="space-y-2"
      >
        {SECONDARY_NAV.map((entry) => (
          <button
            key={entry.view}
            type="button"
            onClick={() => {
              onNavigate(entry.view);
              setMoreOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 text-sm text-fg transition-colors hover:border-line-strong"
          >
            <span aria-hidden className="text-fg-subtle [&>svg]:h-4 [&>svg]:w-4">
              {entry.icon}
            </span>
            {t(entry.labelKey)}
          </button>
        ))}

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
          <span className="text-sm text-fg-muted">{t("theme.label")}</span>
          <Button
            variant="secondary"
            size="sm"
            icon={theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            onClick={onToggleTheme}
          >
            {theme === "dark" ? t("theme.light") : t("theme.dark")}
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
          <span className="text-sm text-fg-muted">{t("language.label")}</span>
          <LanguageSwitch language={language} onChange={onChangeLanguage} />
        </div>

        <p className="flex items-center gap-2 px-1 pt-1 text-xs text-fg-subtle">
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", HEALTH_DOT[health])} />
          {healthLabel}
        </p>
      </Modal>
    </div>
  );
}

function LanguageSwitch({
  language,
  onChange,
}: {
  language: "ar" | "en";
  onChange: (language: "ar" | "en") => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className="flex items-center rounded-lg border border-line bg-surface p-0.5"
    >
      {(["ar", "en"] as const).map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => onChange(code)}
          aria-pressed={language === code}
          className={cn(
            "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors",
            language === code ? "bg-raised text-fg" : "text-fg-subtle hover:text-fg",
          )}
        >
          {code === "ar" ? t("language.arabicShort") : t("language.englishShort")}
        </button>
      ))}
    </div>
  );
}
