import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, generateCredentialToken, hashIp, hashToken, isWellFormedToken, safeEqual } from "@/server/security/crypto";
import { parseCsv, toCsv } from "@/lib/csv";
import { _redactForTest as redact } from "@/server/logging/logger";
import { extractToken } from "@/features/verification/token";
import { AppError, httpStatus } from "@/lib/errors";

describe("credential tokens", () => {
  it("are 256-bit base64url values and unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateCredentialToken));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) expect(isWellFormedToken(t)).toBe(true);
  });
  it("hash deterministically to hex SHA-256", () => {
    const t = generateCredentialToken();
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(generateCredentialToken()));
  });
  it("rejects malformed tokens", () => {
    for (const t of ["", "short", "x".repeat(44), "a".repeat(42) + "!", null, 42, "../../etc/passwd"]) expect(isWellFormedToken(t)).toBe(false);
  });
});

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const t = generateCredentialToken();
    const a = encryptToken(t);
    const b = encryptToken(t);
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe(t);
    expect(a).not.toContain(t);
  });
  it("detects tampering", () => {
    const enc = encryptToken(generateCredentialToken());
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered-ciphertext").toString("base64url");
    expect(() => decryptToken(parts.join("."))).toThrow();
    expect(() => decryptToken("v2.a.b.c")).toThrow();
  });
});

describe("misc security helpers", () => {
  it("hashes IPs with a key and handles missing IPs", () => {
    expect(hashIp(null)).toBeNull();
    expect(hashIp("203.0.113.5")).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp("203.0.113.5")).not.toContain("203");
  });
  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("redacts sensitive keys in logs", () => {
    const out = redact({ password: "p", nested: { sessionToken: "t", ok: 1 }, cookie: "c", authorization: "Bearer x", employeeId: "e" }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect(out.cookie).toBe("[REDACTED]");
    expect(out.authorization).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).sessionToken).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
    expect(out.employeeId).toBe("e");
  });
  it("maps error codes to HTTP statuses", () => {
    expect(httpStatus[new AppError("FORBIDDEN", "x").code]).toBe(403);
    expect(httpStatus.RATE_LIMITED).toBe(429);
  });
});

describe("CSV", () => {
  it("neutralises formula injection and quotes special characters", () => {
    const csv = toCsv(["a", "b"], [["=HYPERLINK(\"x\")", "x,y"], ["+1", "-2"], ["@cmd", 'he said "hi"']]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(`"x,y"`);
    expect(csv).toContain("'+1,'-2");
    expect(csv).toContain("'@cmd");
    expect(csv).toContain(`"he said ""hi"""`);
  });
  it("parses quoted fields, CRLF and BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n3,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["3", ""],
    ]);
  });
  it("handles multi-line quoted cells", () => {
    expect(parseCsv('a\n"line1\nline2"')).toEqual([["a"], ["line1\nline2"]]);
  });
});

describe("verification link extraction", () => {
  const token = "A".repeat(43);
  it("accepts full URLs and bare tokens", () => {
    expect(extractToken(`https://verify.example.test/verify/${token}`)).toBe(token);
    expect(extractToken(`  ${token} `)).toBe(token);
    expect(extractToken(`https://x/verify/${token}?utm=1`)).toBe(token);
  });
  it("rejects anything else", () => {
    expect(extractToken("https://evil.example/login")).toBeNull();
    expect(extractToken(`https://x/verify/${token}extra`)).toBeNull();
  });
});
