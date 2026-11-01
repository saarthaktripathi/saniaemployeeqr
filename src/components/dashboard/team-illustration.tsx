/** Decorative hero art: a team high-fiving between leaves, with the company motto. Pure SVG. */
export function TeamIllustration({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <div className="relative flex items-end gap-2">
        <p className="mb-14 -rotate-6 font-serif text-[17px] leading-tight text-navy-800 italic select-none">
          “Better People,
          <br />
          <span className="pl-5">Bigger Dreams”</span>
          <svg viewBox="0 0 120 10" className="mt-0.5 ml-4 h-2.5 w-28" fill="none">
            <path d="M2 7 C 30 1, 70 1, 118 5" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </p>
        <svg viewBox="0 0 300 150" className="h-[150px] w-[300px]">
          <defs>
            <linearGradient id="ti-leaf" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#0f766e" />
              <stop offset="1" stopColor="#2dd4bf" />
            </linearGradient>
            <linearGradient id="ti-leaf2" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#15803d" />
              <stop offset="1" stopColor="#4ade80" />
            </linearGradient>
          </defs>
          {/* leaves */}
          <path d="M28 150 C 4 110, 10 70, 34 46 C 44 84, 44 118, 28 150 Z" fill="url(#ti-leaf)" />
          <path d="M44 150 C 40 112, 54 86, 78 74 C 76 104, 66 130, 44 150 Z" fill="url(#ti-leaf2)" opacity="0.9" />
          <path d="M268 150 C 292 112, 292 78, 270 52 C 256 88, 254 120, 268 150 Z" fill="url(#ti-leaf)" />
          <path d="M252 150 C 254 118, 242 94, 222 82 C 222 110, 232 134, 252 150 Z" fill="url(#ti-leaf2)" opacity="0.9" />
          {/* sparkles */}
          <path d="M150 8 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" fill="#f59f00" />
          <circle cx="182" cy="16" r="3" fill="#a78bfa" />
          <circle cx="118" cy="22" r="2.5" fill="#22d3ee" />

          {/* left person */}
          <path d="M98 150 C 96 116, 104 98, 118 96 C 132 98, 138 116, 136 150 Z" fill="#7c5cff" />
          <path d="M126 102 L 146 40" stroke="#f2b98f" strokeWidth="9" strokeLinecap="round" />
          <path d="M104 106 L 92 132" stroke="#7c5cff" strokeWidth="11" strokeLinecap="round" />
          <circle cx="117" cy="80" r="14" fill="#f2b98f" />
          <path d="M103 78 C 103 62, 130 60, 131 76 C 124 70, 112 70, 103 78 Z" fill="#1f2a44" />

          {/* middle person */}
          <path d="M136 150 C 134 118, 142 100, 156 98 C 172 100, 178 118, 176 150 Z" fill="#ff6b9a" />
          <path d="M148 104 L 150 40" stroke="#c98b66" strokeWidth="9" strokeLinecap="round" />
          <path d="M166 104 L 158 42" stroke="#c98b66" strokeWidth="9" strokeLinecap="round" />
          <circle cx="157" cy="82" r="14" fill="#c98b66" />
          <path d="M141 84 C 138 62, 176 60, 172 86 C 172 74, 166 68, 157 68 C 148 68, 143 74, 141 84 Z" fill="#2b2140" />
          <path d="M141 84 C 138 100, 146 108, 150 110 L 146 86 Z" fill="#2b2140" />

          {/* right person */}
          <path d="M176 150 C 174 116, 182 98, 198 96 C 212 98, 220 116, 218 150 Z" fill="#3b82f6" />
          <path d="M186 102 L 162 42" stroke="#e0a77f" strokeWidth="9" strokeLinecap="round" />
          <path d="M212 106 L 226 130" stroke="#3b82f6" strokeWidth="11" strokeLinecap="round" />
          <circle cx="199" cy="80" r="14" fill="#e0a77f" />
          <path d="M185 76 C 186 62, 212 62, 213 78 C 206 70, 194 70, 185 76 Z" fill="#111827" />
          <path d="M206 112 l 6 0 l 0 10 l -6 0 Z" fill="#fbbf24" opacity="0.9" />
        </svg>
      </div>
    </div>
  );
}
