import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileAudio, Info, Mic, ShieldCheck, Sparkles, Square, Upload } from "lucide-react";
import {
  createMeeting,
  pollMeetingProcessing,
  processDemoMeeting,
  uploadMeetingAudio,
} from "../api";
import type { MeetingDetail } from "../types";
import { clockFromSeconds } from "../lib/format";
import { Button, Checkbox, Field, InlineAlert, Input, Modal, ProgressBar, Segmented } from "./ui";

interface NewMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMeetingCreated: (meeting: MeetingDetail) => void;
  initialTitle?: string;
}

type Mode = "demo" | "record" | "upload";

export function NewMeetingModal({
  isOpen,
  onClose,
  onMeetingCreated,
  initialTitle,
}: NewMeetingModalProps) {
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>("demo");
  const [title, setTitle] = useState(initialTitle ?? "");
  const [language, setLanguage] = useState<"ar" | "en" | "mixed">("mixed");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processingStep, setProcessingStep] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [recordedFile, setRecordedFile] = useState<File | null>(null);
  const [recordedSeconds, setRecordedSeconds] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordSecondsRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const stopTracks = () => {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  // Finalized once the recorder emits its last data chunk (onstop), not on the button click.
  const finishRecording = () => {
    const stopped = mediaRecorderRef.current;
    const mimeType = stopped?.mimeType || "audio/webm";
    stopTracks();
    setIsRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const chunks = recordChunksRef.current;
    if (chunks.length > 0) {
      const blob = new Blob(chunks, { type: mimeType });
      const ext = mimeType.includes("mp4") ? "m4a" : "webm";
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType });
      setRecordedFile(file);
      setRecordedSeconds(recordSecondsRef.current);
    }
    recordChunksRef.current = [];
  };

  useEffect(() => {
    if (!isOpen) return;
    setMode("demo");
    setTitle(initialTitle ?? "");
    setLanguage("mixed");
    setConsentConfirmed(false);
    setErrorMessage(null);
    setIsProcessing(false);
    setProgress(0);
    setProcessingStep("");
    setSelectedFile(null);
    setRecordedFile(null);
    setIsRecording(false);
    setRecordSeconds(0);
  }, [isOpen, initialTitle]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      stopTracks();
    };
  }, []);

  const startRecording = async () => {
    if (!consentConfirmed) {
      setErrorMessage(t("newModal.consentRequired"));
      return;
    }
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordChunksRef.current = [];
      setRecordedFile(null);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunksRef.current.push(event.data);
      };
      recorder.onstop = () => finishRecording();
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      recordSecondsRef.current = 0;
      timerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => {
          const next = prev + 1;
          recordSecondsRef.current = next;
          return next;
        });
      }, 1000);
    } catch {
      setErrorMessage(t("newModal.micError"));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!consentConfirmed) {
      setErrorMessage(t("newModal.consentRequired"));
      return;
    }
    if (!title.trim()) {
      setErrorMessage(t("newModal.titleRequired"));
      return;
    }
    if (mode === "upload" && !selectedFile) {
      setErrorMessage(t("newModal.fileRequired"));
      return;
    }
    if (mode === "record" && !isRecording && !recordedFile) {
      setErrorMessage(t("newModal.fileRequired"));
      return;
    }

    setIsProcessing(true);
    setProgress(20);
    setProcessingStep(t("newModal.stepUpload"));

    try {
      const created = await createMeeting({ title: title.trim(), language });

      setProgress(45);
      setProcessingStep(t("newModal.stepTranscribe"));

      // Demo IDs are generated by the offline fallback store in api.ts (meet-<timestamp>).
      // When the API is unreachable we stay in demo mode; otherwise run the real pipeline.
      const apiIsLive = !/^meet-\d+$/.test(created.id);

      let processed: MeetingDetail;
      if (mode === "demo" || !apiIsLive) {
        processed = await processDemoMeeting(created.id);
      } else {
        const audio = mode === "upload" ? selectedFile : recordedFile;
        if (!audio) {
          setErrorMessage(t("newModal.fileRequired"));
          setIsProcessing(false);
          setProgress(0);
          return;
        }
        await uploadMeetingAudio(created.id, audio, consentConfirmed);

        setProgress(60);
        setProcessingStep(t("newModal.stepTranscribe"));
        processed = await pollMeetingProcessing(created.id, (status) => {
          if (status === "ANALYZING") setProcessingStep(t("newModal.stepAnalyze"));
        });

        if (processed.status === "FAILED") {
          setErrorMessage(t("newModal.processingFailed"));
          setIsProcessing(false);
          setProgress(0);
          return;
        }
      }

      setProgress(90);
      setProcessingStep(t("newModal.stepAnalyze"));

      await new Promise((resolve) => window.setTimeout(resolve, 500));
      setProgress(100);

      if (isRecording) stopRecording();
      onMeetingCreated(processed);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("errors.generic"));
      setIsProcessing(false);
      setProgress(0);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={isProcessing ? () => undefined : onClose}
      dismissible={!isProcessing}
      hideClose={isProcessing}
      size="lg"
      title={t("newModal.title")}
      description={t("newModal.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isProcessing}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            loading={isProcessing}
            disabled={!consentConfirmed || !title.trim()}
            icon={<Sparkles className="h-4 w-4" />}
          >
            {isProcessing
              ? processingStep || t("newModal.processing")
              : mode === "demo"
                ? t("newModal.submitDemo")
                : t("newModal.submitUpload")}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {errorMessage ? <InlineAlert tone="danger">{errorMessage}</InlineAlert> : null}

        <Field
          label={t("newModal.meetingTitle")}
          htmlFor="meeting-title"
          required
          hint={t("newModal.titleHint")}
        >
          <Input
            id="meeting-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("newModal.meetingTitlePlaceholder")}
            dir="auto"
            disabled={isProcessing}
            autoComplete="off"
            required
          />
        </Field>

        <Field label={t("newModal.language")} htmlFor="meeting-language">
          <Segmented
            ariaLabel={t("newModal.language")}
            value={language}
            onChange={(next) => setLanguage(next)}
            options={[
              { value: "mixed", label: t("newModal.langMixed") },
              { value: "ar", label: t("newModal.langAr") },
              { value: "en", label: t("newModal.langEn") },
            ]}
          />
        </Field>

        <div className="space-y-2">
          <p className="text-xs font-medium text-fg-muted">{t("newModal.modeLabel")}</p>
          <div
            className="grid gap-2 sm:grid-cols-3"
            role="group"
            aria-label={t("newModal.modeLabel")}
          >
            {(
              [
                {
                  id: "demo",
                  icon: <Sparkles className="h-4 w-4" />,
                  label: t("newModal.modeDemo"),
                },
                {
                  id: "record",
                  icon: <Mic className="h-4 w-4" />,
                  label: t("newModal.modeRecord"),
                },
                {
                  id: "upload",
                  icon: <Upload className="h-4 w-4" />,
                  label: t("newModal.modeUpload"),
                },
              ] as const
            ).map((option) => {
              const active = mode === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  disabled={isProcessing}
                  onClick={() => setMode(option.id)}
                  className={
                    active
                      ? "flex items-center gap-2 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2.5 text-sm font-medium text-brand transition-colors"
                      : "flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm text-fg-muted transition-colors hover:border-line-strong hover:text-fg"
                  }
                >
                  <span aria-hidden>{option.icon}</span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {mode === "demo" ? (
          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-raised/40 p-3 text-xs leading-relaxed text-fg-muted">
            <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <p>{t("newModal.demoHint")}</p>
          </div>
        ) : null}

        {mode === "record" ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-raised/30 p-5">
            {isRecording ? (
              <>
                <div aria-hidden className="flex h-8 items-center gap-1">
                  {[-0.3, -0.15, 0, -0.2].map((delay, index) => (
                    <span
                      key={index}
                      className="w-1.5 animate-bounce rounded-full bg-danger"
                      style={{ height: `${18 + index * 5}%`, animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
                <p className="tabular text-2xl font-semibold text-danger">
                  {clockFromSeconds(recordSeconds)}
                </p>
                <p className="text-xs text-fg-muted">{t("newModal.recordingActive")}</p>
                <Button
                  variant="danger"
                  icon={<Square className="h-3.5 w-3.5 fill-current" />}
                  onClick={stopRecording}
                >
                  {t("newModal.stopRecording")}
                </Button>
              </>
            ) : (
              <>
                <span
                  aria-hidden
                  className="grid h-11 w-11 place-items-center rounded-full bg-brand/10 text-brand"
                >
                  <Mic className="h-5 w-5" />
                </span>
                {recordedFile ? (
                  <div className="text-center">
                    <p className="text-sm font-medium text-fg">
                      {t("newModal.recordedReady", {
                        seconds: clockFromSeconds(recordedSeconds),
                      })}
                    </p>
                    <p className="text-xs text-fg-muted">{t("newModal.recordHint")}</p>
                  </div>
                ) : (
                  <p className="text-center text-xs text-fg-muted">{t("newModal.recordHint")}</p>
                )}
                <Button
                  variant="secondary"
                  icon={<Mic className="h-4 w-4" />}
                  onClick={startRecording}
                  disabled={!consentConfirmed}
                >
                  {t("newModal.startRecording")}
                </Button>
              </>
            )}
          </div>
        ) : null}

        {mode === "upload" ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-raised/20 p-6 text-center transition-colors hover:border-brand/50 hover:bg-brand/[0.03]">
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
              className="sr-only"
              disabled={isProcessing}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) setSelectedFile(file);
              }}
            />
            <FileAudio aria-hidden className="h-7 w-7 text-brand" />
            {selectedFile ? (
              <div>
                <p className="text-sm font-medium text-fg" dir="auto">
                  {selectedFile.name}
                </p>
                <p className="mt-0.5 text-xs tabular text-fg-subtle">
                  {t("newModal.fileSize", { size: (selectedFile.size / (1024 * 1024)).toFixed(2) })}
                </p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-fg">{t("newModal.dropzoneText")}</p>
                <p className="mt-1 text-xs text-fg-subtle">{t("newModal.supportedFormats")}</p>
              </div>
            )}
          </label>
        ) : null}

        {isProcessing ? (
          <ProgressBar value={progress} label={processingStep || t("newModal.processing")} />
        ) : null}

        <div className="rounded-xl border border-line bg-raised/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck aria-hidden className="h-4 w-4 text-warning" />
            <p className="text-xs font-medium text-fg">{t("newModal.consentTitle")}</p>
          </div>
          <Checkbox
            id="recording-consent"
            checked={consentConfirmed}
            onChange={(event) => setConsentConfirmed(event.target.checked)}
            disabled={isProcessing}
            label={t("newModal.consentCheckbox")}
            description={t("newModal.consentHint")}
            className="border-line bg-surface"
          />
        </div>

        {/* Allows Enter-to-submit while the visible action lives in the footer. */}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  );
}
