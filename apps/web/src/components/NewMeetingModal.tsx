import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  Upload,
  Mic,
  Sparkles,
  ShieldAlert,
  Loader2,
  FileAudio,
  Square,
  AlertCircle,
} from "lucide-react";
import { createMeeting, processDemoMeeting } from "../api";
import type { MeetingDetail } from "../types";

interface NewMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMeetingCreated: (meeting: MeetingDetail) => void;
}

export function NewMeetingModal({ isOpen, onClose, onMeetingCreated }: NewMeetingModalProps) {
  const { t } = useTranslation();

  const [mode, setMode] = useState<"demo" | "record" | "upload">("demo");
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState<"ar" | "en" | "mixed">("mixed");
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>("");

  // Audio file upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Live recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle("مراجعة السبرنت وتوزيع مهام الـ Auth & Pipeline");
      setConsentConfirmed(true);
      setErrorMessage(null);
      setIsProcessing(false);
      setSelectedFile(null);
      setIsRecording(false);
      setRecordSeconds(0);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  if (!isOpen) return null;

  // Live recording toggle
  const startRecording = async () => {
    if (!consentConfirmed) {
      setErrorMessage(t("newModal.consentRequired"));
      return;
    }
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);

      timerRef.current = window.setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setErrorMessage("تعذر الوصول إلى الميكروفون. يرجى تفعيل إذن الصوت في المتصفح أو استخدام وضع الرفع.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    // Hard Invariant 4: Consent Gate validation
    if (!consentConfirmed) {
      setErrorMessage(t("newModal.consentRequired"));
      return;
    }

    if (!title.trim()) {
      setErrorMessage("يرجى إدخال عنوان للاجتماع.");
      return;
    }

    setIsProcessing(true);

    try {
      setProcessingStep(t("meetings.statusUploaded"));

      // 1. Create meeting in database
      const created = await createMeeting({
        title: title.trim(),
        language,
      });

      setProcessingStep(t("meetings.statusTranscribing"));

      // 2. Process Demo / Live flow
      // Under offline demo mode, trigger immediate ASR & LLM pipeline
      const processed = await processDemoMeeting(created.id);

      setProcessingStep(t("meetings.statusAnalyzing"));

      // Brief delay for smooth UX transition
      await new Promise((r) => setTimeout(r, 600));

      onMeetingCreated(processed);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "حدث خطأ أثناء معالجة الاجتماع");
      setIsProcessing(false);
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remaining = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl p-6 sm:p-8 flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isProcessing}
          className="absolute top-5 end-5 p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>دوّن ذكاء اصطناعي فوري</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">{t("newModal.title")}</h2>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-950/40 text-rose-300 text-sm flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-rose-400" />
            <div dir="auto">{errorMessage}</div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Title Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300">
              {t("newModal.meetingTitle")} <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isProcessing}
              placeholder={t("newModal.meetingTitlePlaceholder")}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-800/80 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 text-sm transition"
              dir="auto"
              required
            />
          </div>

          {/* Language Selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300">{t("newModal.language")}</label>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setLanguage("mixed")}
                className={`py-2 px-3 rounded-lg border text-center transition font-medium ${
                  language === "mixed"
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300 font-semibold"
                    : "border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700"
                }`}
              >
                {t("newModal.langMixed")}
              </button>
              <button
                type="button"
                onClick={() => setLanguage("ar")}
                className={`py-2 px-3 rounded-lg border text-center transition font-medium ${
                  language === "ar"
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300 font-semibold"
                    : "border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700"
                }`}
              >
                {t("newModal.langAr")}
              </button>
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={`py-2 px-3 rounded-lg border text-center transition font-medium ${
                  language === "en"
                    ? "border-cyan-500 bg-cyan-500/15 text-cyan-300 font-semibold"
                    : "border-slate-800 bg-slate-800/50 text-slate-400 hover:border-slate-700"
                }`}
              >
                {t("newModal.langEn")}
              </button>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-slate-300">طريقة الإدخال</label>
            <div className="grid grid-cols-3 gap-2 p-1 rounded-xl border border-slate-800 bg-slate-950 text-xs font-medium">
              <button
                type="button"
                onClick={() => setMode("demo")}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg transition ${
                  mode === "demo" ? "bg-cyan-600 text-white shadow-sm font-semibold" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{t("newModal.modeDemo")}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("record")}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg transition ${
                  mode === "record" ? "bg-cyan-600 text-white shadow-sm font-semibold" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Mic className="w-3.5 h-3.5" />
                <span>{t("newModal.modeRecord")}</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("upload")}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-lg transition ${
                  mode === "upload" ? "bg-cyan-600 text-white shadow-sm font-semibold" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t("newModal.modeUpload")}</span>
              </button>
            </div>
          </div>

          {/* Mode Specific Body */}
          {mode === "demo" && (
            <div className="p-4 rounded-xl border border-cyan-500/20 bg-cyan-950/20 text-xs text-slate-300 flex flex-col gap-2">
              <div className="font-semibold text-cyan-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>اجتماع سبرنت مصري كامل جاهز للتحليل</span>
              </div>
              <p className="leading-relaxed text-slate-400" dir="auto">
                يحتوي على حوار واقعي بين مهندسين (أحمد وسارة وعمر) يتحدثون بالعربية والإنجليزية عن الـ backend و الـ deployment وتوزيع مهام الـ PR والـ API.
              </p>
            </div>
          )}

          {mode === "record" && (
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-950 flex flex-col items-center justify-center gap-3">
              {isRecording ? (
                <>
                  <div className="flex items-center gap-1.5 h-8">
                    <span className="w-1.5 h-6 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="w-1.5 h-8 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="w-1.5 h-5 bg-rose-500 rounded-full animate-bounce"></span>
                    <span className="w-1.5 h-7 bg-rose-500 rounded-full animate-bounce [animation-delay:-0.2s]"></span>
                  </div>
                  <div className="text-xl font-mono font-bold text-rose-400">{formatTimer(recordSeconds)}</div>
                  <div className="text-xs text-slate-400">{t("newModal.recordingActive")}</div>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>{t("newModal.stopRecording")}</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400">
                    <Mic className="w-6 h-6" />
                  </div>
                  <div className="text-xs text-slate-400">اضغط لبدء تسجيل صوت الاجتماع مباشرة من الميكروفون</div>
                  <button
                    type="button"
                    onClick={startRecording}
                    className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition cursor-pointer"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>{t("newModal.startRecording")}</span>
                  </button>
                </>
              )}
            </div>
          )}

          {mode === "upload" && (
            <label className="border-2 border-dashed border-slate-700 hover:border-cyan-500 rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition bg-slate-950/40">
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setSelectedFile(e.target.files[0]);
                  }
                }}
              />
              <FileAudio className="w-8 h-8 text-cyan-400" />
              {selectedFile ? (
                <div className="text-center">
                  <div className="text-xs font-semibold text-white">{selectedFile.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-xs font-medium text-slate-300">{t("newModal.dropzoneText")}</div>
                  <div className="text-[10px] text-slate-500 mt-1">{t("newModal.supportedFormats")}</div>
                </div>
              )}
            </label>
          )}

          {/* Hard Invariant 4: Consent Gate Checkbox */}
          <div className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-950/20 flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <label className="flex items-start gap-2 text-xs text-amber-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={consentConfirmed}
                  onChange={(e) => setConsentConfirmed(e.target.checked)}
                  disabled={isProcessing}
                  className="mt-0.5 rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 w-4 h-4"
                />
                <span className="leading-tight" dir="auto">{t("newModal.consentCheckbox")}</span>
              </label>
            </div>
          </div>

          {/* Submit Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isProcessing}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              {t("newModal.cancel")}
            </button>
            <button
              type="submit"
              disabled={isProcessing || !consentConfirmed}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{processingStep || t("newModal.processing")}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>{mode === "demo" ? t("newModal.submitDemo") : t("newModal.submitUpload")}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
