// Base path of the app (matches next.config.ts basePath).
// Manual fetch()/EventSource URLs must include it — framework navigation
// handles basePath automatically, raw HTTP calls do not.

export const BASE_PATH = "/terminal";

export function apiPath(path: string): string {
  if (!path.startsWith("/")) return path;
  return path.startsWith(`${BASE_PATH}/`) ? path : `${BASE_PATH}${path}`;
}
