import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CornerDownLeft, Search, Sparkles } from "lucide-react";
import type { SearchCitation } from "../types";
import { hybridSearch } from "../api";
import { cn } from "../lib/cn";
import { Badge, EmptyState, Input, Modal, Skeleton } from "./ui";

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult: (citation: SearchCitation) => void;
}

export function SearchModal({ isOpen, onClose, onSelectResult }: SearchModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchCitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await hybridSearch(term);
        if (!cancelled) {
          setResults(response.results);
          setActiveIndex(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, isOpen]);

  const select = (citation: SearchCitation) => {
    onSelectResult(citation);
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={t("search.title")}
      description={t("search.hint")}
      size="lg"
      bodyClassName="p-0"
    >
      <div className="border-b border-line p-3">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            ref={inputRef}
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, Math.max(0, results.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                select(results[activeIndex]);
              }
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="ps-9"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={
              results[activeIndex] ? `search-result-${activeIndex}` : undefined
            }
          />
        </div>
      </div>

      <div
        id="search-results"
        role="listbox"
        aria-label={t("search.results")}
        className="max-h-[55vh] overflow-y-auto p-2"
      >
        {loading ? (
          <div className="space-y-2 p-1">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : query.trim().length < 2 ? (
          <EmptyState
            compact
            icon={<Sparkles />}
            title={t("search.startTitle")}
            description={t("search.startBody")}
            className="border-0 bg-transparent"
          />
        ) : results.length === 0 ? (
          <EmptyState
            compact
            icon={<Search />}
            title={t("search.noResultsTitle")}
            description={t("search.noResultsBody")}
            className="border-0 bg-transparent"
          />
        ) : (
          <ul className="space-y-1">
            {results.map((citation, index) => (
              <li
                key={`${citation.meetingId}-${citation.segmentId ?? index}`}
                role="option"
                aria-selected={index === activeIndex}
                id={`search-result-${index}`}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(citation)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-start transition-colors",
                    index === activeIndex ? "bg-raised" : "hover:bg-raised/60",
                  )}
                >
                  <span className="mt-0.5 shrink-0 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] tabular text-fg-muted">
                    {citation.timestamp}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-medium text-fg" dir="auto">
                        {citation.meetingTitle}
                      </span>
                      <Badge tone={citation.matchType === "hybrid" ? "brand" : "neutral"}>
                        {t(`search.match.${citation.matchType}`)}
                      </Badge>
                    </span>
                    <span
                      className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-fg-muted"
                      dir="auto"
                    >
                      {citation.text}
                    </span>
                  </span>
                  {index === activeIndex ? (
                    <CornerDownLeft
                      aria-hidden
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle"
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
