import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";
import { Field, Input, Textarea } from "./field";
import { Modal } from "./modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  /** When set, the user must type this exact word to enable the action. */
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  loading = false,
  requireText,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const blocked = Boolean(requireText) && typed.trim() !== requireText;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
            disabled={blocked}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span
            className={
              tone === "danger"
                ? "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger/10 text-danger"
                : "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/10 text-brand"
            }
            aria-hidden
          >
            <AlertTriangle className="h-4 w-4" />
          </span>
          {description ? (
            <p className="text-sm leading-relaxed text-fg-muted">{description}</p>
          ) : null}
        </div>
        {requireText ? (
          <Field label={t("common.typeToConfirm", { word: requireText })} htmlFor="confirm-text">
            <Input
              id="confirm-text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              dir="ltr"
              placeholder={requireText}
            />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

interface ReasonDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  placeholder?: string;
  loading?: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}

export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  placeholder,
  loading = false,
  onSubmit,
  onClose,
}: ReasonDialogProps) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={loading} onClick={() => onSubmit(reason.trim())}>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      <Field label={t("common.reason")} htmlFor="reason" hint={t("common.reasonOptional")}>
        <Textarea
          id="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={placeholder ?? t("common.reasonPlaceholder")}
          maxLength={400}
        />
      </Field>
    </Modal>
  );
}
