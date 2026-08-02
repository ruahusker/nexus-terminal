// Evaluate active price/volume alerts against current quotes and record events.
// Called by the client on an interval while the app is open.

import { prisma } from "@/lib/db";
import { facade } from "@/lib/providers";
import { requireUser } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await requireUser();
    const alerts = await prisma.alert.findMany({
      where: { active: true, kind: { in: ["PRICE_ABOVE", "PRICE_BELOW", "PCT_MOVE", "VOLUME_SPIKE"] } },
      include: { events: { orderBy: { triggeredAt: "desc" }, take: 1 } },
    });
    if (alerts.length === 0) return ok({ checked: 0, triggered: [] });
    const symbols = [...new Set(alerts.map((a) => a.symbol))];
    const quotes = new Map((await facade.getQuotes(symbols)).map((q) => [q.symbol, q]));
    const triggered: { alertId: string; message: string; value: number }[] = [];
    const fiveMinAgo = Date.now() - 5 * 60_000;

    for (const alert of alerts) {
      const q = quotes.get(alert.symbol);
      if (!q || alert.threshold == null) continue;
      // Debounce: don't re-fire an alert within 5 minutes
      if (alert.events[0] && new Date(alert.events[0].triggeredAt).getTime() > fiveMinAgo) continue;
      let hit: { message: string; value: number } | null = null;
      if (alert.kind === "PRICE_ABOVE" && q.price >= alert.threshold)
        hit = { message: `${alert.symbol} ${q.price.toFixed(2)} ≥ ${alert.threshold}`, value: q.price };
      else if (alert.kind === "PRICE_BELOW" && q.price <= alert.threshold)
        hit = { message: `${alert.symbol} ${q.price.toFixed(2)} ≤ ${alert.threshold}`, value: q.price };
      else if (alert.kind === "PCT_MOVE" && Math.abs(q.changePct * 100) >= alert.threshold)
        hit = { message: `${alert.symbol} moved ${(q.changePct * 100).toFixed(2)}% (threshold ${alert.threshold}%)`, value: q.changePct * 100 };
      else if (alert.kind === "VOLUME_SPIKE" && q.avgVolume > 0 && q.volume / q.avgVolume >= alert.threshold)
        hit = { message: `${alert.symbol} volume ${(q.volume / q.avgVolume).toFixed(1)}× average`, value: q.volume / q.avgVolume };
      if (hit) {
        await prisma.alertEvent.create({ data: { alertId: alert.id, message: hit.message, value: hit.value } });
        triggered.push({ alertId: alert.id, ...hit });
      }
    }
    return ok({ checked: alerts.length, triggered });
  } catch (err) {
    return handleError(err);
  }
}
