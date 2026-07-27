import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { POST as createCreatorRoute } from "@/app/api/creators/route";
import { POST as touchpointRoute } from "@/app/api/creators/[id]/touchpoints/route";
import type { Database } from "@/lib/db/database.types";
import { resetEphemera } from "@/tests/helpers/reset-ephemera";

/**
 * M4-B: verify the HTTP contracts for the CRM UI. The domain-layer tests
 * (creators.test.ts) cover the RPC behavior; these just prove that the
 * route handlers wire zod validation, ops-secret auth, and error mapping
 * the way the client components expect.
 */

const runIntegration =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.OPS_SHARED_SECRET;

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration("creators API routes", () => {
  const opsSecret = process.env.OPS_SHARED_SECRET!;
  let db: SupabaseClient<Database>;

  beforeAll(async () => {
    await resetEphemera();
    db = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
  });

  function opsHeaders(): Record<string, string> {
    return { "content-type": "application/json", "x-ops-secret": opsSecret };
  }

  async function callCreate(body: unknown): Promise<{
    status: number;
    body: { creator?: { id: string; handle: string; status: string }; error?: string };
  }> {
    const req = new Request("http://test/api/creators", {
      method: "POST",
      headers: opsHeaders(),
      body: JSON.stringify(body),
    });
    const res = await createCreatorRoute(req);
    return { status: res.status, body: await res.json() };
  }

  async function callTouchpoint(
    id: string,
    body: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const req = new Request(`http://test/api/creators/${id}/touchpoints`, {
      method: "POST",
      headers: opsHeaders(),
      body: JSON.stringify(body),
    });
    const res = await touchpointRoute(req, {
      params: Promise.resolve({ id }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("POST /api/creators creates a creator in status=prospect and normalizes handle", async () => {
    const unique = `apitest-${Date.now()}`;
    const { status, body } = await callCreate({
      handle: unique,
      platform: "tiktok",
      display_name: "Test Creator",
      primary_categories: ["beauty"],
      follower_count: 12345,
      engagement_rate: 0.042,
    });
    expect(status).toBe(201);
    expect(body.creator?.handle).toBe(`@${unique}`);
    expect(body.creator?.status).toBe("prospect");
  });

  it("POST /api/creators rejects missing ops secret", async () => {
    const req = new Request("http://test/api/creators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "nope", platform: "tiktok" }),
    });
    const res = await createCreatorRoute(req);
    expect(res.status).toBe(401);
  });

  it("POST /api/creators rejects invalid platform via zod", async () => {
    const { status, body } = await callCreate({
      handle: "@bad-platform",
      platform: "shopify",
    });
    expect(status).toBe(400);
    expect(body.error ?? "").toMatch(/tiktok|instagram|invalid/i);
  });

  it("POST /api/creators surfaces 409 on duplicate handle", async () => {
    const dup = `dup-${Date.now()}`;
    const first = await callCreate({ handle: dup, platform: "instagram" });
    expect(first.status).toBe(201);
    const second = await callCreate({ handle: dup, platform: "instagram" });
    expect(second.status).toBe(409);
    expect(second.body.error ?? "").toMatch(/already exists/i);
  });

  it("POST /api/creators/[id]/touchpoints transitions status and returns the outcome", async () => {
    const { body: created } = await callCreate({
      handle: `flow-${Date.now()}`,
      platform: "tiktok",
    });
    const cid = created.creator!.id;

    const outreach = await callTouchpoint(cid, {
      kind: "outreach",
      direction: "outbound",
      medium: "email",
      notes: "cold intro",
    });
    expect(outreach.status).toBe(200);
    expect(outreach.body.previous_status).toBe("prospect");
    expect(outreach.body.new_status).toBe("contacted");

    const reply = await callTouchpoint(cid, {
      kind: "reply",
      direction: "inbound",
      notes: "they replied",
    });
    expect(reply.body.new_status).toBe("replied");

    // Verify persisted state
    const { data: creator } = await db
      .from("creators")
      .select("status, first_contacted_at")
      .eq("id", cid)
      .single();
    expect(creator?.status).toBe("replied");
    expect(creator?.first_contacted_at).toBeTruthy();
  });

  it("POST touchpoints refuses malformed body via zod", async () => {
    const { body: created } = await callCreate({
      handle: `bad-body-${Date.now()}`,
      platform: "tiktok",
    });
    const cid = created.creator!.id;

    const { status, body } = await callTouchpoint(cid, {
      kind: "not-a-real-kind",
      direction: "outbound",
    });
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("POST touchpoints refuses invalid uuid path", async () => {
    const { status, body } = await callTouchpoint("not-a-uuid", {
      kind: "outreach",
      direction: "outbound",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid creator id/i);
  });
});
