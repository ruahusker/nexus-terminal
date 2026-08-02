// Password hashing + new-user provisioning — no Next.js imports, safe for scripts.

import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "./db.ts";

const scrypt = promisify(_scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Provision starter content for a brand-new account. */
export async function provisionNewUser(userId: string): Promise<void> {
  await prisma.watchlist.create({
    data: {
      userId,
      name: "Core",
      items: { create: ["AAPL", "MSFT", "NVDA", "SPY", "BTC"].map((symbol, i) => ({ symbol, position: i })) },
    },
  });
  const portfolio = await prisma.portfolio.create({
    data: { userId, name: "Demo Portfolio", cash: 25_000 },
  });
  const positions = [
    { symbol: "AAPL", assetClass: "STOCK", quantity: 40, avgCost: 189.2 },
    { symbol: "MSFT", assetClass: "STOCK", quantity: 15, avgCost: 378.4 },
    { symbol: "NVDA", assetClass: "STOCK", quantity: 30, avgCost: 96.8 },
    { symbol: "SPY", assetClass: "ETF", quantity: 12, avgCost: 512.3 },
    { symbol: "BTC", assetClass: "CRYPTO", quantity: 0.25, avgCost: 64_200 },
  ];
  for (const p of positions) {
    await prisma.position.create({ data: { portfolioId: portfolio.id, ...p } });
    await prisma.transaction.create({
      data: { portfolioId: portfolio.id, symbol: p.symbol, side: "BUY", quantity: p.quantity, price: p.avgCost },
    });
  }
}
