import { NextResponse } from "next/server";
import { z } from "zod";

import { POST as tiktokWebhookRoute } from "@/app/api/webhooks/tiktok/route";
import { requireOpsSecret } from "@/lib/auth/ops-secret";
import { serverEnv } from "@/lib/domain/env";
import { firePayload, fireRaw } from "@/lib/simulator/fire";
import {
  burst,
  duplicate,
  malformedMissingRequiredFields,
  orderCreated,
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
    ]),
    count: z.number().int().positive().max(200).optional(),
  })
  .strict();

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
  }

  const outcome: FireOutcome = {
    scenario,
    fired: results.length,
    results,
    elapsed_ms: Date.now() - start,
  };
  return NextResponse.json(outcome, { status: 200 });
}
