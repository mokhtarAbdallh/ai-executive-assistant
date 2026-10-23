import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, Bot, Cpu, Mic, Plus, Receipt, Wallet } from "lucide-react";
import {
  fetchBillingBalance,
  fetchBillingTransactions,
  fetchBillingUsage,
  topupCredits,
} from "../api";
import type { BillingBalance, CreditTransactionItem, UsageEventItem, UsageSummary } from "../types";
import { formatDateTime, formatNumber, formatUsd } from "../lib/format";
import { cn } from "../lib/cn";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Skeleton,
  Tabs,
  useToast,
  type BadgeTone,
} from "./ui";

const TXN_TONE: Record<CreditTransactionItem["transactionType"], BadgeTone> = {
  CREDIT_TOPUP: "success",
  CREDIT_SETTLE: "neutral",
  CREDIT_RESERVE: "warning",
  CREDIT_REFUND: "info",
};

export function BillingView() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { toast } = useToast();

  const [balance, setBalance] = useState<BillingBalance | null>(null);
  const [transactions, setTransactions] = useState<CreditTransactionItem[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageEvents, setUsageEvents] = useState<UsageEventItem[]>([]);
  const [tab, setTab] = useState<"transactions" | "usage">("transactions");
  const [loading, setLoading] = useState(true);

  const [topupOpen, setTopupOpen] = useState(false);
  const [preset, setPreset] = useState<string>("10");
  const [customAmount, setCustomAmount] = useState("");
  const [reference, setReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balanceData, transactionData, usageData] = await Promise.all([
        fetchBillingBalance(),
        fetchBillingTransactions(),
        fetchBillingUsage(),
      ]);
      setBalance(balanceData);
      setTransactions(transactionData.transactions);
      setUsageSummary(usageData.summary);
      setUsageEvents(usageData.events);
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const availableDollars = balance ? Number(balance.availableMicros) / 1_000_000 : 0;
  const reservedDollars = balance ? Number(balance.reservedMicros) / 1_000_000 : 0;

  const submitTopup = async () => {
    const amount = customAmount ? Number.parseFloat(customAmount) : Number.parseFloat(preset);
    if (!Number.isFinite(amount) || amount <= 0) return;

    setSubmitting(true);
    try {
      const result = await topupCredits({
        amountDollars: amount,
        reference: reference.trim() || undefined,
        description: `Top-up via manual payment (${formatUsd(amount, "en")})`,
      });
      if (result.success) {
        toast({
          title: t("billing.topupSuccess", { amount: formatUsd(amount, lang) }),
          tone: "success",
        });
        setTopupOpen(false);
        setReference("");
        setCustomAmount("");
        await load();
      }
    } catch {
      toast({ title: t("errors.generic"), tone: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">{t("billing.title")}</h1>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted sm:text-sm">
          {t("billing.subtitle")}
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="relative overflow-hidden bg-gradient-to-br from-brand/10 via-surface to-surface lg:col-span-1">
          <div className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full bg-brand/10 blur-2xl" />
          <CardBody className="relative space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                <Wallet aria-hidden className="h-3.5 w-3.5" />
                {t("billing.currentBalance")}
              </p>
              <Badge tone="brand">{t("billing.payAsYouGo")}</Badge>
            </div>

            <p className="text-3xl font-semibold tabular text-fg">
              {balance ? formatUsd(availableDollars, lang) : "—"}
            </p>

            <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
              <div>
                <dt className="text-fg-subtle">{t("billing.available")}</dt>
                <dd className="mt-0.5 font-medium tabular text-success">
                  {formatUsd(availableDollars, lang)}
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle">{t("billing.reserved")}</dt>
                <dd className="mt-0.5 font-medium tabular text-warning">
                  {formatUsd(reservedDollars, lang)}
                </dd>
              </div>
            </dl>

            <Button
              variant="primary"
              className="w-full"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => setTopupOpen(true)}
            >
              {t("billing.topupBtn")}
            </Button>
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-2">
          <StatCard
            icon={<Mic />}
            label={t("billing.audioMinutes")}
            value={
              loading
                ? null
                : formatNumber(usageSummary?.totalAudioMinutes ?? 0, lang, {
                    maximumFractionDigits: 1,
                  })
            }
            hint={t("billing.audioMinutesHint")}
            tone="text-info bg-info/10"
          />
          <StatCard
            icon={<Bot />}
            label={t("billing.llmTokens")}
            value={loading ? null : formatNumber(usageSummary?.totalLlmTokens ?? 0, lang)}
            hint={t("billing.llmTokensHint")}
            tone="text-brand bg-brand/10"
          />
          <StatCard
            icon={<Cpu />}
            label={t("billing.totalCost")}
            value={loading ? null : formatUsd(usageSummary?.totalCostDollars ?? 0, lang)}
            hint={t("billing.totalCostHint", { count: usageSummary?.totalEvents ?? 0 })}
            tone="text-success bg-success/10"
          />
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
          <Tabs
            ariaLabel={t("billing.tabsLabel")}
            value={tab}
            onChange={(next) => setTab(next as "transactions" | "usage")}
            tabs={[
              {
                id: "transactions",
                label: t("billing.tabTransactions"),
                count: transactions.length,
                icon: <Receipt />,
              },
              {
                id: "usage",
                label: t("billing.tabUsage"),
                count: usageEvents.length,
                icon: <Cpu />,
              },
            ]}
            className="border-0 bg-transparent p-0"
          />
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-10" />
            ))}
          </div>
        ) : tab === "transactions" ? (
          transactions.length === 0 ? (
            <EmptyState
              icon={<Receipt />}
              title={t("billing.emptyTransactionsTitle")}
              description={t("billing.emptyTransactionsBody")}
              className="m-4 border-0 bg-transparent"
            />
          ) : (
            <Table
              head={[
                t("billing.colDate"),
                t("billing.colType"),
                t("billing.colDescription"),
                t("billing.colAmount"),
              ]}
            >
              {transactions.map((transaction) => {
                const positive = transaction.amountDollars >= 0;
                return (
                  <tr key={transaction.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular text-fg-muted">
                      {formatDateTime(transaction.createdAt, lang)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={TXN_TONE[transaction.transactionType]}>
                        {t(`billing.txnType.${transaction.transactionType}`)}
                      </Badge>
                    </td>
                    <td className="max-w-[280px] px-4 py-3 text-xs text-fg-muted" dir="auto">
                      {transaction.description}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-4 py-3 text-end text-xs font-medium tabular",
                        positive ? "text-success" : "text-fg",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {positive ? (
                          <ArrowUpRight aria-hidden className="h-3 w-3" />
                        ) : (
                          <ArrowDownRight aria-hidden className="h-3 w-3" />
                        )}
                        {positive ? "+" : "−"}
                        {formatUsd(Math.abs(transaction.amountDollars), lang)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )
        ) : usageEvents.length === 0 ? (
          <EmptyState
            icon={<Cpu />}
            title={t("billing.emptyUsageTitle")}
            description={t("billing.emptyUsageBody")}
            className="m-4 border-0 bg-transparent"
          />
        ) : (
          <Table
            head={[
              t("billing.colDate"),
              t("billing.colOperation"),
              t("billing.colMeeting"),
              t("billing.colQuantity"),
              t("billing.colCost"),
            ]}
          >
            {usageEvents.map((event) => (
              <tr key={event.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-4 py-3 text-xs tabular text-fg-muted">
                  {formatDateTime(event.createdAt, lang)}
                </td>
                <td className="px-4 py-3 text-xs text-fg">
                  {t(`billing.operation.${event.operationType}`, {
                    defaultValue: event.operationType,
                  })}
                </td>
                <td className="max-w-[220px] truncate px-4 py-3 text-xs text-fg-muted" dir="auto">
                  {event.meeting?.title ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs tabular text-fg-muted">
                  {formatNumber(event.quantity, lang, { maximumFractionDigits: 1 })}{" "}
                  {t(`billing.unit.${event.unit}`, { defaultValue: event.unit })}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-end text-xs font-medium tabular text-fg">
                  {formatUsd(event.costDollars, lang)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader icon={<Wallet className="h-4 w-4" />} title={t("billing.howTitle")} />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((step) => (
            <div key={step} className="rounded-xl border border-line bg-raised/30 p-3">
              <p className="text-xs font-semibold text-brand">{t(`billing.howStep${step}Title`)}</p>
              <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                {t(`billing.howStep${step}Body`)}
              </p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Modal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        title={t("billing.topupTitle")}
        description={t("billing.topupBody")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTopupOpen(false)} disabled={submitting}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={submitting} onClick={submitTopup}>
              {t("billing.confirmTopup")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium text-fg-muted">{t("billing.amount")}</p>
            <Segmented
              ariaLabel={t("billing.amount")}
              value={preset}
              onChange={(next) => {
                setPreset(next);
                setCustomAmount("");
              }}
              options={[
                { value: "5", label: formatUsd(5, lang) },
                { value: "10", label: formatUsd(10, lang) },
                { value: "25", label: formatUsd(25, lang) },
                { value: "50", label: formatUsd(50, lang) },
              ]}
            />
          </div>

          <Field
            label={t("billing.customAmount")}
            htmlFor="custom-amount"
            hint={t("billing.customAmountHint")}
          >
            <Input
              id="custom-amount"
              type="number"
              min={1}
              step="0.5"
              inputMode="decimal"
              value={customAmount}
              onChange={(event) => setCustomAmount(event.target.value)}
              placeholder="15"
              className="tabular"
            />
          </Field>

          <Field
            label={t("billing.reference")}
            htmlFor="reference"
            hint={t("billing.referenceHint")}
          >
            <Input
              id="reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={t("billing.referencePlaceholder")}
              dir="auto"
            />
          </Field>

          <p className="rounded-xl border border-line bg-raised/40 p-3 text-xs leading-relaxed text-fg-muted">
            {t("billing.manualNote")}
          </p>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  hint: string;
  tone: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-fg-muted">{label}</p>
        <span
          aria-hidden
          className={cn("grid h-7 w-7 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4", tone)}
        >
          {icon}
        </span>
      </div>
      {value === null ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className="mt-2 text-2xl font-semibold tabular text-fg">{value}</p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-fg-subtle">{hint}</p>
    </Card>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-start">
        <thead>
          <tr className="border-b border-line bg-raised/40">
            {head.map((cell) => (
              <th
                key={cell}
                scope="col"
                className="px-4 py-2.5 text-start text-[11px] font-medium uppercase tracking-wide text-fg-subtle"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
