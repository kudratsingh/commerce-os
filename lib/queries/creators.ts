import type { Db } from "@/lib/db/server";

import type { CreatorStatus, TouchpointKind, TouchpointDirection } from "@/lib/domain/creators";

/**
 * Read models for the /creators pages. Uses supabase-js with generated
 * types (invariant #7 / code convention). Sorting + filtering are done in
 * SQL, mapping is done here so components render on plain shapes.
 */

export interface CreatorRow {
  id: string;
  handle: string;
  platform: string;
  display_name: string | null;
  contact_email: string | null;
  base_country: string | null;
  primary_categories: string[];
  follower_count: number | null;
  engagement_rate: number | null;
  status: CreatorStatus;
  first_contacted_at: string | null;
  became_active_at: string | null;
  created_at: string;
}

export async function getCreators(
  db: Db,
  filter: {
    status?: CreatorStatus | CreatorStatus[];
    platform?: string;
    search?: string;
    limit?: number;
  } = {},
): Promise<CreatorRow[]> {
  let q = db
    .from("creators")
    .select(
      "id, handle, platform, display_name, contact_email, base_country, primary_categories, follower_count, engagement_rate, status, first_contacted_at, became_active_at, created_at",
    );

  if (filter.status) {
    q = Array.isArray(filter.status)
      ? q.in("status", filter.status)
      : q.eq("status", filter.status);
  }
  if (filter.platform) q = q.eq("platform", filter.platform);
  if (filter.search) {
    // Prefix match on handle or display_name — keeps the query bounded and
    // uses the unique index on handle when the search is exact.
    q = q.or(`handle.ilike.${filter.search}%,display_name.ilike.%${filter.search}%`);
  }

  q = q.order("created_at", { ascending: false }).limit(filter.limit ?? 100);

  const { data, error } = await q;
  if (error) throw new Error(`creators read failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    handle: r.handle ?? "",
    platform: r.platform ?? "",
    display_name: r.display_name ?? null,
    contact_email: r.contact_email ?? null,
    base_country: r.base_country ?? null,
    primary_categories: (r.primary_categories ?? []) as string[],
    follower_count: r.follower_count,
    engagement_rate: r.engagement_rate !== null ? Number(r.engagement_rate) : null,
    status: (r.status ?? "prospect") as CreatorStatus,
    first_contacted_at: r.first_contacted_at,
    became_active_at: r.became_active_at,
    created_at: r.created_at ?? new Date(0).toISOString(),
  }));
}

export async function getCreatorById(db: Db, id: string): Promise<CreatorRow | null> {
  const { data, error } = await db
    .from("creators")
    .select(
      "id, handle, platform, display_name, contact_email, base_country, primary_categories, follower_count, engagement_rate, status, first_contacted_at, became_active_at, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`creator read failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id ?? "",
    handle: data.handle ?? "",
    platform: data.platform ?? "",
    display_name: data.display_name ?? null,
    contact_email: data.contact_email ?? null,
    base_country: data.base_country ?? null,
    primary_categories: (data.primary_categories ?? []) as string[],
    follower_count: data.follower_count,
    engagement_rate:
      data.engagement_rate !== null ? Number(data.engagement_rate) : null,
    status: (data.status ?? "prospect") as CreatorStatus,
    first_contacted_at: data.first_contacted_at,
    became_active_at: data.became_active_at,
    created_at: data.created_at ?? new Date(0).toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Touchpoint timeline
// ----------------------------------------------------------------------------

export interface TouchpointRow {
  id: number;
  creator_id: string;
  kind: TouchpointKind;
  direction: TouchpointDirection;
  medium: string | null;
  notes: string | null;
  actor: string | null;
  occurred_at: string;
}

export async function getCreatorTouchpoints(
  db: Db,
  creatorId: string,
  limit = 50,
): Promise<TouchpointRow[]> {
  const { data, error } = await db
    .from("creator_touchpoints")
    .select("id, creator_id, kind, direction, medium, notes, actor, occurred_at")
    .eq("creator_id", creatorId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`touchpoints read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? 0,
    creator_id: r.creator_id ?? "",
    kind: (r.kind ?? "other") as TouchpointKind,
    direction: (r.direction ?? "outbound") as TouchpointDirection,
    medium: r.medium ?? null,
    notes: r.notes ?? null,
    actor: r.actor ?? null,
    occurred_at: r.occurred_at ?? new Date(0).toISOString(),
  }));
}

// ----------------------------------------------------------------------------
// Sample requests
// ----------------------------------------------------------------------------

export interface SampleRequestRow {
  id: string;
  creator_id: string;
  creator_handle: string | null;
  campaign_id: string | null;
  product_id: string;
  product_sku: string | null;
  product_title: string | null;
  qty: number;
  status: string;
  requested_at: string;
  shipped_at: string | null;
  tracking_number: string | null;
}

export async function getSampleRequests(
  db: Db,
  filter: { status?: string; creatorId?: string; limit?: number } = {},
): Promise<SampleRequestRow[]> {
  let q = db
    .from("sample_requests_dashboard")
    .select(
      "id, creator_id, creator_handle, campaign_id, product_id, product_sku, product_title, qty, status, requested_at, shipped_at, tracking_number",
    );

  if (filter.status) q = q.eq("status", filter.status);
  if (filter.creatorId) q = q.eq("creator_id", filter.creatorId);

  q = q.order("requested_at", { ascending: false }).limit(filter.limit ?? 100);

  const { data, error } = await q;
  if (error) throw new Error(`sample_requests read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    creator_id: r.creator_id ?? "",
    creator_handle: r.creator_handle ?? null,
    campaign_id: r.campaign_id ?? null,
    product_id: r.product_id ?? "",
    product_sku: r.product_sku ?? null,
    product_title: r.product_title ?? null,
    qty: r.qty ?? 0,
    status: r.status ?? "requested",
    requested_at: r.requested_at ?? new Date(0).toISOString(),
    shipped_at: r.shipped_at,
    tracking_number: r.tracking_number,
  }));
}
