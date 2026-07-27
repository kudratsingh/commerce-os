import { NextResponse } from "next/server";
import { z } from "zod";

import { POST as erpWebhookRoute } from "@/app/api/webhooks/erp/route";
import { POST as tiktokWebhookRoute } from "@/app/api/webhooks/tiktok/route";
import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { createSupabaseServer } from "@/lib/db/server";
import { serverEnv } from "@/lib/domain/env";
import { firePayload, fireRaw } from "@/lib/simulator/fire";
import {
  burst,
  duplicate,
  esiCount,
  esiDamage,
  esiTransfer,
  malformedMissingRequiredFields,
  orderCreated,
  orderReturned,
  orderShipped,
  overshootOrder,
  unknownSkuOrder,
} from "@/lib/simulator/payloads";

/**
 * POST /api/simulator/fire — the in-app chaos panel's server side.
 *
 * The buttons on /simulator POST here; this route signs the payload with the
 * shared secret server-side (never in the browser bundle — invariant #8)
 * and fires it at THIS worker's own `/api/webhooks/tiktok`. That means the
 * demo exercises the exact ingestion path a real marketplace would.
 *
 * All eight scenarios from BUILD_PLAN's chaos menu are dispatchable here.
 */

const bodySchema = z
  .object({
    scenario: z.enum([
      "one",
      "burst",
      "duplicate",
      "malformed",
      "bad-signature",
      "unknown-sku",
      "overshoot",
      "invalid-json",
      "ship-latest",
      "return-latest",
      "esi-count",
      "esi-transfer",
      "esi-damage",
    ]),
    count: z.number().int().positive().max(200).optional(),
  })
  .strict();

const CHANNEL_ID = "tiktok_shop";

/**
 * Look up the most recent order in a target status so `ship-latest` and
 * `return-latest` scenarios have a real target. Returns null if there is
 * nothing to act on — the caller surfaces a friendly message.
 */
async function pickLatestOrderInStatus(status: string): Promise<string | null> {
  const db = createSupabaseServer();
  const { data } = await db
    .from("orders")
    .select("external_order_id")
    .eq("channel_id", CHANNEL_ID)
    .eq("status", status)
    .order("placed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.external_order_id ?? null;
}

interface FireOutcome {
  scenario: string;
  fired: number;
  results: Array<{ status: number; body: unknown }>;
  elapsed_ms: number;
}

export async function POST(req: Request): Promise<Response> {
  const auth = requireOpsSecret(req);
  if (!auth.ok) return auth.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const env = serverEnv();
  // Direct call into the webhook route handler — same code path an external
  // POST would take, but no network. Avoids the Cloudflare Access loop
  // where an internal fetch back to the worker's own URL gets intercepted
  // and redirected to the Access login page.
  const opts = {
    secret: env.WEBHOOK_SHARED_SECRET,
    webhookHandler: tiktokWebhookRoute,
  } as const;
  const start = Date.now();
  const scenario = parsed.data.scenario;

  const results: Array<{ status: number; body: unknown }> = [];

  switch (scenario) {
    case "one": {
      results.push(await firePayload(orderCreated(), opts));
      break;
    }
    case "burst": {
      const n = parsed.data.count ?? 50;
      const payloads = burst(n);
      const out = await Promise.all(
        payloads.map((p) => firePayload(p, opts)),
      );
      results.push(...out);
      break;
    }
    case "duplicate": {
      const p = orderCreated();
      results.push(await firePayload(p, opts));
      results.push(await firePayload(duplicate(p), opts));
      break;
    }
    case "malformed":
      results.push(
        await firePayload(malformedMissingRequiredFields(), opts),
      );
      break;
    case "bad-signature":
      results.push(
        await firePayload(orderCreated(), { ...opts, useBadSecret: true }),
      );
      break;
    case "unknown-sku":
      results.push(await firePayload(unknownSkuOrder(), opts));
      break;
    case "overshoot":
      results.push(await firePayload(overshootOrder(), opts));
      break;
    case "invalid-json":
      results.push(await fireRaw("{ this is not json ]", opts));
      break;

    case "ship-latest": {
      const target = await pickLatestOrderInStatus("allocated");
      if (!target) {
        results.push({
          status: 404,
          body: { error: "no allocated orders to ship — send an order first" },
        });
        break;
      }
      results.push(await firePayload(orderShipped(target), opts));
      break;
    }

    case "return-latest": {
      const target = await pickLatestOrderInStatus("shipped");
      if (!target) {
        results.push({
          status: 404,
          body: { error: "no shipped orders to return — ship one first" },
        });
        break;
      }
      results.push(await firePayload(orderReturned(target), opts));
      break;
    }

    // ESI/ERP scenarios (ADR-011). Fire at /api/webhooks/erp; same HMAC,
    // same DLQ, different domain function on the other side.
    case "esi-count": {
      const esiOpts = {
        ...opts,
        webhookHandler: erpWebhookRoute,
        webhookPath: "/api/webhooks/erp",
      };
      results.push(
        await firePayload(esiCount({ countedQty: 115 }), esiOpts),
      );
      break;
    }
    case "esi-transfer": {
      const esiOpts = {
        ...opts,
        webhookHandler: erpWebhookRoute,
        webhookPath: "/api/webhooks/erp",
      };
      results.push(
        await firePayload(
          esiTransfer({ fromLocation: "Van Nuys DC", toLocation: "Van Nuys DC", qty: 5 }),
          esiOpts,
        ),
      );
      break;
    }
    case "esi-damage": {
      const esiOpts = {
        ...opts,
        webhookHandler: erpWebhookRoute,
        webhookPath: "/api/webhooks/erp",
      };
      results.push(await firePayload(esiDamage({ qty: 2 }), esiOpts));
      break;
    }
  }

  const outcome: FireOutcome = {
    scenario,
    fired: results.length,
    results,
    elapsed_ms: Date.now() - start,
  };
  return NextResponse.json(outcome, { status: 200 });
}
