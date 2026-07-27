"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { closePurchaseOrderAction } from "@/lib/actions/ops-actions";

export function POCloseButton({
  poId,
  disabled,
}: {
  poId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    if (!confirm("Close this PO? This is administrative — reopening requires a new PO.")) return;
    setErr(null);
    startTransition(async () => {
      const { status, body } = await closePurchaseOrderAction(poId);
      if (status !== 200 || body.error) {
        setErr(body.error ?? `HTTP ${status}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[10px] text-danger">{err}</span>}
      <button
        disabled={disabled || pending}
        onClick={onClick}
        className="mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border border-border-strong text-text hover:bg-panel-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? "Closing…" : "Close PO"}
      </button>
    </div>
  );
}
