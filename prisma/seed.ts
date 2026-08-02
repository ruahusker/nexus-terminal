// Seed script: instrument universe only.
// User-owned content (watchlists, demo portfolio) is provisioned automatically
// when an account is created — see provisionNewUser() in src/lib/authCore.ts.
// Run: npm run db:seed (after `prisma db push`)

import { PrismaClient } from "@prisma/client";
import { UNIVERSE } from "../src/lib/demo/universe.ts";

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${UNIVERSE.length} instruments…`);
  for (const u of UNIVERSE) {
    await prisma.instrument.upsert({
      where: { symbol: u.symbol },
      create: {
        symbol: u.symbol,
        name: u.name,
        assetClass: u.assetClass,
        exchange: u.exchange,
        currency: u.currency,
        sector: u.sector ?? null,
        industry: u.industry ?? null,
        country: u.country ?? "US",
        basePrice: u.basePrice,
        marketCap: u.marketCap ?? null,
        sharesOut: u.sharesOut ?? null,
        dividendYld: u.dividendYield ?? null,
        peRatio: u.peRatio ?? null,
        beta: u.beta ?? null,
        description: u.description ?? null,
        optionable: u.optionable ?? false,
      },
      update: {},
    });
  }
  console.log("Seed complete. Create accounts with: node --experimental-strip-types prisma/create-user.ts <username> <password> [name]");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
