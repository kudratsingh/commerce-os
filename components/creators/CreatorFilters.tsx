"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import type { CreatorStatus } from "@/lib/domain/creators";

/**
 * Client-side filter bar. Serializes state into the URL so the server
 * component re-renders with the filtered data on `router.push`. Same
 * pattern as the /orders page.
 */

const STATUSES: CreatorStatus[] = [
  "prospect",
  "contacted",
  "replied",
  "accepted",
  "active",
  "declined",
  "blocked",
];

const PLATFORMS = ["tiktok", "instagram", "youtube", "twitch", "other"];

export function CreatorFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [status, setStatus] = useState<string>(params.get("status") ?? "");
  const [platform, setPlatform] = useState<string>(params.get("platform") ?? "");
  const [search, setSearch] = useState<string>(params.get("search") ?? "");

  function apply(next: {
    status?: string;
    platform?: string;
    search?: string;
  }) {
    const q = new URLSearchParams(params.toString());
    const setOrDelete = (key: string, value: string) => {
      if (value) q.set(key, value);
      else q.delete(key);
    };
    setOrDelete("status", next.status ?? status);
    setOrDelete("platform", next.platform ?? platform);
    setOrDelete("search", next.search ?? search);
    startTransition(() => {
      router.push(`/creators${q.toString() ? "?" + q.toString() : ""}`);
    });
  }

  function clear() {
    setStatus("");
    setPlatform("");
    setSearch("");
    startTransition(() => {
      router.push("/creators");
    });
  }

  return (
    <div className="rounded-md border border-border bg-panel px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <FieldWrap label="Search">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply({ search });
            }}
            onBlur={() => apply({ search })}
            placeholder="handle or name"
            className="mono text-sm bg-bg border border-border-strong rounded px-2 py-1.5 w-56 focus:outline-none focus:border-accent/60"
          />
        </FieldWrap>
        <FieldWrap label="Status">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              apply({ status: e.target.value });
            }}
            className="mono text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          >
            <option value="">any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label="Platform">
          <select
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              apply({ platform: e.target.value });
            }}
            className="mono text-sm bg-bg border border-border-strong rounded px-2 py-1.5 focus:outline-none focus:border-accent/60"
          >
            <option value="">any</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </FieldWrap>
        <div className="flex items-center gap-2 pb-0.5">
          <button
            onClick={clear}
            disabled={pending || (!status && !platform && !search)}
            className="mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded border border-border-strong text-text hover:bg-panel-hover disabled:opacity-40"
          >
            {pending ? "…" : "Clear"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldWrap({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
