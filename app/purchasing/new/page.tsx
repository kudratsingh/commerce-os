import { NewPOForm } from "@/components/purchasing/NewPOForm";
import { createSupabaseServer } from "@/lib/db/server";
import { getBrands, getProducts, getSuppliers } from "@/lib/queries/replenishment";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewPurchaseOrderPage() {
  const db = createSupabaseServer();
  const [brands, suppliers, products] = await Promise.all([
    getBrands(db),
    getSuppliers(db),
    getProducts(db),
  ]);

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-5 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">New purchase order</h1>
        <p className="text-[11px] text-text-muted">
          One PO, multiple lines, atomic commit via <span className="mono">create_purchase_order</span>.
        </p>
      </div>
      <NewPOForm brands={brands} suppliers={suppliers} products={products} />
    </div>
  );
}
