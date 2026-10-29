const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Extracts the credential token from a pasted verification URL (or a bare token). */
export function extractToken(value: string): string | null {
  const v = value.trim();
  if (TOKEN.test(v)) return v;
  const m = v.match(/\/verify\/([A-Za-z0-9_-]{43})(?:[/?#]|$)/);
  return m ? m[1]! : null;
}
