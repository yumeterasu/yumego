/**
 * Japanese label with a smaller English gloss underneath, so Thai staff who
 * don't read Japanese can follow along everywhere in the UI except the
 * compact day-by-day attendance grid (出/欠/長/中/少, weekday letters) —
 * there simply isn't room there without breaking the month-view layout.
 */
export function Bi({
  ja,
  en,
  className = "",
  enClassName = "block text-[10px] font-normal opacity-70 leading-tight",
}: {
  ja: string;
  en: string;
  className?: string;
  enClassName?: string;
}) {
  return (
    <span className={className}>
      {ja}
      <span className={enClassName}>{en}</span>
    </span>
  );
}
