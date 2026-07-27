"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowser } from "@/lib/db/browser";

/**
 * Live/idle indicator wired to a small Realtime channel. Presence of a
 * green pulsing dot in the header is our contract with the demo audience:
 * "the browser is talking to Postgres, not polling."
 */
export function RealtimeStatus() {
  const [state, setState] = useState<"connecting" | "live" | "closed">(
    "connecting",
  );

  useEffect(() => {
    const client = createSupabaseBrowser();
    const channel = client.channel("realtime-status");
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") setState("live");
      else if (status === "CHANNEL_ERROR" || status === "CLOSED") setState("closed");
    });
    return () => {
      void client.removeChannel(channel);
    };
  }, []);

  const dot =
    state === "live"
      ? "bg-accent pulse-dot"
      : state === "connecting"
        ? "bg-warn pulse-dot"
        : "bg-danger";
  const label =
    state === "live" ? "Realtime" : state === "connecting" ? "Connecting…" : "Offline";

  return (
    <div className="flex items-center gap-2 text-[11px] text-text-muted">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="mono uppercase tracking-wider">{label}</span>
    </div>
  );
}
