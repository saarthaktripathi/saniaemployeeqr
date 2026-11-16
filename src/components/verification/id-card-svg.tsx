import { formatDate, initials } from "@/lib/cn";
import { BRAND_CONTACT, BRAND_FONT_STACK } from "@/lib/brand";
import { SaniaLogo, logoRatio } from "@/components/brand/sania-logo";
import { CardIcon } from "@/components/cards/card-icons";
import { clip, fitSize, textWidth } from "@/components/cards/text-metrics";

export type CardStatus = "VALID" | "INACTIVE" | "EXPIRED" | "REVOKED";

export interface IdCardData {
  displayName: string;
  employeeCode: string;
  jobTitle: string | null;
  /** The employee's group company (shown next to the employee ID when it is not the parent company). */
  companyName?: string | null;
  department: string | null;
  idExpiresAt: string;
  /** Data URL or same-origin URL; null shows initials. */
  photo: string | null;
}

/** Printed card sizes in millimetres, read by the exporter to size PDF pages. */
export const ID_CARD_MM = { front: "54x85.6", back: "85.6x54" } as const;

const STATUS_STYLE: Record<CardStatus, { label: string; fill: string; text: string }> = {
  VALID: { label: "ACTIVE · VALID", fill: "#ebfaf1", text: "#0f572c" },
  INACTIVE: { label: "INACTIVE", fill: "#fef3f1", text: "#ad2d0f" },
  EXPIRED: { label: "EXPIRED", fill: "#fdf5e4", text: "#a15c07" },
  REVOKED: { label: "REVOKED", fill: "#fef3f1", text: "#ad2d0f" },
};

const INK = "#030015";
const MUTED = "#4f4d5b";
const W = 540;
const H = 856;
const PHOTO_H = 578;
const PAD = 36;

/** Splits a name over two lines (first name / rest) the way the brand badge sets it. */
function nameLines(name: string): string[] {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words;
  let best: string[] = [];
  let widest = Infinity;
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
    const w = Math.max(...lines.map((l) => textWidth(l, 100, 800)));
    if (w < widest) [best, widest] = [lines, w];
  }
  return best;
}

/**
 * Front of the employee ID card (brand book p.52): portrait CR80 (54 × 85.6 mm, drawn at
 * 540 × 856), photo on a Royal Blue gradient, the name in Urbanist ExtraBold on an Athens White
 * panel, website and logo along the bottom. The same markup is used on screen, in print and for
 * the PNG/PDF downloads.
 */
export function IdCardSvg({
  data,
  status,
  company = "Sania Job Bowl",
  className,
  idPrefix = "idc",
}: {
  data: IdCardData;
  status: CardStatus;
  /** Parent company name; the group company is printed only when it differs. */
  company?: string;
  className?: string;
  /** Unique prefix for SVG ids when several cards share a page. */
  idPrefix?: string;
}) {
  const uid = idPrefix;
  const st = STATUS_STYLE[status];
  const name = data.displayName;
  const lines = nameLines(name);
  const textW = W - PAD * 2;
  const nameSize = fitSize(lines, textW, 64, 800, 28, -0.03);
  const firstBase = PHOTO_H + 34 + nameSize * 0.72;
  const lineGap = nameSize * 0.98;
  const titleBase = firstBase + (lines.length - 1) * lineGap + 36;
  const idBase = titleBase + 28;
  const footerBase = H - 30;
  const logoH = 26;
  const logoW = logoH * logoRatio("horizontal");
  const groupCompany = data.companyName && data.companyName !== company ? data.companyName : null;
  const idText = clip(groupCompany ? `ID ${data.employeeCode} · ${groupCompany}` : `ID ${data.employeeCode}`, 300, 15, 600);
  const pillW = textWidth(st.label, 14, 700, 1) + 40;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Employee ID card for ${name}, ${data.employeeCode}, status ${st.label.toLowerCase()}`}
      className={className}
      data-testid="id-card-svg"
      data-card-mm={ID_CARD_MM.front}
      data-card-label="Front"
      fontFamily={BRAND_FONT_STACK}
    >
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#171D4A" />
          <stop offset="0.45" stopColor="#3A4AC0" />
          <stop offset="1" stopColor="#868FDA" />
        </linearGradient>
        <clipPath id={`${uid}card`}>
          <rect width={W} height={H} rx="28" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}card)`}>
        <rect width={W} height={H} fill="#F0F0F2" />
        {/* Photo field */}
        <rect width={W} height={PHOTO_H} fill={`url(#${uid}bg)`} />
        {data.photo ? (
          <image href={data.photo} x="0" y="0" width={W} height={PHOTO_H} preserveAspectRatio="xMidYMin slice" />
        ) : (
          <text x={W / 2} y={PHOTO_H / 2 + 52} textAnchor="middle" fill="#ffffff" fillOpacity="0.92" fontSize="150" fontWeight="800" letterSpacing="-4">
            {initials(name)}
          </text>
        )}
        {status !== "VALID" && (
          <g>
            <rect x={PAD - 8} y="28" width={pillW} height="34" rx="17" fill={st.fill} />
            <text x={PAD - 8 + pillW / 2} y="50" textAnchor="middle" fill={st.text} fontSize="14" fontWeight="700" letterSpacing="1">
              {st.label}
            </text>
          </g>
        )}

        {/* Name panel */}
        <text x={PAD} fill={INK} fontSize={nameSize} fontWeight="800" letterSpacing={-0.03 * nameSize} data-testid="employee-name">
          {lines.map((line, i) => (
            <tspan key={i} x={PAD} y={firstBase + i * lineGap}>
              {i < lines.length - 1 ? `${line} ` : line}
            </tspan>
          ))}
        </text>
        {data.jobTitle && (
          <text x={PAD} y={titleBase} fill={INK} fontSize="20" fontWeight="500" letterSpacing="-0.2">
            {clip(data.jobTitle, textW, 20, 500)}
          </text>
        )}
        <text x={PAD} y={data.jobTitle ? idBase : titleBase} fill={MUTED} fontSize="15" fontWeight="600">
          {idText}
        </text>
        <text x={W - PAD} y={data.jobTitle ? idBase : titleBase} textAnchor="end" fill={MUTED} fontSize="15" fontWeight="500">
          Valid till {formatDate(data.idExpiresAt)}
        </text>

        <text x={PAD} y={footerBase} fill={INK} fontSize="16" fontWeight="500">
          {BRAND_CONTACT.website}
        </text>
        <SaniaLogo variant="horizontal" x={W - PAD - logoW} y={footerBase - logoH + 4} width={logoW} height={logoH} fill={INK} />
      </g>
      <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} rx="27.5" fill="none" stroke="#000000" strokeOpacity="0.08" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Back of the employee ID card (public/branding/IDcard.jpeg): landscape CR80 (85.6 × 54 mm,
 * drawn at 856 × 540) on Black Russian → Royal Blue, with company contacts, the registered office
 * and the verification QR.
 */
export function IdCardBackSvg({
  qr,
  className,
  idPrefix = "idb",
}: {
  qr: { size: number; d: string } | null;
  className?: string;
  idPrefix?: string;
}) {
  const uid = idPrefix;
  const BW = 856;
  const BH = 540;
  const logoH = 46;
  const contacts = [
    { icon: "phone" as const, label: "Mobile: ", value: BRAND_CONTACT.phone },
    { icon: "mail" as const, label: "Email: ", value: BRAND_CONTACT.email },
    { icon: "globe" as const, label: "Website: ", value: BRAND_CONTACT.website },
  ];

  return (
    <svg
      viewBox={`0 0 ${BW} ${BH}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Back of the employee ID card: ${BRAND_CONTACT.legalName} contact details and verification QR code`}
      className={className}
      data-testid="id-card-back-svg"
      data-card-mm={ID_CARD_MM.back}
      data-card-label="Back"
      fontFamily={BRAND_FONT_STACK}
    >
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#030015" />
          <stop offset="0.5" stopColor="#151C64" />
          <stop offset="1" stopColor="#2E3A97" />
        </linearGradient>
        <radialGradient id={`${uid}glow`} cx="0.9" cy="0.05" r="0.55">
          <stop offset="0" stopColor="#868FDA" stopOpacity="0.55" />
          <stop offset="1" stopColor="#868FDA" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}rule`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ADB4E6" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ADB4E6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}div`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ADB4E6" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ADB4E6" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ADB4E6" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${uid}card`}>
          <rect width={BW} height={BH} rx="24" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}card)`}>
        <rect width={BW} height={BH} fill={`url(#${uid}bg)`} />
        <rect width={BW} height={BH} fill={`url(#${uid}glow)`} />

        <SaniaLogo variant="horizontal" x="41" y="41" width={logoH * logoRatio("horizontal")} height={logoH} fill="#ffffff" />

        {/* Contact information */}
        <text x="41" y="149" fill="#ffffff" fontSize="17" fontWeight="600" letterSpacing="0.6">
          CONTACT INFORMATION
        </text>
        <rect x="350" y="140" width="232" height="1.6" fill={`url(#${uid}rule)`} />
        {contacts.map((c, i) => {
          const base = 194 + i * 42;
          return (
            <g key={c.icon}>
              <CardIcon name={c.icon} x={40} y={base - 23} size={28} color="#ffffff" />
              <text x="86" y={base} fill="#ffffff" fontSize="24" fontWeight="600" letterSpacing="-0.4">
                {c.label}
                {c.value}
              </text>
            </g>
          );
        })}

        {/* Registered office */}
        <text x="41" y="328" fill="#ffffff" fontSize="17" fontWeight="600" letterSpacing="0.6">
          REGISTERED OFFICE
        </text>
        <rect x="320" y="319" width="262" height="1.6" fill={`url(#${uid}rule)`} />
        <CardIcon name="pin" x={38} y={346} size={32} color="#ffffff" hole="#151C64" />
        <text x="86" y="371" fill="#ffffff" fontSize="25" fontWeight="600" letterSpacing="-0.3">
          {BRAND_CONTACT.legalName}
        </text>
        <text x="90" y="401" fill="#ffffff" fillOpacity="0.92" fontSize="20" fontWeight="400">
          {BRAND_CONTACT.registeredOffice}
        </text>

        {/* Verification QR */}
        <rect x="636" y="125" width="180" height="180" rx="20" fill="#ffffff" />
        {qr ? (
          <svg x="650" y="139" width="152" height="152" viewBox={`-1 -1 ${qr.size + 2} ${qr.size + 2}`} shapeRendering="crispEdges">
            <path d={qr.d} fill="#030015" />
          </svg>
        ) : (
          <text x="726" y="222" textAnchor="middle" fill="#2E3A97" fontSize="16" fontWeight="600">
            QR unavailable
          </text>
        )}
        <text x="726" y="344" textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="600" letterSpacing="0.4">
          SCAN TO VERIFY ID
        </text>
        <text x="726" y="371" textAnchor="middle" fill="#D6DDFF" fontSize="17" fontWeight="300">
          Official employee
        </text>
        <text x="726" y="393" textAnchor="middle" fill="#D6DDFF" fontSize="17" fontWeight="300">
          verification
        </text>

        <rect x="92" y="452" width="672" height="1.6" fill={`url(#${uid}div)`} />
        <text x={BW / 2} y="489" textAnchor="middle" fill="#ffffff" fillOpacity="0.88" fontSize="17" fontWeight="300">
          This ID card is the property of {BRAND_CONTACT.legalName}
        </text>
      </g>
    </svg>
  );
}
