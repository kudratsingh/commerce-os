"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { registerTouchpointAction } from "@/lib/actions/ops-actions";

/**
 * Compact form for logging a touchpoint. Everything except kind/direction
 * is optional. On success the parent page revalidates so the timeline +
 * status pill update in the same click.
 *
 * The transition table lives in `register_touchpoint()` (ADR-012); the
 * UI only surfaces the possible kinds, not the rules.
 */

type Kind =
  | "outreach"
  | "reply"
  | "call"
  | "meeting"
  | "sample_request"
  | "contract"
  | "payment"
  | "other";
type Direction = "outbound" | "inbound";

const KINDS: Array<{ value: Kind; label: string; defaultDirection: Direction }> = [
  { value: "outreach", label: "Outreach", defaultDirection: "outbound" },
  { value: "reply", label: "Reply", defaultDirection: "inbound" },
  { value: "call", label: "Call", defaultDirection: "outbound" },
  { value: "meeting", label: "Meeting", defaultDirection: "outbound" },
  { value: "sample_request", label: "Sample requested", defaultDirection: "inbound" },
  { value: "contract", label: "Contract", defaultDirection: "outbound" },
  { value: "payment", label: "Payment", defaultDirection: "outbound" },
  { value: "other", label: "Note", defaultDirection: "outbound" },
];

export function TouchpointForm({ creatorId }: { creatorId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind>("outreach");
  const [direction, setDirection] = useState<Direction>("outbound");
  const [medium, setMedium] = useState("");
  const [notes, setNotes] = useState("");

  function onKindChange(value: string) {
    const found = KINDS.find((k) => k.value === value);
    if (!found) return;
    setKind(found.value);
    setDirection(found.defaultDirection);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      const { status, body } = await registerTouchpointAction(creatorId, {
        kind,
        direction,
        medium: medium.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (status !== 200 || body.error) {
        setErr(body.error ?? `HTTP ${status}`);
        return;
      }
      setNotes("");
      setMedium("");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-border bg-panel p-4 space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
            Kind
          </span>
          <select
            value={kind}
            onChange={(e) => onKindChange(e.target.value)}
            className="mono mt-1 w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
            Direction
          </span>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            className="mono mt-1 w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          >
            <option value="outbound">outbound (to creator)</option>
            <option value="inbound">inbound (from creator)</option>
          </select>
        </label>
        <label className="block md:col-span-2">
          <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
            Medium
          </span>
          <input
            value={medium}
            onChange={(e) => setMedium(e.target.value)}
            placeholder="email · slack · phone · zoom"
            className="mt-1 w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
          Notes
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="what happened, what's next"
          className="mt-1 w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
        />
      </label>

      {err && (
        <div className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
          {err}
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          type="submit"
          disabled={pending}
          className={`mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
            pending
              ? "border-warn/40 text-warn"
              : "border-accent/40 text-accent hover:bg-accent/10"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {pending ? "Logging…" : "Log touchpoint"}
        </button>
      </div>
    </form>
  );
}
