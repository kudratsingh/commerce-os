import { NextResponse } from "next/server";

import { createSupabaseServer } from "@/lib/db/server";
import { runReconciliation } from "@/lib/domain/reconciliation";

/**
 * POST /api/reconciliation/run — kicks off a reconciliation pass.
 * Returns the run id so the UI can point at the findings this run created.
 */
export async function POST(): Promise<Response> {
  const db = createSupabaseServer();
  try {
    const runId = await runReconciliation(db);
    return NextResponse.json({ run_id: runId }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "run failed" },
      { status: 500 },
    );
  }
}
