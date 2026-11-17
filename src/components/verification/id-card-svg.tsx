import type { ReactNode } from "react";
import { formatDate, initials } from "@/lib/cn";
import { BRAND_COLORS, BRAND_CONTACT, BRAND_FONT_STACK } from "@/lib/brand";
import { SaniaLogo, logoRatio } from "@/components/brand/sania-logo";
import { CardIcon } from "@/components/cards/card-icons";
import { clip, fitSize, textWidth, type CardWeight } from "@/components/cards/text-metrics";

export type CardStatus = "VALID" | "INACTIVE" | "EXPIRED" | "REVOKED";

export interface IdCardData {
  displayName: string;
  employeeCode: string;
  jobTitle: string | null;
  /** The employee's group company (shown next to the validity date when it is not the parent company). */
  companyName?: string | null;
  department: string | null;
  idExpiresAt: string;
  /** Data URL or same-origin URL; null shows initials. */
  photo: string | null;
}

/** Printed card sizes in millimetres, read by the exporter to size PDF pages. Both sides are portrait CR80. */
export const ID_CARD_MM = { front: "54x85.6", back: "54x85.6" } as const;

const STATUS_STYLE: Record<CardStatus, { label: string; fill: string; text: string }> = {
  VALID: { label: "ACTIVE · VALID", fill: "#ebfaf1", text: "#0f572c" },
  INACTIVE: { label: "INACTIVE", fill: "#fef3f1", text: "#ad2d0f" },
  EXPIRED: { label: "EXPIRED", fill: "#fdf5e4", text: "#a15c07" },
  REVOKED: { label: "REVOKED", fill: "#fef3f1", text: "#ad2d0f" },
};

/** Both sides are drawn at 540 × 856 (CR80 portrait, 10 units per mm). */
const W = 540;
const H = 856;
const CX = W / 2;
const SOFT = BRAND_COLORS.royal[100]; // secondary text on the navy background
const FAINT = BRAND_COLORS.royal[200];

/** Splits a name over two lines (first name / rest), picking the most balanced split. */
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
 * Shared artwork for both sides: Black Russian → Royal Blue gradient with a soft indigo glow,
 * light diagonal panes top-right, layered waves bottom-left, and a Royal Blue border inset on
 * all four sides. Content is clipped to the rounded card.
 */
function CardFrame({ uid, label, testId, mm, side, className, children }: { uid: string; label: string; testId: string; mm: string; side: string; className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={label}
      className={className}
      data-testid={testId}
      data-card-mm={mm}
      data-card-label={side}
      fontFamily={BRAND_FONT_STACK}
    >
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#060A2E" />
          <stop offset="0.48" stopColor="#141B66" />
          <stop offset="1" stopColor={BRAND_COLORS.royalBlue} />
        </linearGradient>
        <radialGradient id={`${uid}glow`} cx="0.95" cy="0.02" r="0.7">
          <stop offset="0" stopColor={BRAND_COLORS.royal[400]} stopOpacity="0.5" />
          <stop offset="1" stopColor={BRAND_COLORS.royal[400]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${uid}wave`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={BRAND_COLORS.royal[400]} stopOpacity="0.55" />
          <stop offset="1" stopColor={BRAND_COLORS.royal[500]} stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id={`${uid}border`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND_COLORS.royal[200]} />
          <stop offset="0.5" stopColor={BRAND_COLORS.royal[400]} />
          <stop offset="1" stopColor={BRAND_COLORS.royal[200]} />
        </linearGradient>
        <linearGradient id={`${uid}rule`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={FAINT} stopOpacity="0" />
          <stop offset="0.5" stopColor={FAINT} stopOpacity="0.75" />
          <stop offset="1" stopColor={FAINT} stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${uid}card`}>
          <rect width={W} height={H} rx="28" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}card)`}>
        <rect width={W} height={H} fill={`url(#${uid}bg)`} />
        <rect width={W} height={H} fill={`url(#${uid}glow)`} />
        <path d={`M300 0H${W}V300Z`} fill="#ffffff" fillOpacity="0.035" />
        <path d={`M410 0H${W}V150Z`} fill="#ffffff" fillOpacity="0.04" />
        <path d={`M0 736C130 704 260 738 390 800C440 824 480 842 512 ${H}H0Z`} fill={`url(#${uid}wave)`} />
        <path d={`M0 792C110 772 220 792 320 ${H}H0Z`} fill={BRAND_COLORS.royal[400]} fillOpacity="0.32" />
        {children}
      </g>

      {/* Company-colour border on all four sides */}
      <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} rx="27.25" fill="none" stroke={BRAND_COLORS.royalBlue} strokeWidth="1.5" />
      <rect x="12" y="12" width={W - 24} height={H - 24} rx="18" fill="none" stroke={`url(#${uid}border)`} strokeOpacity="0.85" strokeWidth="2.4" />
    </svg>
  );
}

/** White logo centred at the top with the brand tagline beneath it (same on both sides). */
function CardHeader() {
  const logoH = 60;
  const logoW = logoH * logoRatio("horizontal");
  return (
    <>
      <SaniaLogo variant="horizontal" x={CX - logoW / 2} y="36" width={logoW} height={logoH} fill="#ffffff" />
      <text x={CX} y="127" textAnchor="middle" fill={SOFT} fontSize="17" fontWeight="500" letterSpacing="0.2">
        {BRAND_CONTACT.tagline}
      </text>
    </>
  );
}

/** Outlined capsule with text, as used for section headings, the employee ID and the QR caption. */
function Pill({ x, y, text, size, weight = 700, letterSpacing = 1.2, align = "center", height = 40 }: { x: number; y: number; text: string; size: number; weight?: CardWeight; letterSpacing?: number; align?: "center" | "start"; height?: number }) {
  const w = textWidth(text, size, weight, letterSpacing) + 44;
  const left = align === "center" ? x - w / 2 : x;
  return (
    <g>
      <rect x={left} y={y} width={w} height={height} rx={height / 2} fill="#ffffff" fillOpacity="0.06" stroke="#ffffff" strokeWidth="1.8" />
      <text x={left + w / 2} y={y + height / 2 + size * 0.36} textAnchor="middle" fill="#ffffff" fontSize={size} fontWeight={weight} letterSpacing={letterSpacing}>
        {text}
      </text>
    </g>
  );
}

function Rule({ uid, y, x1 = 56, x2 = W - 56 }: { uid: string; y: number; x1?: number; x2?: number }) {
  return <rect x={x1} y={y} width={x2 - x1} height="1.6" fill={`url(#${uid}rule)`} />;
}

/**
 * Front of the employee ID card: portrait CR80 (54 × 85.6 mm, drawn at 540 × 856) with the logo
 * and tagline, a framed photo, the name in Urbanist ExtraBold, designation, an ID capsule, the
 * validity date and the website. The same markup is used on screen, in print and for the PNG/PDF
 * downloads; every field comes from the employee record.
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
  const textW = W - 100;

  // Photo: white frame with the picture (or initials) inside.
  const frame = { x: 125, y: 150, w: 290, h: 330 };
  const photo = { x: frame.x + 7, y: frame.y + 7, w: frame.w - 14, h: frame.h - 14 };

  // Text block below the photo flows from the top, so one- and two-line names both fit.
  const rule1 = frame.y + frame.h + 26;
  const nameSize = fitSize(lines, textW, lines.length > 1 ? 46 : 50, 800, 26, 0.01);
  const firstBase = rule1 + 18 + nameSize * 0.76;
  const lineGap = nameSize * 1.04;
  const lastBase = firstBase + (lines.length - 1) * lineGap;
  const rule2 = lastBase + 22;
  // Long designations shrink (down to 18) before they are shortened with an ellipsis.
  const titleSize = data.jobTitle ? fitSize([data.jobTitle], textW, 23, 500, 18) : 23;
  const titleBase = rule2 + 38;
  const pillY = data.jobTitle ? titleBase + 20 : rule2 + 20;
  const validBase = pillY + 42 + 30;

  const groupCompany = data.companyName && data.companyName !== company ? data.companyName : null;
  const validText = clip(`${groupCompany ? `${groupCompany} · ` : ""}Valid till ${formatDate(data.idExpiresAt)}`, textW, 15, 500);
  const statusW = textWidth(st.label, 13, 700, 1) + 30;

  return (
    <CardFrame uid={uid} label={`Employee ID card for ${name}, ${data.employeeCode}, status ${st.label.toLowerCase()}`} testId="id-card-svg" mm={ID_CARD_MM.front} side="Front" className={className}>
      <defs>
        <linearGradient id={`${uid}ph`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={BRAND_COLORS.royal[800]} />
          <stop offset="0.5" stopColor={BRAND_COLORS.royal[500]} />
          <stop offset="1" stopColor={BRAND_COLORS.royal[300]} />
        </linearGradient>
        <clipPath id={`${uid}photo`}>
          <rect x={photo.x} y={photo.y} width={photo.w} height={photo.h} rx="20" />
        </clipPath>
      </defs>

      <CardHeader />

      {/* Photo */}
      <rect x={frame.x - 5} y={frame.y - 5} width={frame.w + 10} height={frame.h + 10} rx="31" fill="none" stroke={FAINT} strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} rx="26" fill="#ffffff" />
      <g clipPath={`url(#${uid}photo)`}>
        <rect x={photo.x} y={photo.y} width={photo.w} height={photo.h} fill={`url(#${uid}ph)`} />
        {data.photo ? (
          <image href={data.photo} x={photo.x} y={photo.y} width={photo.w} height={photo.h} preserveAspectRatio="xMidYMid slice" />
        ) : (
          <text x={CX} y={photo.y + photo.h / 2 + 46} textAnchor="middle" fill="#ffffff" fillOpacity="0.92" fontSize="132" fontWeight="800" letterSpacing="-3">
            {initials(name)}
          </text>
        )}
      </g>
      {status !== "VALID" && (
        <g>
          <rect x={CX - statusW / 2} y={frame.y + frame.h - 22} width={statusW} height="32" rx="16" fill={st.fill} stroke="#ffffff" strokeWidth="2" />
          <text x={CX} y={frame.y + frame.h - 1} textAnchor="middle" fill={st.text} fontSize="13" fontWeight="700" letterSpacing="1">
            {st.label}
          </text>
        </g>
      )}

      {/* Name, designation, ID */}
      <Rule uid={uid} y={rule1} />
      <text x={CX} textAnchor="middle" fill="#ffffff" fontSize={nameSize} fontWeight="800" letterSpacing={0.01 * nameSize} data-testid="employee-name">
        {lines.map((line, i) => (
          <tspan key={i} x={CX} y={firstBase + i * lineGap}>
            {i < lines.length - 1 ? `${line} ` : line}
          </tspan>
        ))}
      </text>
      <Rule uid={uid} y={rule2} />
      {data.jobTitle && (
        <text x={CX} y={titleBase} textAnchor="middle" fill="#ffffff" fillOpacity="0.95" fontSize={titleSize} fontWeight="500">
          {clip(data.jobTitle, textW, titleSize, 500)}
        </text>
      )}
      <Pill x={CX} y={pillY} height={42} text={`ID ${data.employeeCode}`} size={19} weight={700} letterSpacing={1} />
      <text x={CX} y={validBase} textAnchor="middle" fill={SOFT} fontSize="15" fontWeight="500" letterSpacing="0.3">
        {validText}
      </text>

      {/* Website */}
      <CardIcon name="globe" x={W - 52 - textWidth(BRAND_CONTACT.website, 18, 500) - 28} y={H - 62} size={21} color="#ffffff" />
      <text x={W - 52} y={H - 45} textAnchor="end" fill="#ffffff" fontSize="18" fontWeight="500" letterSpacing="0.2">
        {BRAND_CONTACT.website}
      </text>
    </CardFrame>
  );
}

/**
 * Back of the employee ID card: portrait CR80 like the front, on the same background, with
 * company contacts, the registered office and the employee's verification QR.
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
  const textX = 94;
  const textW = W - textX - 44;
  const contacts = [
    { icon: "phone" as const, label: "Mobile: ", value: BRAND_CONTACT.phone },
    { icon: "mail" as const, label: "Email: ", value: BRAND_CONTACT.email },
    { icon: "globe" as const, label: "Website: ", value: BRAND_CONTACT.website },
  ];
  // One size for all three rows, shrunk only if the longest one would not fit.
  const contactSize = Math.min(21, ...contacts.map((c) => Math.floor((textW / (textWidth(c.label, 21, 400) + textWidth(c.value, 21, 600))) * 21 * 10) / 10));
  const tile = { size: 180, y: 494 };

  return (
    <CardFrame uid={uid} label={`Back of the employee ID card: ${BRAND_CONTACT.legalName} contact details and verification QR code`} testId="id-card-back-svg" mm={ID_CARD_MM.back} side="Back" className={className}>
      <CardHeader />

      {/* Contact information */}
      <Pill x={48} y={150} text="CONTACT INFORMATION" size={17} align="start" />
      {contacts.map((c, i) => {
        const base = 230 + i * 42;
        return (
          <g key={c.icon}>
            <CardIcon name={c.icon} x={52} y={base - 21} size={26} color="#ffffff" />
            <text x={textX} y={base} fill="#ffffff" fontSize={contactSize} letterSpacing="-0.1">
              <tspan fill={SOFT} fontWeight="400">
                {c.label}
              </tspan>
              <tspan fontWeight="600">{c.value}</tspan>
            </text>
          </g>
        );
      })}

      <Rule uid={uid} y={342} />

      {/* Registered office */}
      <Pill x={48} y={362} text="REGISTERED OFFICE" size={17} align="start" />
      <CardIcon name="pin" x={50} y={418} size={30} color="#ffffff" hole="#141B66" />
      <text x={textX} y="440" fill="#ffffff" fontSize="22" fontWeight="600" letterSpacing="-0.2">
        {clip(BRAND_CONTACT.legalName, textW, 22, 600)}
      </text>
      <text x={textX} y="468" fill={SOFT} fontSize="18.5" fontWeight="400">
        {clip(BRAND_CONTACT.registeredOffice, textW, 18.5, 400)}
      </text>

      {/* Verification QR */}
      <rect x={CX - tile.size / 2} y={tile.y} width={tile.size} height={tile.size} rx="22" fill="#ffffff" />
      {qr ? (
        <svg x={CX - tile.size / 2 + 14} y={tile.y + 14} width={tile.size - 28} height={tile.size - 28} viewBox={`-1 -1 ${qr.size + 2} ${qr.size + 2}`} shapeRendering="crispEdges">
          <path d={qr.d} fill={BRAND_COLORS.blackRussian} />
        </svg>
      ) : (
        <text x={CX} y={tile.y + tile.size / 2 + 6} textAnchor="middle" fill={BRAND_COLORS.royalBlue} fontSize="16" fontWeight="600">
          QR unavailable
        </text>
      )}
      <Pill x={CX} y={692} text="SCAN TO VERIFY ID" size={17} />
      <text x={CX} y="758" textAnchor="middle" fill={SOFT} fontSize="16" fontWeight="400" letterSpacing="0.2">
        Official employee verification
      </text>

      <Rule uid={uid} y={780} x1={60} x2={W - 60} />
      <text x={CX} y="807" textAnchor="middle" fill="#ffffff" fillOpacity="0.9" fontSize="15" fontWeight="400">
        This ID card is the property of {BRAND_CONTACT.legalName}
      </text>
      <text x={CX} y="829" textAnchor="middle" fill={FAINT} fontSize="13.5" fontWeight="400">
        If found, please return it to the registered office.
      </text>
    </CardFrame>
  );
}
