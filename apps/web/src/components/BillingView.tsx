import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchBillingBalance,
  fetchBillingTransactions,
  fetchBillingUsage,
  topupCredits,
} from "../api";
import type {
  BillingBalance,
  CreditTransactionItem,
  UsageSummary,
  UsageEventItem,
} from "../types";

export const BillingView: React.FC = () => {
  const { t } = useTranslation();

  const [balance, setBalance] = useState<BillingBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransactionItem[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageEvents, setUsageEvents] = useState<UsageEventItem[]>([]);
  const [activeTab, setActiveTab] = useState<"transactions" | "usage">("transactions");
  const [loading, setLoading] = useState(true);

  // Top-up modal state
  const [isTopupOpen, setIsTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState<number>(10);
  const [customAmount, setCustomAmount] = useState<string>("");
  const [reference, setReference] = useState("");
  const [submittingTopup, setSubmittingTopup] = useState(false);
  const [topupSuccess, setTopupSuccess] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      const [bal, txs, use] = await Promise.all([
        fetchBillingBalance(),
        fetchBillingTransactions(),
        fetchBillingUsage(),
      ]);
      setBalance(bal);
      setTransactions(txs.transactions);
      setUsageSummary(use.summary);
      setUsageEvents(use.events);
    } catch (err) {
      console.error("Failed to load billing data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleTopupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalAmount = customAmount ? parseFloat(customAmount) : topupAmount;
    if (isNaN(finalAmount) || finalAmount <= 0) return;

    try {
      setSubmittingTopup(true);
      const res = await topupCredits({
        amountDollars: finalAmount,
        reference: reference.trim() || undefined,
        description: `Top-up via manual payment ($${finalAmount})`,
      });

      if (res.success) {
        setTopupSuccess(`تم شحن رصيدك بنجاح بمبلغ $${finalAmount}!`);
        setTimeout(() => {
          setIsTopupOpen(false);
          setTopupSuccess(null);
          setReference("");
          setCustomAmount("");
        }, 1500);
        await loadData();
      }
    } catch (err) {
      console.error("Top-up failed:", err);
    } finally {
      setSubmittingTopup(false);
    }
  };

  const getTransactionTypeBadge = (type: string) => {
    switch (type) {
      case "CREDIT_TOPUP":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">+{t("billing.typeTopup")}</span>;
      case "CREDIT_SETTLE":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">{t("billing.typeSettle")}</span>;
      case "CREDIT_RESERVE":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">{t("billing.typeReserve")}</span>;
      case "CREDIT_REFUND":
        return <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">{t("billing.typeRefund")}</span>;
      default:
        return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-800">{type}</span>;
    }
  };

  return (
    <div className="space-y-8 animate-fadeIn max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-white flex items-center gap-3">
            <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              💳
            </span>
            {t("billing.title")}
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t("billing.subtitle")}
          </p>
        </div>

        <button
          onClick={() => setIsTopupOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-md shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <span className="text-lg">⚡</span>
          {t("billing.topupBtn")}
        </button>
      </div>

      {/* Balance & Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Main Balance Card */}
        <div className="md:col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-slate-900 to-slate-800 text-white p-6 shadow-xl border border-slate-700/50">
          <div className="absolute top-0 end-0 -mt-8 -me-8 w-40 h-40 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="relative z-10 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
                <span>{t("billing.currentBalance")}</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[11px] font-bold">
                  PAY-AS-YOU-GO
                </span>
              </div>
              <div className="text-4xl md:text-5xl font-black text-white tracking-tight">
                {balance ? balance.formattedBalance : "$0.00"}
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-700/60 grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">{t("billing.available")}</span>
                <span className="font-bold text-emerald-400 text-sm">
                  {balance ? `$${(Number(balance.availableMicros) / 1_000_000).toFixed(2)}` : "$0.00"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">{t("billing.reserved")}</span>
                <span className="font-bold text-amber-400 text-sm">
                  {balance ? `$${(Number(balance.reservedMicros) / 1_000_000).toFixed(2)}` : "$0.00"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Minutes Card */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-gray-100 dark:border-slate-700/60 flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-lg mb-3">
              🎙️
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">
              {t("billing.audioMinutes")}
            </span>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {usageSummary ? `${usageSummary.totalAudioMinutes} min` : "0 min"}
            </div>
          </div>
          <div className="mt-4 text-[11px] text-gray-400 dark:text-gray-500">
            ~ $0.02 / audio minute
          </div>
        </div>

        {/* Tokens & Cost Card */}
        <div className="rounded-2xl bg-white dark:bg-slate-800 p-5 shadow-sm border border-gray-100 dark:border-slate-700/60 flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 flex items-center justify-center text-lg mb-3">
              🤖
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-medium block mb-1">
              {t("billing.llmTokens")}
            </span>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {usageSummary ? usageSummary.totalLlmTokens.toLocaleString() : "0"}
            </div>
          </div>
          <div className="mt-4 text-[11px] text-gray-400 dark:text-gray-500">
            {t("billing.totalCost")}: <span className="font-semibold text-purple-600 dark:text-purple-400">${usageSummary ? usageSummary.totalCostDollars.toFixed(2) : "0.00"}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-100 dark:border-slate-700/60 overflow-hidden">
        <div className="flex border-b border-gray-100 dark:border-slate-700/60 px-6 pt-4 gap-6">
          <button
            onClick={() => setActiveTab("transactions")}
            className={`pb-4 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "transactions"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {t("billing.tabTransactions")} ({transactions.length})
          </button>
          <button
            onClick={() => setActiveTab("usage")}
            className={`pb-4 text-sm font-bold border-b-2 transition-colors ${
              activeTab === "usage"
                ? "border-emerald-600 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {t("billing.tabUsage")} ({usageEvents.length})
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="py-12 text-center text-gray-400">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent mb-2" />
              <p className="text-sm">جاري تحميل البيانات...</p>
            </div>
          ) : activeTab === "transactions" ? (
            /* Transactions Table */
            transactions.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <span className="text-3xl block mb-2">📜</span>
                <p>لا توجد أي معاملات سابقة في حسابك.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700/60 text-gray-400 text-xs font-semibold">
                      <th className="pb-3 text-start">{t("billing.tableDate")}</th>
                      <th className="pb-3 text-start">{t("billing.tableType")}</th>
                      <th className="pb-3 text-start">{t("billing.tableAmount")}</th>
                      <th className="pb-3 text-start">{t("billing.tableDesc")}</th>
                      <th className="pb-3 text-start">{t("billing.tableRef")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700/40">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 transition-colors">
                        <td className="py-3.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleDateString()} {new Date(tx.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-3.5 whitespace-nowrap">
                          {getTransactionTypeBadge(tx.transactionType)}
                        </td>
                        <td className={`py-3.5 font-bold whitespace-nowrap ${tx.amountDollars >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}>
                          {tx.amountDollars >= 0 ? `+$${tx.amountDollars.toFixed(2)}` : `-$${Math.abs(tx.amountDollars).toFixed(2)}`}
                        </td>
                        <td className="py-3.5 text-gray-700 dark:text-gray-300 max-w-xs truncate" title={tx.description}>
                          {tx.description}
                        </td>
                        <td className="py-3.5 text-xs text-gray-400 font-mono">
                          {tx.referenceId || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* Usage Events Table */
            usageEvents.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <span className="text-3xl block mb-2">📊</span>
                <p>لم يتم تسجيل أي عمليات استهلاك بعد.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700/60 text-gray-400 text-xs font-semibold">
                      <th className="pb-3 text-start">{t("billing.tableDate")}</th>
                      <th className="pb-3 text-start">{t("billing.tableMeeting")}</th>
                      <th className="pb-3 text-start">{t("billing.tableType")}</th>
                      <th className="pb-3 text-start">{t("billing.tableQuantity")}</th>
                      <th className="pb-3 text-start">{t("billing.tableAmount")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700/40">
                    {usageEvents.map((ev) => (
                      <tr key={ev.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 transition-colors">
                        <td className="py-3.5 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                          {new Date(ev.createdAt).toLocaleDateString()} {new Date(ev.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-3.5 font-medium text-gray-800 dark:text-gray-200">
                          {ev.meeting?.title || "اجتماع مسجل"}
                        </td>
                        <td className="py-3.5 text-xs text-gray-600 dark:text-gray-300 font-mono">
                          {ev.operationType}
                        </td>
                        <td className="py-3.5 text-xs text-gray-500 dark:text-gray-400">
                          {ev.quantity} {ev.unit}
                        </td>
                        <td className="py-3.5 font-bold text-gray-900 dark:text-white whitespace-nowrap">
                          ${ev.costDollars.toFixed(3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>
      </div>

      {/* Top-up Modal */}
      {isTopupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl border border-gray-100 dark:border-slate-700 relative animate-scaleUp">
            <button
              onClick={() => setIsTopupOpen(false)}
              className="absolute top-5 end-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl"
            >
              ✕
            </button>

            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center text-2xl mb-3 shadow-inner">
                ⚡
              </div>
              <h3 className="text-xl font-black text-gray-900 dark:text-white">
                {t("billing.topupModalTitle")}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t("billing.topupModalDesc")}
              </p>
            </div>

            {topupSuccess ? (
              <div className="py-8 text-center text-emerald-600 dark:text-emerald-400 font-bold space-y-2">
                <span className="text-4xl block">🎉</span>
                <p>{topupSuccess}</p>
              </div>
            ) : (
              <form onSubmit={handleTopupSubmit} className="space-y-5">
                {/* Preset Options */}
                <div className="grid grid-cols-2 gap-3">
                  {[5, 10, 25, 50].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setTopupAmount(amt);
                        setCustomAmount("");
                      }}
                      className={`p-3 rounded-xl border text-center transition-all ${
                        topupAmount === amt && !customAmount
                          ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold shadow-sm"
                          : "border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-gray-300"
                      }`}
                    >
                      <div className="text-lg font-black">${amt}</div>
                      <div className="text-[10px] text-gray-400">
                        {amt === 5 ? "~250 دقيقة" : amt === 10 ? "~500 دقيقة" : amt === 25 ? "~1250 دقيقة" : "~2500 دقيقة"}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Custom Amount */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    {t("billing.customAmount")}
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    placeholder="مثال: 15"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Manual Reference */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1">
                    {t("billing.paymentRef")}
                  </label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="رقم عملية إنستاباي أو إشعار التحويل البنكي"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <span className="text-[11px] text-gray-400 mt-1 block">
                    {t("billing.paymentMethod")}
                  </span>
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submittingTopup}
                  className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-md shadow-emerald-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
                >
                  {submittingTopup ? "جاري الإيداع..." : t("billing.confirmTopup")}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
