import { NextResponse } from "next/server";

import {
  notFoundResponse,
  withDepCutAuth,
  type DepCutAuthenticatedRequest,
} from "@/lib/depcut-api-auth";
import { deletePrefix, SPACE_PREFIX } from "@/cut/server/cloud/r2";
import { prisma } from "@/lib/prisma";
import { getStudioMembership, logStudioActivity } from "@/lib/studio/access";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; dropId: string }> };

// Managers only. Removes a drop from the feed and its R2 storage — a drop's
// files all live under space/{posterId}/posts/{dropId}/ (see dropVideoKey),
// so one prefix delete clears the video and any thumbnail together.
export const DELETE = withDepCutAuth(async (request: DepCutAuthenticatedRequest, context: RouteContext) => {
  const { id, dropId } = await context.params;
  const membership = await getStudioMembership(request.depcut.userId, id);
  if (!membership) return notFoundResponse();

  const drop = await prisma.drop.findUnique({
    select: { caption: true, fileName: true, studioId: true, userId: true },
    where: { id: dropId },
  });
  if (!drop || drop.studioId !== id) return notFoundResponse();

  await prisma.drop.delete({ where: { id: dropId } });
  await deletePrefix(`${SPACE_PREFIX}${drop.userId}/posts/${dropId}/`);

  await logStudioActivity({
    action: `Removed a drop (${drop.caption || drop.fileName || "Untitled"})`,
    actorId: request.depcut.userId,
    studioId: id,
  });

  return NextResponse.json({ ok: true });
});
