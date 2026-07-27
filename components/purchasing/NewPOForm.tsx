"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createPurchaseOrderAction } from "@/lib/actions/ops-actions";
import type {
  BrandOption,
  ProductOption,
  SupplierOption,
} from "@/lib/queries/replenishment";

interface LineDraft {
  product_id: string;
  qty_ordered: number;
  unit_cost_cents: number;
}

const EMPTY_LINE: LineDraft = { product_id: "", qty_ordered: 1, unit_cost_cents: 0 };

export function NewPOForm({
  brands,
  suppliers,
  products,
}: {
  brands: BrandOption[];
  suppliers: SupplierOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [expectedAt, setExpectedAt] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const productsForBrand = useMemo(
    () => (brandId ? products.filter((p) => p.brand_id === brandId) : products),
    [brandId, products],
  );

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function submit() {
    setErr(null);
    const valid = lines
      .filter((l) => l.product_id && l.qty_ordered > 0)
      .map((l) => ({
        product_id: l.product_id,
        qty_ordered: l.qty_ordered,
        unit_cost_cents: Math.round(l.unit_cost_cents),
      }));
    if (!brandId || !supplierId || valid.length === 0) {
      setErr("Pick a brand, supplier, and at least one line with a product + qty.");
      return;
    }

    startTransition(async () => {
      const { status, body } = await createPurchaseOrderAction({
        brand_id: brandId,
        supplier_id: supplierId,
        expected_at: expectedAt ? new Date(expectedAt).toISOString() : null,
        lines: valid,
      });
      if (status !== 200 || body.error || !body.po_id) {
        setErr(body.error ?? `HTTP ${status}`);
        return;
      }
      router.push(`/purchasing/${body.po_id}`);
    });
  }

  return (
    <div className="rounded-md border border-border bg-panel p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Brand">
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="w-full rounded border border-border-strong bg-bg px-2 py-1.5 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Supplier">
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full rounded border border-border-strong bg-bg px-2 py-1.5 text-sm"
          >
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Expected date">
          <input
            type="date"
            value={expectedAt}
            onChange={(e) => setExpectedAt(e.target.value)}
            className="mono w-full rounded border border-border-strong bg-bg px-2 py-1.5 text-sm"
          />
        </Field>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Lines</div>
          <button
            onClick={addLine}
            className="mono text-[11px] uppercase tracking-wider px-2 py-1 rounded border border-border-strong text-text-muted hover:bg-panel-hover"
          >
            + Add line
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_100px_120px_40px] gap-2 items-end">
              <Field label={idx === 0 ? "Product" : undefined}>
                <select
                  value={l.product_id}
                  onChange={(e) => updateLine(idx, { product_id: e.target.value })}
                  className="w-full rounded border border-border-strong bg-bg px-2 py-1.5 text-sm"
                >
                  <option value="">— pick a product —</option>
                  {productsForBrand.map((p) => (
                    <option key={p.id} value={p.id}>{p.sku} · {p.title}</option>
                  ))}
                </select>
              </Field>
              <Field label={idx === 0 ? "Qty" : undefined}>
                <input
                  type="number"
                  min={1}
                  value={l.qty_ordered}
                  onChange={(e) => updateLine(idx, { qty_ordered: Number(e.target.value) })}
                  className="mono w-full rounded border border-border-strong bg-bg px-2 py-1.5 text-sm"
                />
              </Field>
              <Field label={idx === 0 ? "Unit cost (cents)" : undefined}>
                <input
                  type="number"
                  min={0}
                  value={l.unit_cost_cents}
                  onChange={(e) => updateLine(idx, { unit_cost_cents: Number(e.target.value) })}
                  className="mono w-full rounded border border-border-strong bg-bg px-2 py-1.5 text-sm"
                />
              </Field>
              <button
                onClick={() => removeLine(idx)}
                disabled={lines.length === 1}
                className="mono text-[11px] uppercase tracking-wider px-2 py-1.5 rounded border border-border text-danger hover:bg-danger/10 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {err && <div className="text-[11px] text-danger">{err}</div>}

      <div className="flex justify-end">
        <button
          disabled={pending}
          onClick={submit}
          className="mono text-[11px] uppercase tracking-wider px-4 py-2 rounded border border-accent/40 text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create PO"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      {label && (
        <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint mb-1">
          {label}
        </div>
      )}
      {children}
    </label>
  );
}
