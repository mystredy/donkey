import { prisma } from "@/lib/prisma";

// Whether this account has Telegram linked and alerts turned on — the same
// gate notifyUserEverywhere (lib/notify.ts) uses. Checked up front so a
// caller knows whether a second factor is even possible before generating
// one.
export async function hasTelegramLinked(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    select: { notificationPreferences: { select: { telegramAlerts: true } }, telegramChatId: true },
    where: { id: userId },
  });
  return Boolean(user?.telegramChatId && user.notificationPreferences?.telegramAlerts);
}

// Sends a one-time code as a Telegram DM — the code itself wrapped in
// Telegram's own spoiler markup and pushed past the warning line, so a
// notification preview never renders it. Returns whether it actually sent;
// a caller that required this factor must treat `false` as "the second
// factor isn't available," not silently fall back to email-only.
export async function sendTelegramCode(params: {
  userId: string;
  warning: string;
  code: string;
}): Promise<boolean> {
  const user = await prisma.user.findUnique({
    select: { notificationPreferences: { select: { telegramAlerts: true } }, telegramChatId: true },
    where: { id: params.userId },
  });
  if (!user?.telegramChatId || !user.notificationPreferences?.telegramAlerts) return false;

  try {
    const bot = await prisma.socialAppConfig.findUnique({ where: { platform: "telegram" } });
    if (!bot?.enabled) return false;
    const botToken =
      process.env.TELEGRAM_BOT_TOKEN?.trim() || (bot.credentials as Record<string, string> | null)?.botToken;
    if (!botToken) return false;

    const text = [
      params.warning,
      "",
      `Code: <tg-spoiler>${params.code}</tg-spoiler>`,
      "",
      "Expires in 10 minutes. Wasn't you? Sign out of any devices you don't recognize.",
    ].join("\n");

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      body: JSON.stringify({ chat_id: user.telegramChatId, parse_mode: "HTML", text }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
