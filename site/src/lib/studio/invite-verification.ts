import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Gates a studio manager invite behind a one-time code emailed to the
// INVITING manager's own address — proof a human with inbox access approved
// this specific invite, not just that the browser session is authenticated,
// before the actual invite email goes out to the invitee. When the inviting
// manager also has Telegram linked, a SECOND, independent code goes there
// and both are required — a compromised inbox alone can no longer invite a
// manager. Stateless like lib/admin/action-verification.ts: the code hashes
// and the invite they authorize travel inside the signed challenge itself,
// so there's no DB row to add or expire.
type ChallengePayload = {
  requesterId: string;
  studioId: string;
  email: string;
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

export function generateInviteCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function createInviteChallenge(params: {
  requesterId: string;
  studioId: string;
  email: string;
  code: string;
  telegramCode: string | null;
}): string {
  const payload: ChallengePayload = {
    codeHash: hashCode(params.code),
    email: params.email,
    iat: Date.now(),
    requesterId: params.requesterId,
    studioId: params.studioId,
    telegramCodeHash: params.telegramCode ? hashCode(params.telegramCode) : null,
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifyInviteChallenge(params: {
  challenge: string;
  code: string;
  telegramCode?: string;
  requesterId: string;
  studioId: string;
  email: string;
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
  if (
    payload.requesterId !== params.requesterId ||
    payload.studioId !== params.studioId ||
    payload.email !== params.email
  ) {
    return false;
  }
  if (!timingSafeStringsEqual(hashCode(params.code), payload.codeHash)) return false;

  // A Telegram code was issued alongside the email one — both are
  // required, not either/or.
  if (payload.telegramCodeHash) {
    if (!params.telegramCode) return false;
    if (!timingSafeStringsEqual(hashCode(params.telegramCode), payload.telegramCodeHash)) return false;
  }

  return true;
}
