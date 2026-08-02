// Saved screens, articles, and chart layouts — one resource family, action-based.

import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, handleError, ok, parseBody } from "@/lib/api";

export const dynamic = "force-dynamic";

const getSchema = z.enum(["screens", "articles", "charts"]);

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const kind = getSchema.safeParse(new URL(req.url).searchParams.get("kind"));
    if (!kind.success) return fail(400, "VALIDATION", "kind must be screens|articles|charts");
    if (kind.data === "screens") return ok(await prisma.savedScreen.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }));
    if (kind.data === "articles") return ok(await prisma.savedArticle.findMany({ where: { userId: user.id }, orderBy: { savedAt: "desc" } }));
    return ok(await prisma.chartLayout.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }));
  } catch (err) {
    return handleError(err);
  }
}

const postSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("screen"), name: z.string().min(1).max(60), criteria: z.string().min(2).max(20_000) }),
  z.object({ kind: z.literal("article"), id: z.string().min(1).max(200), title: z.string().min(1).max(500), source: z.string().max(100), url: z.string().max(1000), symbol: z.string().max(12).optional() }),
  z.object({ kind: z.literal("chart"), name: z.string().min(1).max(60), symbol: z.string().min(1).max(12), settings: z.string().min(2).max(20_000) }),
  z.object({ kind: z.literal("deleteScreen"), id: z.string().min(1) }),
  z.object({ kind: z.literal("deleteArticle"), id: z.string().min(1) }),
  z.object({ kind: z.literal("deleteChart"), id: z.string().min(1) }),
]);

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, postSchema);
    if (parsed instanceof Response) return parsed;
    switch (parsed.kind) {
      case "screen": {
        JSON.parse(parsed.criteria);
        return ok(await prisma.savedScreen.create({ data: { userId: user.id, name: parsed.name, criteria: parsed.criteria } }), { status: 201 });
      }
      case "article":
        return ok(await prisma.savedArticle.upsert({
          where: { userId_articleId: { userId: user.id, articleId: parsed.id } },
          create: { userId: user.id, articleId: parsed.id, title: parsed.title, source: parsed.source, url: parsed.url, symbol: parsed.symbol ?? null },
          update: {},
        }), { status: 201 });
      case "chart": {
        JSON.parse(parsed.settings);
        return ok(await prisma.chartLayout.create({ data: { userId: user.id, name: parsed.name, symbol: parsed.symbol.toUpperCase(), settings: parsed.settings } }), { status: 201 });
      }
      case "deleteScreen": {
        const screen = await prisma.savedScreen.findFirst({ where: { id: parsed.id, userId: user.id } });
        if (!screen) return fail(404, "NOT_FOUND", "Screen not found");
        await prisma.savedScreen.delete({ where: { id: screen.id } });
        return ok({ deleted: screen.id });
      }
      case "deleteArticle": {
        // The client may send either the row's cuid id or its articleId.
        const article = await prisma.savedArticle.findFirst({ where: { userId: user.id, OR: [{ id: parsed.id }, { articleId: parsed.id }] } });
        if (!article) return fail(404, "NOT_FOUND", "Article not found");
        await prisma.savedArticle.delete({ where: { id: article.id } });
        return ok({ deleted: article.id });
      }
      case "deleteChart": {
        const chart = await prisma.chartLayout.findFirst({ where: { id: parsed.id, userId: user.id } });
        if (!chart) return fail(404, "NOT_FOUND", "Chart layout not found");
        await prisma.chartLayout.delete({ where: { id: chart.id } });
        return ok({ deleted: chart.id });
      }
    }
  } catch (err) {
    return handleError(err);
  }
}
