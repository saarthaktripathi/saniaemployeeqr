import { formatDate, initials } from "@/lib/cn";

export type CardStatus = "VALID" | "INACTIVE" | "EXPIRED" | "REVOKED";

export interface IdCardData {
  displayName: string;
  employeeCode: string;
  jobTitle: string | null;
  department: string | null;
  idExpiresAt: string;
  /** Data URL or same-origin URL; null shows initials. */
  photo: string | null;
}

const STATUS_STYLE: Record<CardStatus, { label: string; fill: string; text: string }> = {
  VALID: { label: "ACTIVE · VALID", fill: "#e5f6ea", text: "#15803d" },
  INACTIVE: { label: "INACTIVE", fill: "#fcebe7", text: "#b4412b" },
  EXPIRED: { label: "EXPIRED", fill: "#fdf3e1", text: "#a15c07" },
  REVOKED: { label: "REVOKED", fill: "#fcebe7", text: "#b4412b" },
};

// System fonts only: the card is also rasterised to PNG/PDF, where web fonts are unavailable.
const FONT = "'Segoe UI', Arial, Helvetica, sans-serif";
const MONO = "'Consolas', 'Courier New', monospace";

function fit(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Portrait CR80 employee ID card drawn as a single SVG (540 × 856 units, the card's
 * 54 × 85.6 mm proportions). The same markup is used on screen, in print and for the
 * PNG/PDF downloads, so every output looks identical.
 */
export function IdCardSvg({
  data,
  status,
  qr,
  logoHref,
  company = "Sania Job Bowl",
  tagline = "Connecting Talent. Creating the Future.",
  verifyHost,
  className,
  idPrefix = "idc",
}: {
  data: IdCardData;
  status: CardStatus;
  qr: { size: number; d: string } | null;
  logoHref: string;
  company?: string;
  tagline?: string;
  verifyHost?: string;
  className?: string;
  /** Unique prefix for SVG ids when several cards share a page. */
  idPrefix?: string;
}) {
  const uid = idPrefix;
  const st = STATUS_STYLE[status];
  const name = data.displayName;
  const nameSize = name.length > 26 ? 24 : name.length > 20 ? 28 : 34;
  const rows: [string, string, boolean][] = [
    ["EMPLOYEE ID", data.employeeCode, true],
    ["DEPARTMENT", fit(data.department ?? "—", 18), false],
    ["VALID UNTIL", formatDate(data.idExpiresAt), false],
  ];
  const pillW = st.label.length * 10 + 44;

  return (
    <svg
      viewBox="0 0 540 856"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Employee ID card for ${name}, ${data.employeeCode}, status ${st.label.toLowerCase()}`}
      className={className}
      data-testid="id-card-svg"
      fontFamily={FONT}
    >
      <defs>
        <linearGradient id={`${uid}hdr`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0b1f3a" />
          <stop offset="0.6" stopColor="#1e2a6e" />
          <stop offset="1" stopColor="#3b2f8f" />
        </linearGradient>
        <linearGradient id={`${uid}ftr`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0d9488" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id={`${uid}ring`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <clipPath id={`${uid}card`}>
          <rect width="540" height="856" rx="30" />
        </clipPath>
        <clipPath id={`${uid}photo`}>
          <circle cx="270" cy="262" r="92" />
        </clipPath>
        <clipPath id={`${uid}logo`}>
          <rect x="36" y="34" width="62" height="62" rx="14" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}card)`}>
        <rect width="540" height="856" fill="#ffffff" />
        {/* Header */}
        <rect width="540" height="236" fill={`url(#${uid}hdr)`} />
        <circle cx="490" cy="20" r="120" fill="#22d3ee" opacity="0.10" />
        <circle cx="430" cy="210" r="70" fill="#a78bfa" opacity="0.12" />
        <circle cx="-10" cy="230" r="80" fill="#14b8a6" opacity="0.10" />
        <image href={logoHref} x="36" y="34" width="62" height="62" clipPath={`url(#${uid}logo)`} preserveAspectRatio="xMidYMid slice" />
        <text x="114" y="62" fill="#ffffff" fontSize="25" fontWeight="700" letterSpacing="0.5">
          {fit(company.toUpperCase(), 20)}
        </text>
        <text x="114" y="88" fill="#ccfbf1" fontSize="14" opacity="0.85">
          {fit(tagline, 40)}
        </text>
        <text x="36" y="146" fill="#ffffff" fontSize="13" fontWeight="600" letterSpacing="3" opacity="0.7">
          EMPLOYEE IDENTITY CARD
        </text>

        {/* Photo */}
        <circle cx="270" cy="262" r="104" fill={`url(#${uid}ring)`} />
        <circle cx="270" cy="262" r="98" fill="#ffffff" />
        {data.photo ? (
          <image href={data.photo} x="178" y="170" width="184" height="184" clipPath={`url(#${uid}photo)`} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <>
            <circle cx="270" cy="262" r="92" fill="#e3eaf5" />
            <text x="270" y="282" textAnchor="middle" fill="#13294b" fontSize="56" fontWeight="600">
              {initials(name)}
            </text>
          </>
        )}

        {/* Name, title, status */}
        <text x="270" y="410" textAnchor="middle" fill="#0f1d33" fontSize={nameSize} fontWeight="700" data-testid="employee-name">
          {fit(name, 32)}
        </text>
        <text x="270" y="444" textAnchor="middle" fill="#56657a" fontSize="19">
          {fit(data.jobTitle ?? "", 36)}
        </text>
        <rect x={270 - pillW / 2} y="462" width={pillW} height="34" rx="17" fill={st.fill} />
        <circle cx={270 - pillW / 2 + 22} cy="479" r="5" fill={st.text} />
        <text x={270 + 8} y="485" textAnchor="middle" fill={st.text} fontSize="15" fontWeight="700" letterSpacing="1">
          {st.label}
        </text>

        {/* Details + QR */}
        <line x1="36" y1="524" x2="504" y2="524" stroke="#dde4ee" strokeWidth="2" />
        {rows.map(([label, value, mono], i) => (
          <g key={label}>
            <text x="40" y={566 + i * 76} fill="#8593a6" fontSize="12" fontWeight="600" letterSpacing="2">
              {label}
            </text>
            <text x="40" y={594 + i * 76} fill="#0f1d33" fontSize={mono ? 22 : 20} fontWeight={mono ? 700 : 600} fontFamily={mono ? MONO : FONT}>
              {value}
            </text>
          </g>
        ))}
        {qr && (
          <g>
            <rect x="320" y="544" width="184" height="184" rx="16" fill="#ffffff" stroke="#dde4ee" strokeWidth="2" />
            <svg x="332" y="556" width="160" height="160" viewBox={`-1 -1 ${qr.size + 2} ${qr.size + 2}`} shapeRendering="crispEdges">
              <path d={qr.d} fill="#0b1f3a" />
            </svg>
            <text x="412" y="752" textAnchor="middle" fill="#56657a" fontSize="13" fontWeight="600">
              Scan to verify
            </text>
          </g>
        )}

        {/* Footer */}
        <rect y="790" width="540" height="66" fill={`url(#${uid}ftr)`} />
        <text x="270" y="820" textAnchor="middle" fill="#ffffff" fontSize="14" fontWeight="600">
          Property of {fit(company, 28)} · Status is checked live
        </text>
        {verifyHost && (
          <text x="270" y="841" textAnchor="middle" fill="#ecfeff" fontSize="12" opacity="0.85">
            {fit(verifyHost, 48)}
          </text>
        )}
      </g>
      <rect x="1" y="1" width="538" height="854" rx="29" fill="none" stroke="#dde4ee" strokeWidth="2" />
    </svg>
  );
}
