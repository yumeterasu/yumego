// Generic loading placeholders. A plain "読み込み中" text line collapses
// the whole page down to almost nothing while data loads, then snaps back
// out once it arrives -- most noticeable navigating in from Dashboard's
// much taller grid. These keep the page roughly the height it's about to
// be instead, so nothing visibly shrinks and re-expands.

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" aria-label="読み込み中... / Loading...">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="h-[72px] rounded-xl border border-gray-200 bg-gray-100 animate-pulse"
        />
      ))}
    </div>
  );
}

export function SkeletonBlock({ className = "h-[420px]" }: { className?: string }) {
  return (
    <div
      className={`w-full rounded-xl border border-gray-200 bg-gray-100 animate-pulse ${className}`}
      aria-label="読み込み中... / Loading..."
    />
  );
}
