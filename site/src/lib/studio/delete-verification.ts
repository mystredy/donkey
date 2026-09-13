import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Gates studio deletion behind a one-time code sent to the OWNER's own
// email — proof a human with inbox access actually approved this specific
// deletion, not just that the browser session is authenticated. When the
// owner also has Telegram linked, a SECOND, independent code goes there and
// both are required — a compromised inbox alone can no longer delete a
// studio. Stateless like invite-verification.ts: the code hashes and the
// studio they authorize travel inside the signed challenge itself, so
// there's no DB row to add or expire.
type ChallengePayload = {
  requesterId: string;
  studioId: string;
  codeHash: string;
  telegramCodeHash: string | null;
  iat: number;
};

const EXPIRY_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

function timingSafeStringsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function generateDeleteCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createDeleteChallenge(params: {
  requesterId: string;
  studioId: string;
  code: string;
  telegramCode: string | null;
}): string {
  const payload: ChallengePayload = {
    codeHash: hashCode(params.code),
    iat: Date.now(),
    requesterId: params.requesterId,
    studioId: params.studioId,
    telegramCodeHash: params.telegramCode ? hashCode(params.telegramCode) : null,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyDeleteChallenge(params: {
  challenge: string;
  code: string;
  telegramCode?: string;
  requesterId: string;
  studioId: string;
}): boolean {
  const [body, sig] = params.challenge.split(".");
  if (!body || !sig) return false;
  if (!timingSafeStringsEqual(sig, sign(body))) return false;

  let payload: ChallengePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return false;
  }

  if (Date.now() - payload.iat > EXPIRY_MS) return false;
  if (payload.requesterId !== params.requesterId || payload.studioId !== params.studioId) return false;
  if (!timingSafeStringsEqual(hashCode(params.code), payload.codeHash)) return false;

  // A Telegram code was issued alongside the email one — both are required,
  // not either/or.
  if (payload.telegramCodeHash) {
    if (!params.telegramCode) return false;
    if (!timingSafeStringsEqual(hashCode(params.telegramCode), payload.telegramCodeHash)) return false;
  }

  return true;
}
