"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createCreatorAction } from "@/lib/actions/ops-actions";

/**
 * New-creator form. Server action target is `/api/creators` (POST). The
 * form only requires handle + platform; everything else is optional and
 * gets filled in via the profile edit flow (M4-B follow-ups).
 */
export function NewCreatorForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [handle, setHandle] = useState("");
  const [platform, setPlatform] = useState<
    "tiktok" | "instagram" | "youtube" | "twitch" | "other"
  >("tiktok");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [categories, setCategories] = useState("");
  const [followers, setFollowers] = useState("");
  const [engagement, setEngagement] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      const engagementNum = engagement ? Number(engagement) : undefined;
      const followersNum = followers ? Number(followers) : undefined;
      if (engagementNum !== undefined && (engagementNum < 0 || engagementNum > 1)) {
        setErr("engagement_rate must be between 0 and 1 (e.g. 0.045 for 4.5%)");
        return;
      }

      const { status, body } = await createCreatorAction({
        handle: handle.trim(),
        platform,
        display_name: displayName.trim() || undefined,
        contact_email: email.trim() || undefined,
        base_country: country.trim() ? country.trim().toUpperCase() : undefined,
        primary_categories: categories
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c.length > 0),
        follower_count: followersNum,
        engagement_rate: engagementNum,
      });
      if (status !== 201 || body.error) {
        setErr(body.error ?? `HTTP ${status}`);
        return;
      }
      router.push(`/creators/${body.creator!.id}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md border border-border bg-panel p-4 space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Handle" required>
          <input
            required
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@thecreator"
            className="mono w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          />
        </Field>
        <Field label="Platform" required>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as typeof platform)}
            className="mono w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          >
            <option value="tiktok">tiktok</option>
            <option value="instagram">instagram</option>
            <option value="youtube">youtube</option>
            <option value="twitch">twitch</option>
            <option value="other">other</option>
          </select>
        </Field>
        <Field label="Display name">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          />
        </Field>
        <Field label="Contact email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          />
        </Field>
        <Field label="Country (ISO)">
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            maxLength={2}
            placeholder="US"
            className="mono w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60 uppercase"
          />
        </Field>
        <Field label="Categories (comma-sep)">
          <input
            value={categories}
            onChange={(e) => setCategories(e.target.value)}
            placeholder="beauty, tech"
            className="w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          />
        </Field>
        <Field label="Followers">
          <input
            type="number"
            min={0}
            value={followers}
            onChange={(e) => setFollowers(e.target.value)}
            className="mono w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          />
        </Field>
        <Field label="Engagement rate (0-1)">
          <input
            type="number"
            step="0.001"
            min={0}
            max={1}
            value={engagement}
            onChange={(e) => setEngagement(e.target.value)}
            placeholder="0.045"
            className="mono w-full text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          />
        </Field>
      </div>

      {err && (
        <div className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
          {err}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border border-border-strong text-text hover:bg-panel-hover"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || !handle}
          className={`mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border transition-colors ${
            pending
              ? "border-warn/40 text-warn"
              : "border-accent/40 text-accent hover:bg-accent/10"
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {pending ? "Creating…" : "Create creator"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
        {label}
        {required && <span className="text-warn ml-1">*</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
