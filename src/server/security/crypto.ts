import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Token format: 32 random bytes, base64url (43 chars). 256 bits of entropy. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateCredentialToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Tokens are high-entropy random values, so a fast cryptographic hash (SHA-256) is
 * appropriate for lookup — unlike passwords, they cannot be brute-forced offline.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

function key(): Buffer {
  return Buffer.from(env().CREDENTIAL_ENCRYPTION_KEY, "base64");
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url parts). */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(payload: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

/** Keyed hash of an IP so logs can correlate abuse without storing raw addresses. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHmac("sha256", env().IP_HASH_SECRET).update(ip).digest("hex").slice(0, 32);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
