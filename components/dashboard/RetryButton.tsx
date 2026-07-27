"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { retryDlqAction } from "@/lib/actions/ops-actions";

/**
 * DLQ row action. Server action proxies to /api/dlq/retry with the ops
 * shared secret attached server-side (invariant #8 — no secret in the
 * client bundle), then router.refresh() so the server-rendered DLQ panel
 * re-fetches. Panel re-render is the source of truth.
 */
export function RetryButton({
  eventId,
  disabled,
}: {
  eventId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: "idle" }
    | { kind: "ok"; outcome: string }
    | { kind: "err"; message: string }
  >({ kind: "idle" });

  async function onClick() {
    setResult({ kind: "idle" });
    startTransition(async () => {
      try {
        const { status, body } = await retryDlqAction(eventId);
        if (status !== 200 || body.error) {
          setResult({ kind: "err", message: body.error ?? `HTTP ${status}` });
          return;
        }
        setResult({ kind: "ok", outcome: body.outcome ?? "retried" });
        router.refresh();
      } catch (err) {
        setResult({
          kind: "err",
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    });
  }

  const label =
    pending
      ? "Retrying…"
      : result.kind === "ok"
        ? result.outcome
        : result.kind === "err"
          ? "Retry"
          : "Retry";

  return (
    <div className="flex items-center gap-2 justify-end">
      {result.kind === "err" && (
        <span className="text-[10px] text-danger max-w-[180px] truncate" title={result.message}>
          {result.message}
        </span>
      )}
      <button
        onClick={onClick}
        disabled={disabled || pending}
        className={`mono text-[11px] uppercase tracking-wider px-2 py-1 rounded border transition-colors
          ${disabled
            ? "border-border/60 text-text-faint cursor-not-allowed"
            : pending
              ? "border-warn/40 text-warn"
              : result.kind === "ok"
                ? "border-accent/40 text-accent"
                : "border-border-strong text-text hover:bg-panel-hover"
          }`}
      >
        {label}
      </button>
    </div>
  );
}
