"use client";

import { useState, useMemo, useRef, useId } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { autocompleteFor, suggestionsFor, type SuggestionField } from "@/lib/vocabulary";

interface ComboboxInputProps {
  value: string | null;
  onChange: (value: string | null) => void;
  /** Vocabulary field driving autocomplete; omit when passing `suggestions`. */
  field?: SuggestionField;
  /** Explicit option list, for vocabularies outside the candidate packs. */
  suggestions?: string[];
  context?: { primaryRole?: string | null; sectors?: string[] };
  placeholder?: string;
  id?: string;
  highlight?: boolean;
  /** Show role/sector-aware quick-add chips below the field. */
  showQuickAdd?: boolean;
}

/**
 * Single-value typeahead combobox with freeform entry and optional quick-add
 * chips. Unlike a native <datalist>, the suggestion list only opens while typing
 * and stays filtered, so it doesn't dump the whole vocabulary at once.
 */
export function ComboboxInput({
  value,
  onChange,
  field,
  suggestions,
  context,
  placeholder,
  id,
  highlight = false,
  showQuickAdd = true,
}: ComboboxInputProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const text = value ?? "";

  const options = useMemo(
    () => suggestions ?? (field ? autocompleteFor(field) : []),
    [suggestions, field],
  );

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return [];
    return options
      .filter((o) => o.toLowerCase().includes(q) && o.toLowerCase() !== q)
      .slice(0, 8);
  }, [text, options]);

  const quickAdd = useMemo(() => {
    if (!showQuickAdd) return [];
    const base = field ? suggestionsFor(field, context ?? {}, 8) : (suggestions ?? []).slice(0, 8);
    return base.filter((s) => s.toLowerCase() !== text.trim().toLowerCase());
  }, [showQuickAdd, field, suggestions, context, text]);

  function choose(v: string) {
    onChange(v || null);
    setOpen(false);
    setActiveIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && filtered.length) {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp" && filtered.length) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" && open && filtered[activeIndex]) {
      e.preventDefault();
      choose(filtered[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div>
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          value={text}
          onChange={(e) => {
            onChange(e.target.value || null);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          className={cn(
            "h-9 w-full rounded-md border bg-background px-3 text-body-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/20",
            highlight ? "border-primary/40 bg-primary/5" : "border-input",
          )}
        />
        {open && filtered.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
          >
            {filtered.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(s);
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex w-full items-center px-2.5 py-1.5 text-left text-body-sm",
                    i === activeIndex ? "bg-accent text-accent-foreground" : "text-foreground",
                  )}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {quickAdd.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickAdd.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => choose(s)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-0.5 text-label-md text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <Plus className="size-3" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
