// Client-side API helper — unwraps the { ok, data | error } envelope.

import { apiPath } from "./basePath";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Envelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiPath(path), {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError("Network unavailable — check your connection", "OFFLINE", 0);
  }
  let json: Envelope<T>;
  try {
    json = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(`Unexpected response (HTTP ${res.status})`, "BAD_RESPONSE", res.status);
  }
  if (!json.ok) throw new ApiError(json.error.message, json.error.code, res.status);
  return json.data;
}
