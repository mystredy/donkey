import { NextResponse } from "next/server";

import {
  notFoundResponse,
  withDepCutAuth,
  type DepCutAuthenticatedRequest,
} from "@/lib/depcut-api-auth";
import { sendStudioDeleteCode } from "@/lib/email/send-studio-delete-code";
import { prisma } from "@/lib/prisma";
import { createDeleteChallenge, generateDeleteCode } from "@/lib/studio/delete-verification";
import { escapeHtml, hasTelegramLinked, sendTelegramCode } from "@/lib/telegram/send-code";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// Owner only. Step 1 of deleting a studio: sends a one-time code to the
// owner's own email, and — when Telegram is linked — a second, independent
// code there too, both required to actually delete (see
// lib/studio/delete-verification.ts). The actual delete
// (DELETE /api/studios/[id]) only proceeds once both come back.
export const POST = withDepCutAuth(async (request: DepCutAuthenticatedRequest, context: RouteContext) => {
  const { id } = await context.params;
  const [studio, owner] = await Promise.all([
    prisma.studio.findUnique({ select: { name: true, ownerId: true }, where: { id } }),
    prisma.user.findUnique({ select: { email: true }, where: { id: request.depcut.userId } }),
  ]);
  if (!studio || !owner) return notFoundResponse();
  if (studio.ownerId !== request.depcut.userId) {
    return NextResponse.json(
      { error: "Forbidden", message: "Only the owner can delete this studio." },
      { status: 403 },
    );
  }

  const code = generateDeleteCode();
  try {
    await sendStudioDeleteCode({ code, ownerEmail: owner.email, studioName: studio.name });
  } catch (error) {
    return NextResponse.json(
      { error: "email_failed", message: error instanceof Error ? error.message : "Couldn't send the code." },
      { status: 502 },
    );
  }

  let telegramCode: string | null = null;
  if (await hasTelegramLinked(request.depcut.userId)) {
    const candidate = generateDeleteCode();
    const sent = await sendTelegramCode({
      code: candidate,
      userId: request.depcut.userId,
      warning: `⚠️ Someone asked to delete "${escapeHtml(studio.name)}" on DepCut.`,
    });
    if (sent) telegramCode = candidate;
  }

  await prisma.notification.create({
    data: {
      body: telegramCode
        ? "Codes sent to your email and Telegram — both are needed to confirm."
        : "Code sent to your email — expires in 10 minutes.",
      title: `Confirm deleting "${studio.name}"`,
      userId: request.depcut.userId,
    },
  });

  const challenge = createDeleteChallenge({
    code,
    requesterId: request.depcut.userId,
    studioId: id,
    telegramCode,
  });
  return NextResponse.json({ challenge, sentTo: owner.email, telegramRequired: telegramCode !== null });
});
