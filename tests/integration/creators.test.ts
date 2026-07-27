import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/db/database.types";
import {
  registerTouchpoint,
  shipSample,
} from "@/lib/domain/creators";
import {
  getCreatorTouchpoints,
  getSampleRequests,
} from "@/lib/queries/creators";
import { resetEphemera } from "@/tests/helpers/reset-ephemera";

/**
 * Module 4 / PR M4-A tests (migration 015, ADR-012).
 *
 * Proves:
 *   - Creator status is derived from the touchpoint stream, not written
 *     directly. Full happy-path lifecycle: prospect → contacted →
 *     replied → accepted → active.
 *   - Touchpoints are append-only (the CRM's ledger).
 *   - ship_sample() atomically: appends stock_movements row, decrements
 *     stock_levels, logs a sample_ship touchpoint, links back via
 *     sample_requests.stock_movement_id.
 *   - Insufficient stock raises rather than shipping a promise we can't
 *     keep (same firewall as marketplace allocations).
 *   - Second ship_sample on the same request is a no-op (idempotent).
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("creator CRM + sample flow", () => {
  let db: SupabaseClient<Database>;
  let vcBt100Id: string;
  let vanNuysId: string;

  beforeAll(async () => {
    await resetEphemera();
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const [{ data: p }, { data: l }] = await Promise.all([
      db.from("products").select("id").eq("sku", "VC-BT-100").single(),
      db.from("locations").select("id").eq("name", "Van Nuys DC").single(),
    ]);
    vcBt100Id = p!.id;
    vanNuysId = l!.id;
  });

  async function createCreator(handle: string): Promise<string> {
    const { data, error } = await db
      .from("creators")
      .insert({ handle, platform: "tiktok" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createCreator: ${error?.message}`);
    return data.id;
  }

  async function statusOf(creatorId: string): Promise<string> {
    const { data } = await db
      .from("creators")
      .select("status, first_contacted_at, became_active_at")
      .eq("id", creatorId)
      .single();
    return data?.status ?? "";
  }

  it("creator status is derived from the touchpoint stream", async () => {
    const cid = await createCreator(`@lifecycle-${Date.now()}`);
    expect(await statusOf(cid)).toBe("prospect");

    const out1 = await registerTouchpoint(db, {
      creatorId: cid,
      kind: "outreach",
      direction: "outbound",
      medium: "email",
      notes: "cold intro",
      actor: "kudrat",
    });
    expect(out1.new_status).toBe("contacted");
    expect(await statusOf(cid)).toBe("contacted");

    const out2 = await registerTouchpoint(db, {
      creatorId: cid,
      kind: "reply",
      direction: "inbound",
      medium: "email",
    });
    expect(out2.new_status).toBe("replied");

    const out3 = await registerTouchpoint(db, {
      creatorId: cid,
      kind: "contract",
      direction: "outbound",
      medium: "docsign",
    });
    expect(out3.new_status).toBe("accepted");

    const out4 = await registerTouchpoint(db, {
      creatorId: cid,
      kind: "payment",
      direction: "outbound",
      medium: "stripe",
      notes: "first payout",
    });
    expect(out4.new_status).toBe("active");

    // Timestamps set on transition
    const { data: c } = await db
      .from("creators")
      .select("first_contacted_at, became_active_at")
      .eq("id", cid)
      .single();
    expect(c?.first_contacted_at).toBeTruthy();
    expect(c?.became_active_at).toBeTruthy();
  });

  it("touchpoints are append-only", async () => {
    const cid = await createCreator(`@append-only-${Date.now()}`);
    await registerTouchpoint(db, {
      creatorId: cid,
      kind: "outreach",
      direction: "outbound",
    });
    const { error: updateErr } = await db
      .from("creator_touchpoints")
      .update({ notes: "rewriting history" })
      .eq("creator_id", cid);
    expect(updateErr?.message ?? "").toMatch(/append-only|forbid_touchpoint/i);

    const { error: deleteErr } = await db
      .from("creator_touchpoints")
      .delete()
      .eq("creator_id", cid);
    expect(deleteErr?.message ?? "").toMatch(/append-only|forbid_touchpoint/i);
  });

  it("ship_sample writes ledger + rollup + touchpoint in one tx", async () => {
    const cid = await createCreator(`@sample-flow-${Date.now()}`);

    const { data: onHandBefore } = await db
      .from("stock_levels")
      .select("on_hand")
      .eq("product_id", vcBt100Id)
      .eq("location_id", vanNuysId)
      .single();
    const before = onHandBefore!.on_hand;

    const { data: req } = await db
      .from("sample_requests")
      .insert({
        creator_id: cid,
        product_id: vcBt100Id,
        qty: 2,
        requested_by: "kudrat",
      })
      .select("id")
      .single();

    const outcome = await shipSample(db, {
      sampleRequestId: req!.id,
      locationId: vanNuysId,
      trackingNumber: "TRK-TEST",
      shippedBy: "kudrat",
    });
    expect(outcome.outcome).toBe("shipped");
    if (outcome.outcome !== "shipped") throw new Error("narrowing");
    expect(outcome.qty).toBe(2);

    // Rollup decremented
    const { data: onHandAfter } = await db
      .from("stock_levels")
      .select("on_hand")
      .eq("product_id", vcBt100Id)
      .eq("location_id", vanNuysId)
      .single();
    expect(onHandAfter!.on_hand).toBe(before - 2);

    // Ledger row shows the sample_sent movement
    const { data: movement } = await db
      .from("stock_movements")
      .select("qty_delta, reason, ref_type, note")
      .eq("id", outcome.stock_movement_id)
      .single();
    expect(movement?.qty_delta).toBe(-2);
    expect(movement?.reason).toBe("sample_sent");
    expect(movement?.ref_type).toBe("sample_request");
    expect(movement?.note ?? "").toMatch(/TRK-TEST/);

    // Sample request linked
    const requests = await getSampleRequests(db, { creatorId: cid });
    expect(requests.length).toBe(1);
    expect(requests[0].status).toBe("shipped");
    expect(requests[0].tracking_number).toBe("TRK-TEST");

    // Creator timeline picked up the sample_ship touchpoint
    const timeline = await getCreatorTouchpoints(db, cid);
    expect(timeline.some((t) => t.kind === "sample_ship")).toBe(true);

    // Idempotent second call
    const dup = await shipSample(db, {
      sampleRequestId: req!.id,
      locationId: vanNuysId,
    });
    expect(dup.outcome).toBe("already_shipped");
  });

  it("insufficient stock raises rather than shipping a promise", async () => {
    const cid = await createCreator(`@insufficient-${Date.now()}`);
    const { data: req } = await db
      .from("sample_requests")
      .insert({
        creator_id: cid,
        product_id: vcBt100Id,
        qty: 99_999,
        requested_by: "kudrat",
      })
      .select("id")
      .single();

    await expect(
      shipSample(db, {
        sampleRequestId: req!.id,
        locationId: vanNuysId,
      }),
    ).rejects.toThrow(/insufficient stock/i);
  });
});
