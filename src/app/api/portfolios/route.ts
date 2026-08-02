import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handleError, ok, parseBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const portfolios = await prisma.portfolio.findMany({
      where: { userId: user.id },
      include: { positions: true, transactions: { orderBy: { executedAt: "desc" }, take: 500 } },
      orderBy: { createdAt: "asc" },
    });
    return ok(portfolios);
  } catch (err) {
    return handleError(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(60),
  cash: z.coerce.number().min(0).max(1e12).default(0),
});

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = await parseBody(req, createSchema);
    if (parsed instanceof Response) return parsed;
    const portfolio = await prisma.portfolio.create({
      data: { userId: user.id, name: parsed.name, cash: parsed.cash },
      include: { positions: true, transactions: true },
    });
    return ok(portfolio, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
