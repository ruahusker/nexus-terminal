// One-off account creation. Usage:
//   node --experimental-strip-types prisma/create-user.ts <username> <password> [name]

import { PrismaClient } from "@prisma/client";
import { hashPassword, provisionNewUser } from "../src/lib/authCore.ts";

const [username, password, name] = process.argv.slice(2);
if (!username || !password) {
  console.error("Usage: create-user.ts <username> <password> [name]");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters");
  process.exit(1);
}

const prisma = new PrismaClient();
const uname = username.toLowerCase();

const existing = await prisma.user.findUnique({ where: { username: uname } });
if (existing) {
  await prisma.user.update({ where: { username: uname }, data: { passwordHash: await hashPassword(password) } });
  console.log(`Updated password for existing user "${uname}"`);
} else {
  const user = await prisma.user.create({
    data: { username: uname, name: name ?? null, passwordHash: await hashPassword(password) },
  });
  await provisionNewUser(user.id);
  console.log(`Created user "${uname}" with starter watchlist + demo portfolio`);
}
await prisma.$disconnect();
