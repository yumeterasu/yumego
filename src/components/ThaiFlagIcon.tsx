// A drawn SVG Thai flag, used instead of the 🇹🇭 flag emoji.
// Flag emoji are just two regional-indicator letters under the hood --
// whether they render as an actual flag depends entirely on the OS's own
// emoji font, and Windows either shows plain "TH" letters or a flag
// depending on the Windows/Chrome version. Drawing the flag ourselves
// looks identical on every OS/browser since it's a real image, not a font
// glyph. Official proportions: 5 horizontal stripes, height ratio 1:1:2:1:1
// (red/white/blue/white/red).
export default function ThaiFlagIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 30 20"
      className={`inline-block w-[18px] h-3 rounded-[2px] align-middle ${className}`}
      role="img"
      aria-label="タイ国旗 / Thai flag"
    >
      <rect width="30" height="20" fill="#A51931" />
      <rect y="3.333" width="30" height="13.333" fill="#F4F5F8" />
      <rect y="6.667" width="30" height="6.667" fill="#2D2A4A" />
    </svg>
  );
}
