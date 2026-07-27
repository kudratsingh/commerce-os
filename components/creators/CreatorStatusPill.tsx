import type { CreatorStatus } from "@/lib/domain/creators";

/**
 * Status pill for a creator. Colors chosen so the funnel is legible at a
 * glance: neutral → info → warn → accent for the "getting closer" arc,
 * red for the failure states.
 */
const CLS: Record<CreatorStatus, string> = {
  prospect: "text-text-faint border-border",
  contacted: "text-info border-info/40",
  replied: "text-warn border-warn/40",
  accepted: "text-accent border-accent/40",
  active: "text-accent border-accent/60 bg-accent/5",
  declined: "text-text-muted border-border",
  blocked: "text-danger border-danger/40",
};

export function CreatorStatusPill({ status }: { status: CreatorStatus }) {
  return (
    <span
      className={`mono text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${CLS[status]}`}
    >
      {status}
    </span>
  );
}
