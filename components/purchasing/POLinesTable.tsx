"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { receiveShipmentAction } from "@/lib/actions/ops-actions";
import type { PurchaseOrderLineRow } from "@/lib/queries/purchasing";
import { formatCents } from "@/lib/utils/format";

export function POLinesTable({
  poId,
  lines,
  disabled,
}: {
  poId: string;
  lines: PurchaseOrderLineRow[];
  disabled?: boolean;
}) {
  const [openLine, setOpenLine] = useState<string | null>(null);

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <div className="text-sm font-semibold">Lines</div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-text-faint">
            <th className="px-4 py-2 font-normal">SKU · Product</th>
            <th className="px-2 py-2 font-normal text-right">Ordered</th>
            <th className="px-2 py-2 font-normal text-right">Received</th>
            <th className="px-2 py-2 font-normal text-right">Unit cost</th>
            <th className="px-4 py-2 font-normal text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-border/60">
              <td className="px-4 py-2">
                <div className="mono text-xs">{l.sku}</div>
                <div className="text-[11px] text-text-muted">{l.title}</div>
              </td>
              <td className="mono px-2 py-2 text-right">{l.qty_ordered}</td>
              <td
                className={`mono px-2 py-2 text-right ${
                  l.fully_received ? "text-accent" : "text-text-muted"
                }`}
              >
                {l.qty_received}
              </td>
              <td className="mono px-2 py-2 text-right">
                {formatCents(l.unit_cost_cents)}
              </td>
              <td className="px-4 py-2 text-right">
                <button
                  disabled={disabled || l.fully_received}
                  onClick={() => setOpenLine(l.id)}
                  className="mono text-[11px] uppercase tracking-wider px-2 py-1 rounded border border-border-strong text-text hover:bg-panel-hover disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Receive
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {openLine && (
        <ReceiveModal
          poId={poId}
          line={lines.find((l) => l.id === openLine)!}
          onClose={() => setOpenLine(null)}
        />
      )}
    </div>
  );
}

function ReceiveModal({
  poId,
  line,
  onClose,
}: {
  poId: string;
  line: PurchaseOrderLineRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const remaining = Math.max(0, line.qty_ordered - line.qty_received);
  const [qty, setQty] = useState(remaining);
  const [unitCost, setUnitCost] = useState(line.unit_cost_cents / 100);
  const [duties, setDuties] = useState(0);
  const [freight, setFreight] = useState(0);
  const [handling, setHandling] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setErr(null);
    startTransition(async () => {
      const { status, body } = await receiveShipmentAction(poId, {
        po_line_id: line.id,
        qty,
        unit_cost_cents: Math.round(unitCost * 100),
        duties_cents: Math.round(duties * 100),
        freight_cents: Math.round(freight * 100),
        handling_cents: Math.round(handling * 100),
      });
      if (status !== 200 || body.error) {
        setErr(body.error ?? `HTTP ${status}`);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 bg-bg/80 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="rounded-md border border-border bg-panel w-full max-w-md m-6 p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="text-sm font-semibold">Receive shipment</div>
          <div className="text-[11px] text-text-muted mono">{line.sku}</div>
        </div>
        <NumberField label="Qty" value={qty} onChange={setQty} max={remaining} />
        <NumberField label="Unit cost (USD)" value={unitCost} onChange={setUnitCost} step={0.01} />
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Duties $" value={duties} onChange={setDuties} step={0.01} />
          <NumberField label="Freight $" value={freight} onChange={setFreight} step={0.01} />
          <NumberField label="Handling $" value={handling} onChange={setHandling} step={0.01} />
        </div>
        <div className="text-[11px] text-text-muted">
          Landed unit: <span className="mono text-text">
            ${(unitCost + duties + freight + handling).toFixed(2)}
          </span>
        </div>
        {err && <div className="text-[11px] text-danger">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border border-border text-text-muted hover:bg-panel-hover"
          >
            Cancel
          </button>
          <button
            disabled={pending || qty <= 0}
            onClick={submit}
            className="mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {pending ? "Receiving…" : "Confirm receipt"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  max?: number;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint mb-1">
        {label}
      </div>
      <input
        type="number"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mono w-full rounded border border-border-strong bg-bg px-2 py-1.5 text-sm focus:border-accent/60 focus:outline-none"
      />
    </label>
  );
}
