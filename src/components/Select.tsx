"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Trigger button classes -- fully replaces the default, same as a plain
   *  <select>'s className always did. Add "flex items-center justify-between
   *  gap-1" yourself if you want the caret to sit at the far edge. */
  className?: string;
  /** Dropdown panel classes -- rarely needed, sensible default provided. */
  panelClassName?: string;
  /** Each option row's classes (selected/hover state included) -- rarely
   *  needed, sensible default provided. */
  optionClassName?: (opt: SelectOption, isSelected: boolean) => string;
  /** Shows a filter input pinned to the top of the panel. Defaults to on
   *  once there are more than 8 options (a short list doesn't need it). */
  searchable?: boolean;
  /** Set false to hide the ▾ indicator -- for very tight compact triggers
   *  (e.g. a table cell) where there's no room for it. */
  showCaret?: boolean;
  "aria-label"?: string;
};

const SEARCH_THRESHOLD = 8;
const GAP = 4; // px between trigger and panel

/**
 * Custom dropdown, used everywhere in place of a plain <select>/<option>.
 *
 * Why: a native <select>'s open option list is drawn by the OS, not by
 * page CSS -- Chrome on Windows has a long-standing rendering bug where a
 * long option list scrolled inside that OS-drawn popup renders different
 * chunks of options at visibly inconsistent font sizes (worse the longer
 * the list gets). There's no CSS fix for that popup at all, since the page
 * never draws it. The only real fix is to stop using it -- render the
 * option list ourselves, in a single explicit style, so every row is
 * guaranteed the same size no matter how long the list is or where it
 * scrolls.
 *
 * Renders the open panel through a portal to document.body, positioned
 * with position:fixed from the trigger's own measured rect -- this is
 * also what fixes it from ever getting clipped by a modal's own
 * max-height + overflow-y-auto wrapper, which a plain absolutely-positioned
 * child would run into.
 */
export default function Select({
  value,
  onChange,
  options,
  placeholder = "選択してください / Select",
  disabled,
  className,
  panelClassName,
  optionClassName,
  searchable,
  showCaret = true,
  ...aria
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const showSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  useEffect(() => {
    if (!open) return;
    function updateRect() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < 240 && r.top > spaceBelow;
      setRect({
        left: r.left,
        width: Math.max(r.width, 160),
        ...(openUp
          ? { bottom: window.innerHeight - r.top + GAP }
          : { top: r.bottom + GAP }),
      });
    }
    updateRect();
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const filtered =
    showSearch && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title={selected?.label}
        className={
          className ??
          "border border-gray-300 rounded-lg px-3 py-2 bg-white flex items-center justify-between gap-2 disabled:opacity-40"
        }
        {...aria}
      >
        <span className={`truncate ${selected ? "" : "text-gray-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        {showCaret && <span className="text-gray-400 text-[10px] shrink-0">▾</span>}
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: rect.left,
              width: rect.width,
              top: rect.top,
              bottom: rect.bottom,
            }}
            className={
              panelClassName ??
              "z-[100] bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto"
            }
          >
            {showSearch && (
              <div className="sticky top-0 bg-white border-b border-gray-100 p-1.5">
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="検索 / Search"
                  className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
                />
              </div>
            )}
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">見つかりません / No matches</p>
            ) : (
              filtered.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={
                      optionClassName
                        ? optionClassName(o, isSelected)
                        : `block w-full text-left px-3 py-2 text-sm leading-normal disabled:opacity-40 ${
                            isSelected
                              ? "bg-blue-50 text-blue-700 font-semibold"
                              : "hover:bg-gray-100"
                          }`
                    }
                  >
                    {o.label}
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </>
  );
}
