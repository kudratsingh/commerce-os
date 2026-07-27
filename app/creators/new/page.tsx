import Link from "next/link";

import { NewCreatorForm } from "@/components/creators/NewCreatorForm";

export const dynamic = "force-dynamic";

/**
 * /creators/new — minimal creation form. Everything else (touchpoints,
 * samples, campaigns) gets attached from the profile page after the row
 * exists.
 */
export default function NewCreatorPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-5 space-y-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
          <Link href="/creators" className="hover:underline">
            Creators
          </Link>
          <span className="mx-1">/</span>
          <span>New</span>
        </div>
        <h1 className="text-lg font-semibold">Add a creator</h1>
        <p className="text-[11px] text-text-muted">
          Row starts in <span className="mono">status = &apos;prospect&apos;</span>.
          Log an outreach touchpoint from the profile to move them through the
          funnel.
        </p>
      </div>
      <NewCreatorForm />
    </div>
  );
}
