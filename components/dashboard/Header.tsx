import Link from "next/link";

import { NavLink } from "./NavLink";
import { RealtimeStatus } from "./RealtimeStatus";

/**
 * Top nav for the ops dashboard. Small on purpose — the data is the point.
 */
export function Header() {
  return (
    <header className="border-b border-border bg-panel/60 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-6 w-6 rounded bg-accent/20 ring-1 ring-accent/40 flex items-center justify-center">
              <span className="mono text-[10px] font-semibold text-accent">C</span>
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">
                Commerce OS
              </div>
              <div className="text-[11px] text-text-muted -mt-0.5">
                Van Nuys DC · single-node ops
              </div>
            </div>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/purchasing">Purchasing</NavLink>
            <NavLink href="/replenishment">Reorder</NavLink>
            <NavLink href="/margin">Margin</NavLink>
            <NavLink href="/inventory/aged">Aged</NavLink>
            <NavLink href="/simulator">Simulator</NavLink>
          </nav>
        </div>
        <RealtimeStatus />
      </div>
    </header>
  );
}
