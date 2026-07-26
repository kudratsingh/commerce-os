import type { Db } from "@/lib/db/server";

/**
 * Resolve the default fulfillment location. Multi-warehouse routing is
 * deliberately out of scope for this sprint (see docs/domain-model.md);
 * every allocation lands against Van Nuys DC — the schema supports more
 * whenever we're ready.
 */

const DEFAULT_LOCATION_NAME = "Van Nuys DC";

let cachedId: string | null = null;

export async function getDefaultLocationId(db: Db): Promise<string> {
  if (cachedId) return cachedId;
  const { data, error } = await db
    .from("locations")
    .select("id")
    .eq("name", DEFAULT_LOCATION_NAME)
    .single();
  if (error || !data) {
    throw new Error(
      `default location "${DEFAULT_LOCATION_NAME}" not found — did the seed run?`,
    );
  }
  cachedId = data.id;
  return cachedId;
}
