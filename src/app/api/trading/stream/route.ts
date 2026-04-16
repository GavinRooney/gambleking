// Server-Sent Events endpoint for the trading dashboard.
//
// Multiplexes every tradingBus event into a single SSE stream. The client
// subscribes with EventSource('/api/trading/stream') and dispatches on
// `event.name` inside the payload.
//
// Each SSE frame looks like:
//   event: market:update
//   data: {"marketId":"...", ... ,"at":123}
//
// A 25-second heartbeat keeps proxies from idle-killing the connection.

import { tradingBus } from "@/lib/trading/events";
import type { TradingEventName, TradingEventPayload } from "@/lib/trading/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (name: TradingEventName | "hello" | "heartbeat", data: unknown) => {
        try {
          const frame = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(frame));
        } catch {
          // Stream already closed — cleanup handler will run.
        }
      };

      // Initial "connected" frame so the client knows the stream is live even
      // before any trading events arrive.
      send("hello", { at: Date.now() });

      // Forward every tradingBus event.
      unsubscribe = tradingBus.onAny(
        <N extends TradingEventName>(name: N, payload: TradingEventPayload<N>) => {
          send(name, payload);
        }
      );

      heartbeat = setInterval(() => send("heartbeat", { at: Date.now() }), HEARTBEAT_MS);

      // Client disconnect — cleanup the listener and heartbeat.
      request.signal.addEventListener("abort", () => {
        if (unsubscribe) unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx/proxy buffering
    },
  });
}
