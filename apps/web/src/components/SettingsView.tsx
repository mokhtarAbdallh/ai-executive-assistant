import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchSettings,
  updateSettings,
  exportAccountData,
  deleteAccount,
} from "../api";
import type { UserSettings } from "../types";

export const SettingsView: React.FC = () => {
  const { t, i18n } = useTranslation();

  const [settings, setSettings] = useState<UserSettings>({
    language: "ar",
    timezone: "Africa/Cairo",
    audioRetentionDays: 7,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Export state
  const [exporting, setExporting] = useState(false);

  // Delete account modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchSettings();
        setSettings(data.settings);
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await updateSettings(settings);
      setSettings(res.settings);
      if (res.settings.language && res.settings.language !== i18n.language) {
        void i18n.changeLanguage(res.settings.language);
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleExportData = async () => {
    try {
      setExporting(true);
      const data = await exportAccountData();
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dawwen-account-export-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== "حذف" && deleteConfirmationText.toLowerCase() !== "delete") {
      return;
    }
    try {
      setDeleting(true);
      await deleteAccount();
      localStorage.clear();
      window.location.reload();
    } catch (err) {
      console.error("Account deletion failed:", err);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-gray-400">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent mb-2" />
        <p className="text-sm">جاري تحميل الإعدادات...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
          <span className="p-2 rounded-xl bg-slate-500/10 text-slate-700 dark:text-slate-300">
            ⚙️
          </span>
          {t("settings.title")}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("settings.subtitle")}
        </p>
      </div>

      {/* General Settings Form */}
      <form onSubmit={handleSave} className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-sm border border-gray-100 dark:border-slate-700/60 space-y-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white pb-3 border-b border-gray-100 dark:border-slate-700/60 flex items-center gap-2">
          <span>🌐</span>
          {t("settings.general")}
        </h2>

        {/* Language Selection */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              {t("settings.language")}
            </label>
            <select
              value={settings.language}
              onChange={(e) => setSettings({ ...settings, language: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="ar">العربية (Egyptian Arabic + Mixed)</option>
              <option value="en">English (International)</option>
            </select>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              {t("settings.timezone")}
            </label>
            <select
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
            >
              <option value="Africa/Cairo">Africa/Cairo (توقيت القاهرة الافتراضي)</option>
              <option value="Asia/Riyadh">Asia/Riyadh (توقيت مكة)</option>
              <option value="Asia/Dubai">Asia/Dubai (توقيت دبي)</option>
              <option value="UTC">UTC (Coordinated Universal Time)</option>
              <option value="Europe/London">Europe/London</option>
              <option value="America/New_York">America/New_York</option>
            </select>
          </div>
        </div>

        {/* Audio Retention Lifecycle */}
        <div className="pt-4 border-t border-gray-100 dark:border-slate-700/60">
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
            {t("settings.retention")}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            {t("settings.retentionDesc")}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { days: 0, label: t("settings.retention0") },
              { days: 7, label: t("settings.retention7") },
              { days: 30, label: t("settings.retention30") },
            ].map((opt) => (
              <button
                key={opt.days}
                type="button"
                onClick={() => setSettings({ ...settings, audioRetentionDays: opt.days })}
                className={`p-4 rounded-xl border text-start transition-all ${
                  settings.audioRetentionDays === opt.days
                    ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold shadow-sm"
                    : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                <div className="text-sm font-bold">{opt.days} أيام</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {opt.label}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between pt-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-md shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? "جاري الحفظ..." : t("settings.saveSettings")}
          </button>

          {saveSuccess && (
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 animate-fadeIn flex items-center gap-1.5">
              <span>✓</span> {t("settings.savedSuccess")}
            </span>
          )}
        </div>
      </form>

      {/* Data Export (GDPR Portability) */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 md:p-8 shadow-sm border border-gray-100 dark:border-slate-700/60 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-lg">
            📦
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {t("settings.dataExport")}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t("settings.dataExportDesc")}
            </p>
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={handleExportData}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800/50 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 text-sm"
          >
            <span>📥</span>
            {exporting ? "جاري تجهيز الملف..." : t("settings.exportBtn")}
          </button>
        </div>
      </div>

      {/* Danger Zone (Account Deletion) */}
      <div className="bg-red-50/40 dark:bg-red-950/20 rounded-2xl p-6 md:p-8 border border-red-200/80 dark:border-red-900/40 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center text-lg">
            ⚠️
          </div>
          <div>
            <h2 className="text-lg font-bold text-red-900 dark:text-red-300">
              {t("settings.dangerZone")}
            </h2>
            <p className="text-xs text-red-700/80 dark:text-red-400/80 mt-0.5">
              {t("settings.dangerZoneDesc")}
            </p>
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={() => setIsDeleteModalOpen(true)}
            className="px-5 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition-all shadow-md shadow-red-500/20 hover:scale-[1.01] active:scale-[0.99] text-sm"
          >
            {t("settings.deleteAccountBtn")}
          </button>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-red-100 dark:border-red-900/50 relative animate-scaleUp">
            <button
              onClick={() => setIsDeleteModalOpen(false)}
              className="absolute top-5 end-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl"
            >
              ✕
            </button>

            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center text-2xl mb-3 shadow-inner">
                🚨
              </div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white">
                تأكيد حذف الحساب نهائياً
              </h3>
              <p className="text-xs text-red-600 dark:text-red-400 mt-2 font-medium">
                {t("settings.confirmDeleteAccount")}
              </p>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                لتأكيد العملية، يرجى كتابة كلمة <strong className="text-red-600 font-mono">حذف</strong> أو <strong className="text-red-600 font-mono">delete</strong> في المربع أدناه:
              </p>
              <input
                type="text"
                value={deleteConfirmationText}
                onChange={(e) => setDeleteConfirmationText(e.target.value)}
                placeholder="اكتب حذف للتأكيد"
                className="w-full px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/20 dark:bg-slate-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500 font-semibold"
              />

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 font-semibold text-sm hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  disabled={deleting || (deleteConfirmationText !== "حذف" && deleteConfirmationText.toLowerCase() !== "delete")}
                  onClick={handleDeleteAccount}
                  className="flex-1 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 transition-all text-sm shadow-md shadow-red-500/20"
                >
                  {deleting ? "جاري الحذف..." : "تأكيد الحذف النهائي"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
