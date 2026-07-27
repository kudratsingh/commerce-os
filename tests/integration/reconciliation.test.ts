import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as resolveRoute } from "@/app/api/reconciliation/resolve/route";
import { POST as runRoute } from "@/app/api/reconciliation/run/route";
import { POST as skewRoute } from "@/app/api/simulator/skew/route";
import type { Database } from "@/lib/db/database.types";
import { getOpenFindings, getRecentReconRuns } from "@/lib/queries/findings";

/**
 * End-to-end reconciliation: skew → run → finding present → resolve → gone.
 * Also covers the run + resolve routes and the skew chaos endpoint.
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WEBHOOK_SHARED_SECRET &&
  !!process.env.OPS_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("reconciliation + chaos skew", () => {
  let db: SupabaseClient<Database>;
  const opsSecret = process.env.OPS_SHARED_SECRET!;

  beforeAll(async () => {
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  });

  function opsHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { "content-type": "application/json", "x-ops-secret": opsSecret, ...extra };
  }

  async function callRun() {
    const req = new Request("http://test/api/reconciliation/run", {
      method: "POST",
      headers: opsHeaders(),
    });
    const res = await runRoute(req);
    return { status: res.status, body: (await res.json()) as { run_id?: string; error?: string } };
  }

  async function callSkew(channel_id: string, sku: string, delta: number) {
    const req = new Request("http://test/api/simulator/skew", {
      method: "POST",
      headers: opsHeaders(),
      body: JSON.stringify({ channel_id, sku, delta }),
    });
    const res = await skewRoute(req);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function callResolve(finding_id: number) {
    const req = new Request("http://test/api/reconciliation/resolve", {
      method: "POST",
      headers: opsHeaders(),
      body: JSON.stringify({ finding_id }),
    });
    const res = await resolveRoute(req);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it("skew → run → finding appears with the expected delta", async () => {
    const skewRes = await callSkew("tiktok_shop", "TTS-VC-PTY-50", 13);
    expect(skewRes.status).toBe(200);
    expect(skewRes.body.outcome).toBe("skewed");

    const runRes = await callRun();
    expect(runRes.status).toBe(200);
    expect(runRes.body.run_id).toBeTypeOf("string");

    const findings = await getOpenFindings(db, 200);
    const mine = findings.find((f) => f.sku === "VC-PTY-50" && f.channel_id === "tiktok_shop" && f.delta === 13);
    expect(mine).toBeDefined();
    expect(mine!.kind).toBe("channel_drift");
  });

  it("resolve makes the finding disappear from open_findings", async () => {
    // ensure at least one open finding exists (from the previous test or a fresh skew)
    await callSkew("tiktok_shop", "TTS-VC-MIC-10", 5);
    await callRun();

    const before = await getOpenFindings(db, 200);
    expect(before.length).toBeGreaterThan(0);
    const target = before[0];

    const resolveRes = await callResolve(target.id);
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.outcome).toBe("resolved");

    const after = await getOpenFindings(db, 200);
    expect(after.find((f) => f.id === target.id)).toBeUndefined();
  });

  it("resolve is idempotent — second call returns already_resolved", async () => {
    await callSkew("tiktok_shop", "TTS-VC-BT-100", 3);
    await callRun();
    const findings = await getOpenFindings(db, 200);
    const target = findings.find((f) => f.sku === "VC-BT-100" && f.delta === 3);
    expect(target).toBeDefined();

    const first = await callResolve(target!.id);
    expect(first.body.outcome).toBe("resolved");
    const second = await callResolve(target!.id);
    expect(second.body.outcome).toBe("already_resolved");
  });

  it("skew route rejects malformed body", async () => {
    const req = new Request("http://test/api/simulator/skew", {
      method: "POST",
      headers: opsHeaders(),
      body: JSON.stringify({ channel_id: "tiktok_shop" }),
    });
    const res = await skewRoute(req);
    expect(res.status).toBe(400);
  });

  it("skew route refuses without ops secret (401)", async () => {
    const req = new Request("http://test/api/simulator/skew", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel_id: "tiktok_shop", sku: "TTS-VC-BT-100", delta: 1 }),
    });
    const res = await skewRoute(req);
    expect(res.status).toBe(401);
  });

  it("run route refuses without ops secret (401)", async () => {
    const req = new Request("http://test/api/reconciliation/run", { method: "POST" });
    const res = await runRoute(req);
    expect(res.status).toBe(401);
  });

  it("resolve route refuses without ops secret (401)", async () => {
    const req = new Request("http://test/api/reconciliation/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ finding_id: 1 }),
    });
    const res = await resolveRoute(req);
    expect(res.status).toBe(401);
  });

  it("recent_recon_runs surfaces the runs we just fired", async () => {
    const runs = await getRecentReconRuns(db, 10);
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(typeof r.findings_count === "number" || r.findings_count === null).toBe(true);
    }
  });
});
