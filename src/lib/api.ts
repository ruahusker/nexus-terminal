// Shared API route helpers: consistent JSON envelopes, zod validation, error mapping.

import { NextResponse } from "next/server";
import { z } from "zod";
import { ProviderError } from "./providers/errors";

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> | NextResponse {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) {
    return fail(400, "VALIDATION", result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data as z.infer<T>;
}

export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T> | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "BAD_JSON", "Request body must be valid JSON");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    return fail(400, "VALIDATION", result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return result.data as z.infer<T>;
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof Error && err.name === "AuthError") {
    return fail(401, "UNAUTHENTICATED", err.message);
  }
  if (err instanceof ProviderError) {
    const status = err.kind === "rate_limit" ? 429 : err.kind === "not_found" ? 404 : err.kind === "config" ? 503 : 502;
    return fail(status, `PROVIDER_${err.kind.toUpperCase()}`, err.message);
  }
  if (err instanceof Error && err.message.startsWith("Unknown symbol")) {
    return fail(404, "NOT_FOUND", err.message);
  }
  console.error("[api] unhandled error:", err);
  return fail(500, "INTERNAL", "Unexpected server error");
}

export const symbolSchema = z
  .string()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9.\-^=]+$/, "Invalid symbol")
  .transform((s) => s.toUpperCase());
