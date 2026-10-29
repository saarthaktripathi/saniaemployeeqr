import "server-only";
import { hash, verify } from "@node-rs/argon2";

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1).
const OPTIONS = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword({ hash: digest, password }: { hash: string; password: string }): Promise<boolean> {
  try {
    return await verify(digest, password);
  } catch {
    return false;
  }
}
