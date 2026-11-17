/**
 * Sania Job Bowl brand constants, taken from public/branding/Sania Brand Guidelines.pdf
 * (colours p.22–31, typography p.35–38) and the approved ID / visiting card artwork.
 */

/** Core palette (p.22) and the Royal Blue tone scale (p.24). */
export const BRAND_COLORS = {
  royalBlue: "#2E3A97",
  blackRussian: "#030015",
  athensWhite: "#F0F0F2",
  royal: {
    50: "#FBFBFE",
    100: "#D4D8F2",
    200: "#ADB4E6",
    300: "#868FDA",
    400: "#5E6CCE",
    500: "#3A4AC0",
    600: "#2E3A97",
    700: "#232C71",
    800: "#171D4A",
    900: "#0B0E23",
  },
} as const;

/** Card typeface. The same Urbanist file the app uses is embedded when cards are exported. */
export const BRAND_FONT_URL = "/fonts/urbanist-latin-wght-normal.woff2";
export const BRAND_FONT_STACK = "Urbanist, 'Segoe UI', Arial, Helvetica, sans-serif";

/** Company contact details printed on the ID card back and visiting cards. */
export const BRAND_CONTACT = {
  legalName: "Sania Job Bowl Pvt. Ltd.",
  tagline: "Connecting Talent. Creating the Future.",
  phone: "+91 63611 86321",
  email: "connect@saniajobbowl.com",
  website: "saniajobbowl.com",
  city: "Bengaluru, India",
  registeredOffice: "Bengaluru, Karnataka, India",
} as const;

/** The seven business verticals listed on the visiting card, in print order (4 + 3). */
export const BRAND_VERTICALS = [
  ["Talent", "Solutions"],
  ["One Day", "Hiring"],
  ["Payroll", "Solutions"],
  ["Global", "Placements"],
  ["Educational", "Services"],
  ["Skill", "Academy"],
  ["Job", "Mitra"],
] as const;
