import type { Db } from "@/lib/db/server";

/**
 * Read models for /campaigns. Campaigns roll up creator work under a
 * brand-owned purpose. Commissions are basis points (integer).
 */

export type CampaignStatus =
  | "draft"
  | "active"
  | "paused"
  | "ended"
  | "archived";

export interface CampaignRow {
  id: string;
  brand_id: string;
  brand_name: string | null;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  budget_cents: number | null;
  goal_gmv_cents: number | null;
  status: CampaignStatus;
  creators_enrolled: number;
  created_at: string;
}

export async function getCampaigns(
  db: Db,
  filter: { brandId?: string; status?: CampaignStatus; limit?: number } = {},
): Promise<CampaignRow[]> {
  let q = db
    .from("campaigns_dashboard")
    .select(
      "id, brand_id, brand_name, name, starts_at, ends_at, budget_cents, goal_gmv_cents, status, creators_enrolled, created_at",
    );

  if (filter.brandId) q = q.eq("brand_id", filter.brandId);
  if (filter.status) q = q.eq("status", filter.status);

  q = q.order("created_at", { ascending: false }).limit(filter.limit ?? 50);

  const { data, error } = await q;
  if (error) throw new Error(`campaigns read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id ?? "",
    brand_id: r.brand_id ?? "",
    brand_name: r.brand_name ?? null,
    name: r.name ?? "",
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    budget_cents: r.budget_cents !== null ? Number(r.budget_cents) : null,
    goal_gmv_cents:
      r.goal_gmv_cents !== null ? Number(r.goal_gmv_cents) : null,
    status: (r.status ?? "draft") as CampaignStatus,
    creators_enrolled: Number(r.creators_enrolled ?? 0),
    created_at: r.created_at ?? new Date(0).toISOString(),
  }));
}

export interface CampaignCreatorRow {
  campaign_id: string;
  creator_id: string;
  creator_handle: string | null;
  creator_status: string | null;
  commission_bps: number;
  agreed_deliverables: number;
  status: string;
  accepted_at: string | null;
}

export async function getCampaignCreators(
  db: Db,
  campaignId: string,
): Promise<CampaignCreatorRow[]> {
  const { data, error } = await db
    .from("campaign_creators_dashboard")
    .select(
      "campaign_id, creator_id, creator_handle, creator_status, commission_bps, agreed_deliverables, status, accepted_at",
    )
    .eq("campaign_id", campaignId)
    .order("accepted_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`campaign_creators read failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    campaign_id: r.campaign_id ?? "",
    creator_id: r.creator_id ?? "",
    creator_handle: r.creator_handle ?? null,
    creator_status: r.creator_status ?? null,
    commission_bps: r.commission_bps ?? 0,
    agreed_deliverables: r.agreed_deliverables ?? 0,
    status: r.status ?? "pending",
    accepted_at: r.accepted_at,
  }));
}
