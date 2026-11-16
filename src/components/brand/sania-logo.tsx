import type { SVGProps } from "react";
import { LOGO_HORIZONTAL, LOGO_MARK, LOGO_VERTICAL, LOGO_WORDMARK, type LogoArt } from "./logo-art";

const ART = { horizontal: LOGO_HORIZONTAL, vertical: LOGO_VERTICAL, wordmark: LOGO_WORDMARK, mark: LOGO_MARK } satisfies Record<string, LogoArt>;
export type LogoVariant = keyof typeof ART;

/**
 * The official Sania logo as inline vector paths (no image request), so it is crisp at any size
 * and can be nested inside the card SVGs. Colour comes from `fill` (default: currentColor).
 * Pass x / y / width / height to place it inside another SVG.
 */
export function SaniaLogo({ variant = "horizontal", title, fill = "currentColor", ...props }: { variant?: LogoVariant; title?: string } & SVGProps<SVGSVGElement>) {
  const art = ART[variant];
  return (
    <svg
      viewBox={`0 0 ${art.width} ${art.height}`}
      fill={fill}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {art.paths.map((p, i) => (
        <path key={i} d={p.d} fillRule={p.evenOdd ? "evenodd" : undefined} />
      ))}
    </svg>
  );
}

/** Aspect ratio (width / height) of a logo variant, for sizing it inside a fixed box. */
export function logoRatio(variant: LogoVariant): number {
  return ART[variant].width / ART[variant].height;
}
