/**
 * Contact icons for the printed cards, drawn on a 24-unit grid and nested inside the card SVG
 * (no icon font or image request, so they survive PNG/PDF export).
 * Phone and pin are solid, mail and globe are outlined, as on the approved artwork.
 */
export type CardIconName = "phone" | "mail" | "globe" | "pin";

export function CardIcon({ name, x, y, size, color, hole }: { name: CardIconName; x: number; y: number; size: number; color: string; hole?: string }) {
  const stroke = { fill: "none", stroke: color, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {name === "phone" && (
        <path
          fill={color}
          d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.98.98 0 0 0-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"
        />
      )}
      {name === "mail" && (
        <g {...stroke}>
          <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
          <path d="m3 6 9 7 9-7" />
        </g>
      )}
      {name === "globe" && (
        <g {...stroke}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 2.5c-3.2 3.4-3.2 15.6 0 19M12 2.5c3.2 3.4 3.2 15.6 0 19M2.5 12h19M4 7h16M4 17h16" />
        </g>
      )}
      {name === "pin" && (
        <>
          <path fill={color} d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
          <circle cx="12" cy="9" r="2.6" fill={hole ?? "#ffffff"} />
        </>
      )}
    </svg>
  );
}
