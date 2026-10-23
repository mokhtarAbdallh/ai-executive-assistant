import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock3,
  Download,
  Globe2,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { deleteAccount, exportAccountData, fetchSettings, updateSettings } from "../api";
import type { UserSettings } from "../types";
import { setLanguage } from "../i18n";
import { formatNumber } from "../lib/format";
import { cn } from "../lib/cn";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Field,
  Select,
  Skeleton,
  useToast,
} from "./ui";

const TIMEZONES = [
  { value: "Africa/Cairo", labelKey: "settings.tzCairo" },
  { value: "Asia/Riyadh", labelKey: "settings.tzRiyadh" },
  { value: "Asia/Dubai", labelKey: "settings.tzDubai" },
  { value: "UTC", labelKey: "settings.tzUtc" },
  { value: "Europe/London", labelKey: "settings.tzLondon" },
  { value: "America/New_York", labelKey: "settings.tzNewYork" },
];

const RETENTION_OPTIONS = [0, 7, 30] as const;

export function SettingsView() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { toast } = useToast();

  const [settings, setSettings] = useState<UserSettings>({
    language: "ar",
    timezone: "Africa/Cairo",
    audioRetentionDays: 7,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchSettings();
        setSettings(data.settings);
      } catch {
        toast({ title: t("errors.generic"), tone: "error" });
      } finally {
        setLoading(false);
      }
    };
    void load();
    // Load once on mount; toast is stable enough for this one-shot fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const result = await updateSettings(settings);
      setSettings(result.settings);
      if (result.settings.language && result.settings.language !== i18n.language) {
        setLanguage(result.settings.language === "en" ? "en" : "ar");
      }
      toast({ title: t("settings.savedSuccess"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await exportAccountData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dawwen-account-export-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: t("settings.exportReady"), tone: "success" });
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      window.localStorage.clear();
      window.location.reload();
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
        <Skeleton className="h-32 rounded-card" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("settings.title")}</h1>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted sm:text-sm">
          {t("settings.subtitle")}
        </p>
      </header>

      <form onSubmit={handleSave} className="space-y-5">
        <Card>
          <CardHeader
            icon={<SlidersHorizontal className="h-4 w-4" />}
            title={t("settings.general")}
            description={t("settings.generalHint")}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.language")} htmlFor="settings-language">
                <Select
                  id="settings-language"
                  value={settings.language}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSettings((current) => ({ ...current, language: next }));
                    setLanguage(next === "en" ? "en" : "ar");
                  }}
                >
                  <option value="ar">{t("language.arabicFull")}</option>
                  <option value="en">{t("language.englishFull")}</option>
                </Select>
              </Field>

              <Field
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Globe2 aria-hidden className="h-3.5 w-3.5" />
                    {t("settings.timezone")}
                  </span>
                }
                htmlFor="settings-timezone"
                hint={t("settings.timezoneHint")}
              >
                <Select
                  id="settings-timezone"
                  value={settings.timezone}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, timezone: event.target.value }))
                  }
                  className="tabular"
                >
                  {TIMEZONES.map((zone) => (
                    <option key={zone.value} value={zone.value}>
                      {t(zone.labelKey)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="space-y-2 border-t border-line pt-4">
              <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <Clock3 aria-hidden className="h-3.5 w-3.5" />
                {t("settings.retention")}
              </p>
              <p className="text-xs leading-relaxed text-fg-subtle">
                {t("settings.retentionDesc")}
              </p>

              <div
                role="radiogroup"
                aria-label={t("settings.retention")}
                className="grid gap-2 pt-1 sm:grid-cols-3"
              >
                {RETENTION_OPTIONS.map((days) => {
                  const active = settings.audioRetentionDays === days;
                  return (
                    <button
                      key={days}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() =>
                        setSettings((current) => ({ ...current, audioRetentionDays: days }))
                      }
                      className={cn(
                        "rounded-xl border p-3 text-start transition-colors",
                        active
                          ? "border-brand/50 bg-brand/10"
                          : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      <span
                        className={cn(
                          "block text-sm font-semibold tabular",
                          active ? "text-brand" : "text-fg",
                        )}
                      >
                        {days === 0
                          ? t("settings.retentionNow")
                          : t("settings.retentionDays", {
                              value: formatNumber(days, lang),
                            })}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-subtle">
                        {t(`settings.retentionHint${days}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <p className="me-auto inline-flex items-center gap-1.5 text-xs text-fg-subtle">
            <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
            {t("settings.privacyNote")}
          </p>
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? t("common.saving") : t("settings.saveSettings")}
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader
          icon={<Download className="h-4 w-4" />}
          title={t("settings.dataExport")}
          description={t("settings.dataExportDesc")}
        />
        <CardBody>
          <Button
            variant="secondary"
            icon={
              exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )
            }
            loading={exporting}
            onClick={handleExport}
          >
            {exporting ? t("settings.exporting") : t("settings.exportBtn")}
          </Button>
        </CardBody>
      </Card>

      <Card className="border-danger/25">
        <CardHeader
          icon={<ShieldAlert className="h-4 w-4" />}
          title={<span className="text-danger">{t("settings.dangerZone")}</span>}
          description={t("settings.dangerZoneDesc")}
          className="bg-danger/[0.04]"
        />
        <CardBody>
          <Button
            variant="danger"
            icon={<Trash2 className="h-4 w-4" />}
            onClick={() => setDeleteOpen(true)}
          >
            {t("settings.deleteAccountBtn")}
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        title={t("settings.confirmDeleteTitle")}
        description={t("settings.confirmDeleteAccount")}
        confirmLabel={t("settings.confirmDeleteBtn")}
        loading={deleting}
        requireText={t("settings.deleteWord")}
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
