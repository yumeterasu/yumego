import { CLASS_PLANET_GRADIENTS, CLASS_PLANET_HAS_RING, CLASS_PLANET_LABELS, type ClassPlanetKey } from "@/lib/classColors";

/** One rendered planet sphere -- a CSS radial-gradient circle (Saturn gets
 *  an extra ring overlay), used for both the クラス管理 picker and the
 *  small badge on each class's button. */
export function PlanetDot({
  planet,
  size = 24,
  className = "",
  title,
}: {
  planet: ClassPlanetKey;
  size?: number;
  className?: string;
  title?: boolean;
}) {
  return (
    <span
      className={`relative inline-block rounded-full shrink-0 ${className}`}
      style={{ width: size, height: size, background: CLASS_PLANET_GRADIENTS[planet] }}
      title={title ? CLASS_PLANET_LABELS[planet] : undefined}
    >
      {CLASS_PLANET_HAS_RING[planet] && (
        <span
          className="absolute rounded-full pointer-events-none"
          style={{
            left: "50%",
            top: "50%",
            width: "168%",
            height: "46%",
            border: "1.5px solid rgba(255,235,190,0.85)",
            transform: "translate(-50%, -50%) rotate(-18deg)",
          }}
        />
      )}
    </span>
  );
}
