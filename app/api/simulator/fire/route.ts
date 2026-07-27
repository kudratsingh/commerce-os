import { NextResponse } from "next/server";
import { z } from "zod";

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
  const secret = env.WEBHOOK_SHARED_SECRET;

  // Fire at THIS worker's own webhook route. Derive base from the request so
  // it works identically in local dev and in the deployed Worker.
  const url = new URL("/api/webhooks/tiktok", req.url).toString();
  const start = Date.now();
  const scenario = parsed.data.scenario;

  const results: Array<{ status: number; body: unknown }> = [];

  switch (scenario) {
    case "one": {
      results.push(await firePayload(orderCreated(), { url, secret }));
      break;
    }
    case "burst": {
      const n = parsed.data.count ?? 50;
      const payloads = burst(n);
      const out = await Promise.all(
        payloads.map((p) => firePayload(p, { url, secret })),
      );
      results.push(...out);
      break;
    }
    case "duplicate": {
      const p = orderCreated();
      results.push(await firePayload(p, { url, secret }));
      results.push(await firePayload(duplicate(p), { url, secret }));
      break;
    }
    case "malformed":
      results.push(
        await firePayload(malformedMissingRequiredFields(), { url, secret }),
      );
      break;
    case "bad-signature":
      results.push(
        await firePayload(orderCreated(), { url, secret, useBadSecret: true }),
      );
      break;
    case "unknown-sku":
      results.push(await firePayload(unknownSkuOrder(), { url, secret }));
      break;
    case "overshoot":
      results.push(await firePayload(overshootOrder(), { url, secret }));
      break;
    case "invalid-json":
      results.push(await fireRaw("{ this is not json ]", { url, secret }));
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
