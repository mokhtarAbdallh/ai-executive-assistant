import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, X, Calendar, Sparkles, Loader2 } from "lucide-react";
import type { SearchCitation } from "../types";
import { hybridSearch } from "../api";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult: (citation: SearchCitation) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onSelectResult,
}) => {
  const { i18n } = useTranslation();
  const isArabic = i18n.language === "ar";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchCitation[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const handler = setTimeout(async () => {
      try {
        const res = await hybridSearch(query);
        setResults(res.results);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [query]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-start justify-center pt-16 md:pt-24 p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-900/90">
          <Search className="w-5 h-5 text-cyan-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isArabic
                ? "ابحث في كل الاجتماعات والتفريغات الصوتية والقرارات..."
                : "Search across all meetings, transcripts, and decisions..."
            }
            className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm focus:outline-none"
            dir="auto"
          />
          {loading && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />}
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-1 text-slate-500 hover:text-slate-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden md:inline-block px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {query.trim() === "" ? (
            <div className="py-12 text-center text-slate-500 text-xs space-y-2">
              <Sparkles className="w-6 h-6 mx-auto text-slate-600" />
              <p>{isArabic ? "ابحث بدلالة الكلمات أو المعنى في أي اجتماع سابق." : "Search by keyword or semantic meaning across past meetings."}</p>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <p>{isArabic ? "لم يتم العثور على نتائج مطابقة." : "No matching results found."}</p>
            </div>
          ) : (
            results.map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  onSelectResult(item);
                  onClose();
                }}
                className="w-full text-start p-3.5 rounded-xl border border-slate-800/80 bg-slate-850 hover:bg-slate-800/80 hover:border-cyan-500/40 transition cursor-pointer group space-y-1.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-bold text-white group-hover:text-cyan-400 transition" dir="auto">
                      {item.meetingTitle}
                    </span>
                    <span className="font-mono text-cyan-400/90 font-semibold bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-500/20 text-[11px]">
                      {item.timestamp}
                    </span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                    {item.matchType === "hybrid"
                      ? isArabic
                        ? "بحث هجين"
                        : "Hybrid"
                      : isArabic
                        ? "نصي"
                        : "Keyword"}
                  </span>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed line-clamp-2" dir="auto">
                  {item.text}
                </p>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500">
          <span>{isArabic ? "نتائج موثقة برقم الاجتماع والتوقيت الدقيق" : "Cited results with meeting title & exact timestamp"}</span>
          <span>{results.length} {isArabic ? "نتيجة" : "results"}</span>
        </div>
      </div>
    </div>
  );
};
