import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const KEY_ID_BYTES = 8;
const SECRET_BYTES = 32;
const CLIENT_KEY_PATTERN = /^uhm_([a-f0-9]{16})_([a-f0-9]{64})$/;
const ENROLLMENT_TOKEN_PATTERN = /^uhe_([a-f0-9]{16})_([a-f0-9]{64})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type Credential = {
  id: string;
  value: string;
  hash: string;
};

function createCredential(prefix: "uhm" | "uhe"): Credential {
  const id = randomBytes(KEY_ID_BYTES).toString("hex");
  const secret = randomBytes(SECRET_BYTES).toString("hex");
  const value = `${prefix}_${id}_${secret}`;
  return { id, value, hash: hashCredential(value) };
}

export function hashCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeHashEqual(actual: string, expected: string): boolean {
  if (!isSha256Hash(actual) || !isSha256Hash(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function createClientCredential(): Credential {
  return createCredential("uhm");
}

export function createEnrollmentCredential(): Credential {
  return createCredential("uhe");
}

export function parseClientCredential(value: string): { keyId: string; hash: string } | null {
  const match = CLIENT_KEY_PATTERN.exec(value);
  return match ? { keyId: match[1]!, hash: hashCredential(value) } : null;
}

export function parseEnrollmentCredential(value: string): { enrollmentId: string; hash: string } | null {
  const match = ENROLLMENT_TOKEN_PATTERN.exec(value);
  return match ? { enrollmentId: match[1]!, hash: hashCredential(value) } : null;
}

export function isSha256Hash(value: string): boolean {
  return SHA256_PATTERN.test(value);
}
