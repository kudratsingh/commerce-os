"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={`mono text-[11px] uppercase tracking-wider px-2 py-1 rounded transition-colors ${
        active
          ? "text-accent bg-accent/10"
          : "text-text-muted hover:text-text hover:bg-panel-hover"
      }`}
    >
      {children}
    </Link>
  );
}
