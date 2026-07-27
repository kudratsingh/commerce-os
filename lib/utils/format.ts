/**
 * Formatting helpers. Money and quantities stay integer everywhere except
 * the render layer (CLAUDE.md invariant #5). All formatting happens here so
 * unit tests can pin the strings the demo shows on stage.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCents(cents: number | bigint | null | undefined): string {
  if (cents === null || cents === undefined) return "$0.00";
  const n = typeof cents === "bigint" ? Number(cents) : cents;
  return usdFormatter.format(n / 100);
}

export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined) return "0";
  return compactFormatter.format(n);
}

/**
 * "just now" / "3s ago" / "12m ago" / "4h ago" / "2d ago". Kept English-only
 * for the demo; a Realtime feed with 3-4 chars per row keeps rows dense.
 */
export function relativeTime(from: string | Date, now = new Date()): string {
  const then = from instanceof Date ? from : new Date(from);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
