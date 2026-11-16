import { BRAND_CONTACT, BRAND_FONT_STACK, BRAND_VERTICALS } from "@/lib/brand";
import { CardIcon, type CardIconName } from "./card-icons";
import { clip, fitSize, textWidth } from "./text-metrics";

export interface VisitingCardData {
  displayName: string;
  /** Designation, printed in capitals in the title pill. */
  jobTitle: string | null;
  phone: string;
  email: string;
  website: string;
  location: string;
}

/** 3.5 × 2 in (89 × 51 mm) business card, drawn at 1050 × 600. */
export const VISITING_CARD_MM = "88.9x50.8";

const W = 1050;
const H = 600;
// Colours sampled from the approved artwork (public/branding/visitingcard.jpeg).
const NAVY = "#0c1657";
const TEXT = "#141357";
const VERTICAL_TEXT = "#0a104c";
const BRIGHT = "#0b45d6";
// Contact text stops short of the top-right sweep.
const CONTACT_W = 318;

/**
 * Employee visiting card, laid out after public/branding/visitingcard.jpeg: name and designation
 * pill, contact block, the seven Sania verticals, and the blue sweep along the top-right corner
 * and bottom edge. Text sizes adapt so long names and email addresses still fit.
 */
export function VisitingCardSvg({ data, className, idPrefix = "vc" }: { data: VisitingCardData; className?: string; idPrefix?: string }) {
  const uid = idPrefix;
  const nameSize = fitSize([data.displayName], 455, 50, 700, 30, -0.01);
  const title = (data.jobTitle ?? "").toUpperCase();
  const titleSize = fitSize([title], 380, 23, 600, 13, 0.24);
  const titleW = Math.min(440, Math.max(260, textWidth(title, titleSize, 600, titleSize * 0.24) + 76));
  const contacts: { icon: CardIconName; text: string }[] = [
    { icon: "phone", text: data.phone },
    { icon: "mail", text: data.email },
    { icon: "globe", text: data.website },
    { icon: "pin", text: data.location },
  ];
  const contactSize = fitSize(
    contacts.map((c) => c.text),
    CONTACT_W,
    28,
    500,
    16,
  );
  const row1 = BRAND_VERTICALS.slice(0, 4);
  const row2 = BRAND_VERTICALS.slice(4);
  const row1X = [396, 570, 748, 940];
  const row2X = [414, 648, 836];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`Visiting card for ${data.displayName}${data.jobTitle ? `, ${data.jobTitle}` : ""}`}
      className={className}
      data-testid="visiting-card-svg"
      data-card-mm={VISITING_CARD_MM}
      data-card-label="Card"
      fontFamily={BRAND_FONT_STACK}
    >
      <defs>
        <linearGradient id={`${uid}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f6f7fd" />
        </linearGradient>
        <linearGradient id={`${uid}pill`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0238a5" />
          <stop offset="1" stopColor="#005ae1" />
        </linearGradient>
        <linearGradient id={`${uid}deep`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0a3cc4" />
          <stop offset="1" stopColor="#012a8f" />
        </linearGradient>
        <linearGradient id={`${uid}light`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4b9bff" />
          <stop offset="1" stopColor="#2a6cf0" />
        </linearGradient>
        <linearGradient id={`${uid}sweep`} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#dbe8ff" stopOpacity="0.2" />
          <stop offset="1" stopColor="#3a8fff" />
        </linearGradient>
        <linearGradient id={`${uid}seven`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1559ec" />
          <stop offset="1" stopColor="#0236a8" />
        </linearGradient>
        <clipPath id={`${uid}card`}>
          <rect width={W} height={H} rx="30" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}card)`}>
        <rect width={W} height={H} fill={`url(#${uid}bg)`} />

        {/* Top-right sweep */}
        <path d="M760 0 C 880 16, 990 96, 1050 214 L 1050 160 C 1004 78, 934 24, 850 0 Z" fill={`url(#${uid}sweep)`} />
        <path d="M850 0 C 934 24, 1004 78, 1050 160 L 1050 0 Z" fill={`url(#${uid}deep)`} />

        {/* Name and designation */}
        <text x="46" y="146" fill={NAVY} fontSize={nameSize} fontWeight="700" letterSpacing={-0.01 * nameSize} data-testid="visiting-card-name">
          {data.displayName}
        </text>
        {title && (
          <g>
            <rect x="47" y="178" width={titleW} height="52" rx="11" fill={`url(#${uid}pill)`} />
            <text x={47 + titleW / 2} y={204 + titleSize * 0.36} textAnchor="middle" fill="#ffffff" fontSize={titleSize} fontWeight="600" letterSpacing={titleSize * 0.24}>
              {title}
            </text>
          </g>
        )}

        {/* Contacts */}
        <rect x="532" y="84" width="2.5" height="164" rx="1.25" fill="#2b2f6e" />
        {contacts.map((c, i) => {
          const base = 104 + i * 45;
          return (
            <g key={c.icon}>
              <CardIcon name={c.icon} x={568} y={base - 24} size={32} color={BRIGHT} />
              <text x="632" y={base} fill={TEXT} fontSize={contactSize} fontWeight="500" letterSpacing={-0.01 * contactSize}>
                {clip(c.text, CONTACT_W, contactSize, 500)}
              </text>
            </g>
          );
        })}

        <rect x="47" y="284" width="960" height="2" fill="#3a4ac0" />

        {/* 7 specialised verticals */}
        <text x="38" y="433" fill={`url(#${uid}seven)`} fontSize="112" fontWeight="800" letterSpacing="-4">
          7
        </text>
        <text x="108" y="394" fill="#1240c4" fontSize="24" fontWeight="800" letterSpacing="0.2">
          SPECIALIZED
        </text>
        <text x="108" y="425" fill="#1a2c8c" fontSize="24" fontWeight="800" letterSpacing="1.6">
          VERTICALS
        </text>
        <rect x="291" y="322" width="2.5" height="152" rx="1.25" fill="#2b2f6e" />

        {row1.map(([a, b], i) => (
          <text key={a + b} textAnchor="middle" fill={VERTICAL_TEXT} fontSize="25" fontWeight="700" letterSpacing="-0.3">
            <tspan x={row1X[i]} y="341">
              {a}
            </tspan>
            <tspan x={row1X[i]} y="372">
              {b}
            </tspan>
          </text>
        ))}
        {[485, 657, 838].map((x) => (
          <rect key={x} x={x} y="320" width="2" height="60" fill="#8296df" />
        ))}
        <rect x="340" y="397" width="667" height="1.6" fill="#bdc8e8" />
        {row2.map(([a, b], i) => (
          <text key={a + b} textAnchor="middle" fill={VERTICAL_TEXT} fontSize="25" fontWeight="700" letterSpacing="-0.3">
            <tspan x={row2X[i]} y="439">
              {a}
            </tspan>
            <tspan x={row2X[i]} y="470">
              {b}
            </tspan>
          </text>
        ))}
        {[535, 753].map((x) => (
          <rect key={x} x={x} y="418" width="2" height="60" fill="#8296df" />
        ))}

        {/* Bottom wave */}
        <path d="M0 508 C 140 492, 320 520, 520 546 C 700 568, 880 556, 1050 496 L 1050 600 L 0 600 Z" fill={`url(#${uid}light)`} />
        <path d="M0 540 C 170 528, 360 552, 545 566 C 730 578, 900 562, 1050 512 L 1050 600 L 0 600 Z" fill={`url(#${uid}deep)`} />
      </g>
      <rect x="0.75" y="0.75" width={W - 1.5} height={H - 1.5} rx="29.5" fill="none" stroke="#000000" strokeOpacity="0.07" strokeWidth="1.5" />
    </svg>
  );
}

/** Contact details for an employee's visiting card, falling back to the company's. */
export function visitingCardData(employee: { displayName: string; jobTitle: string | null; phone: string | null; workEmail: string | null; workLocation: string | null }): VisitingCardData {
  // A work mode ("Remote", "Hybrid") is not an address: print the company city instead.
  const location = employee.workLocation?.trim().replace(/\s+—\s+/g, ", ");
  const place = location && !/remote|hybrid|wfh|home/i.test(location) ? location : null;
  return {
    displayName: employee.displayName,
    jobTitle: employee.jobTitle,
    phone: employee.phone?.trim() || BRAND_CONTACT.phone,
    email: employee.workEmail?.trim() || BRAND_CONTACT.email,
    website: BRAND_CONTACT.website,
    location: place ? (/india/i.test(place) ? place : `${place}, India`) : BRAND_CONTACT.city,
  };
}
