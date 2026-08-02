// Server-Sent Events quote stream. Emits facade quotes every 2s — demo engine
// ticks in demo mode, real provider quotes in provider mode (each quote carries
// its own provenance). Provider failures surface as SSE error events.

import { facade } from "@/lib/providers";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHENTICATED", message: "Authentication required" } }), { status: 401 });
  }
  const symbols = (new URL(req.url).searchParams.get("symbols") ?? "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  if (symbols.length === 0) {
    return new Response(JSON.stringify({ ok: false, error: { code: "VALIDATION", message: "symbols required" } }), { status: 400 });
  }

  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const closer = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closer(); // enqueue on a closed controller — stop the stream
        }
      };
      const push = async () => {
        if (closed) return;
        try {
          const quotes = await facade.getQuotes(symbols);
          send(`data: ${JSON.stringify(quotes)}\n\n`);
        } catch {
          send(`event: error\ndata: {"message":"stream error"}\n\n`);
        }
      };
      const timer = setInterval(() => void push(), 2000);
      cleanup = closer;
      req.signal.addEventListener("abort", closer);
      setTimeout(closer, 30 * 60_000); // hard cap: 30 min per connection
      void push();
    },
    cancel() {
      cleanup(); // client disconnected — stop the interval before the next tick
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
