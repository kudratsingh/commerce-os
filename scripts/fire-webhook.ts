#!/usr/bin/env tsx
/**
 * Manual chaos CLI. Fires signed webhook payloads at a running Commerce OS
 * instance. On Day 4 the same scenarios become buttons on the ops dashboard;
 * this CLI is the fallback / regression harness.
 *
 * Usage:
 *   pnpm sim:fire one                              # single order.created
 *   pnpm sim:fire burst 50                         # 50 orders, ledger==rollup afterwards
 *   pnpm sim:fire duplicate                        # send the same event_id twice
 *   pnpm sim:fire malformed                        # missing required fields
 *   pnpm sim:fire bad-signature                    # sign with wrong secret
 *   pnpm sim:fire unknown-sku                      # DLQ scenario
 *   pnpm sim:fire overshoot                        # allocate > on_hand => backordered
 *   pnpm sim:fire ship TTS-SEED-0001               # order.shipped for a specific external id
 *   pnpm sim:fire return TTS-SEED-0001             # order.returned for a specific external id
 *
 * Env (loaded from .env.local via `tsx --env-file`):
 *   WEBHOOK_URL              default: http://127.0.0.1:3000/api/webhooks/tiktok
 *   WEBHOOK_SHARED_SECRET    required
 */

import {
  burst,
  duplicate,
  malformedMissingRequiredFields,
  orderCreated,
  orderReturned,
  orderShipped,
  overshootOrder,
  unknownSkuOrder,
} from "@/lib/simulator/payloads";
import { firePayload, fireRaw } from "@/lib/simulator/fire";

const url: string =
  process.env.WEBHOOK_URL ??
  "http://127.0.0.1:3000/api/webhooks/tiktok";
const secret: string = requireEnv("WEBHOOK_SHARED_SECRET");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} must be set (check .env.local).`);
    process.exit(1);
  }
  return value;
}

const scenario = process.argv[2] ?? "one";
const nArg = Number(process.argv[3]);

async function main(): Promise<void> {
  switch (scenario) {
    case "one": {
      const p = orderCreated();
      const r = await firePayload(p, { url, secret });
      report(scenario, r);
      break;
    }
    case "burst": {
      const n = Number.isFinite(nArg) && nArg > 0 ? nArg : 50;
      const payloads = burst(n);
      const start = Date.now();
      const results = await Promise.all(
        payloads.map((p) => firePayload(p, { url, secret })),
      );
      const okCount = results.filter((r) => r.status === 200).length;
      const took = Date.now() - start;
      console.log(
        `burst ${n}: ${okCount}/${n} 200 in ${took}ms (${(took / n).toFixed(1)}ms/req)`,
      );
      break;
    }
    case "duplicate": {
      const p = orderCreated();
      const r1 = await firePayload(p, { url, secret });
      const r2 = await firePayload(duplicate(p), { url, secret });
      console.log("first  :", r1.status, r1.body);
      console.log("second :", r2.status, r2.body, "(expect 200 + deduped=true)");
      break;
    }
    case "malformed": {
      const r = await firePayload(malformedMissingRequiredFields(), {
        url,
        secret,
      });
      report(scenario, r);
      break;
    }
    case "bad-signature": {
      const p = orderCreated();
      const r = await firePayload(p, { url, secret, useBadSecret: true });
      report(scenario, r);
      break;
    }
    case "unknown-sku": {
      const r = await firePayload(unknownSkuOrder(), { url, secret });
      report(scenario, r);
      break;
    }
    case "overshoot": {
      const r = await firePayload(overshootOrder(), { url, secret });
      report(scenario, r);
      break;
    }
    case "invalid-json": {
      const r = await fireRaw("{not json at all}", { url, secret });
      report(scenario, r);
      break;
    }
    case "ship": {
      const externalId = process.argv[3];
      if (!externalId) {
        console.error("ship requires an external_order_id: pnpm sim:fire ship TTS-SEED-0001");
        process.exit(1);
      }
      const r = await firePayload(orderShipped(externalId), { url, secret });
      report(scenario, r);
      break;
    }
    case "return": {
      const externalId = process.argv[3];
      if (!externalId) {
        console.error("return requires an external_order_id: pnpm sim:fire return TTS-SEED-0001");
        process.exit(1);
      }
      const r = await firePayload(orderReturned(externalId), { url, secret });
      report(scenario, r);
      break;
    }
    default: {
      console.error(`unknown scenario: ${scenario}`);
      console.error("try: one | burst [N] | duplicate | malformed | bad-signature | unknown-sku | overshoot | invalid-json | ship <ext_id> | return <ext_id>");
      process.exit(1);
    }
  }
}

function report(name: string, res: { status: number; body: unknown }): void {
  console.log(`${name.padEnd(14)} → ${res.status}`, JSON.stringify(res.body));
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
