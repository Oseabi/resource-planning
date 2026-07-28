"use client";

import { useState, useRef, useMemo, useId } from "react";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { autocompleteFor, suggestionsFor, type SuggestionField } from "@/lib/vocabulary";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Which vocabulary field this is, to drive autocomplete + quick-add chips. */
  field?: SuggestionField;
  /** Role/sector context so quick-add chips adapt to the candidate. */
  context?: { primaryRole?: string | null; sectors?: string[] };
  /** Explicit suggestions override (otherwise derived from `field`). */
  suggestions?: string[];
  /** Explicit quick-add chips override (otherwise derived from `field` + context). */
  quickAdd?: string[];
  placeholder?: string;
  id?: string;
  /** Highlight chips as "auto-extracted" until the user edits the field. */
  highlight?: boolean;
}

export function TagInput({
  value,
  onChange,
  field,
  context,
  suggestions,
  quickAdd: quickAddOverride,
  placeholder = "Type and press Enter...",
  id,
  highlight = false,
}: TagInputProps) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const allSuggestions = useMemo(
    () => suggestions ?? (field ? autocompleteFor(field) : []),
    [suggestions, field],
  );

  // Quick-add chips: role/sector-aware curated set for this field, minus chosen
  // values (and, for the roles field, the primary role so it can't be added twice).
  const quickAdd = useMemo(() => {
    const chosen = new Set(value.map((v) => v.toLowerCase()));
    if (context?.primaryRole) chosen.add(context.primaryRole.toLowerCase());
    const base = quickAddOverride ?? (field ? suggestionsFor(field, context ?? {}, 10) : []);
    return base.filter((s) => !chosen.has(s.toLowerCase()));
  }, [field, context, value, quickAddOverride]);

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    const chosen = new Set(value.map((v) => v.toLowerCase()));
    return allSuggestions
      .filter((s) => !chosen.has(s.toLowerCase()))
      .filter((s) => (q ? s.toLowerCase().includes(q) : false))
      .slice(0, 8);
  }, [input, allSuggestions, value]);

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    if (value.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      setInput("");
      return;
    }
    onChange([...value, tag]);
    setInput("");
    setActiveIndex(0);
  }

  function removeTag(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && filtered.length) {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp" && filtered.length) {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && filtered[activeIndex]) addTag(filtered[activeIndex]);
      else addTag(input);
    } else if (e.key === "Backspace" && !input && value.length) {
      removeTag(value.length - 1);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <div
            className={cn(
              "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-body-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/20",
              highlight ? "border-primary/40 bg-primary/5" : "border-input",
            )}
            onClick={() => inputRef.current?.focus()}
          >
            {value.map((tag, i) => (
              <span
                key={`${tag}-${i}`}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-2 py-0.5 text-label-md text-accent-foreground"
              >
                {tag}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTag(i);
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              id={id}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setOpen(true);
                setActiveIndex(0);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 120)}
              onKeyDown={handleKeyDown}
              placeholder={value.length === 0 ? placeholder : ""}
              className="min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              autoComplete="off"
            />
          </div>

          {open && filtered.length > 0 && (
            <ul
              id={listId}
              className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
              role="listbox"
            >
              {filtered.map((s, i) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(s);
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

        <button
          type="button"
          onClick={() => addTag(input)}
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Add"
        >
          <Plus className="size-4" />
        </button>
      </div>

      {quickAdd.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {quickAdd.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addTag(s)}
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
