import { ChaosPanel } from "@/components/simulator/ChaosPanel";
import { NLQueryBar } from "@/components/simulator/NLQueryBar";
import { ReconciliationPanel } from "@/components/simulator/ReconciliationPanel";
import { StatCards } from "@/components/dashboard/StatCards";
import { createSupabaseServer } from "@/lib/db/server";
import { getOpenFindings, getRecentReconRuns } from "@/lib/queries/findings";
import { getDashboardSummary } from "@/lib/queries/summary";

/**
 * Simulator + reconciliation + NL query panel. Where the demo lives.
 * Server component composing the three panels; each has its own client
 * island for interactivity. The stat strip at the top is the same
 * dashboard_summary the / page uses — it ticks as scenarios fire.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SimulatorPage() {
  const db = createSupabaseServer();
  const [summary, findings, runs] = await Promise.all([
    getDashboardSummary(db),
    getOpenFindings(db, 50),
    getRecentReconRuns(db, 5),
  ]);

  return (
    <div className="mx-auto max-w-[1600px] px-6 py-5 space-y-5">
      <StatCards summary={summary} />
      <ChaosPanel />
      <ReconciliationPanel findings={findings} runs={runs} />
      <NLQueryBar />
      <footer className="pt-2 text-[11px] text-text-faint">
        Every button here calls a real route (
        <span className="mono">/api/simulator/*</span>,{" "}
        <span className="mono">/api/reconciliation/*</span>,{" "}
        <span className="mono">/api/nl-query</span>) — no client-side shortcuts.
        See <span className="mono">docs/architecture.md</span> §4 (sequences).
      </footer>
    </div>
  );
}
