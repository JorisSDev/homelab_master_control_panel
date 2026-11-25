import { useEffect, useState } from "react";
import type { Digest, ViewState } from "./types";

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function capacityMb(value: string) {
  const match = value.trim().match(/^([\d.]+)\s*(TB|GB|MB)?$/i);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  if (!Number.isFinite(number)) {
    return null;
  }
  const unit = (match[2] || "GB").toUpperCase();
  return number * (unit === "TB" ? 1024 ** 2 : unit === "GB" ? 1024 : 1);
}

export function digestOf(state: ViewState): Digest {
  return {
    scan: state.scan.detail,
    update: state.update.detail,
    guests: state.services.rows.map((row) => `${row.id}:${row.status}`).join(","),
    monitors: (state.reach?.monitors.rows || []).map((row) => `${row.name}:${row.status}`).join(","),
    disk: state.storage.summary,
    event: state.chronology?.[0]?.text || "",
  };
}

export function reorderIds(ids: string[], from: string, to: string): string[] {
  const fromIndex = ids.indexOf(from);
  const toIndex = ids.indexOf(to);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return [...ids];
  }
  const next = [...ids];
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, from);
  return next;
}

export function machineMark(mode: "boot" | "address", order: number, address: string): string {
  if (mode === "address") {
    return address || "—";
  }
  return String(order);
}

export function awayLines(before: Digest, after: Digest): string[] {
  const lines: string[] = [];
  if (before.scan !== after.scan) {
    lines.push(`Scan is now ${after.scan}`);
  }
  if (before.update !== after.update) {
    lines.push(`Update is now ${after.update}`);
  }
  if (before.guests !== after.guests) {
    lines.push("A guest changed state.");
  }
  if (before.monitors !== after.monitors) {
    lines.push("A monitor changed.");
  }
  if (before.disk !== after.disk) {
    lines.push(`Storage is now ${after.disk}`);
  }
  if (before.event !== after.event && after.event) {
    lines.push(after.event);
  }
  return lines;
}

export async function postJson(url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401 && url !== "/api/login") window.location.reload();
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data: data && typeof data === "object" ? data : {} };
  } catch {
    return { ok: false, status: 0, data: { error: "The panel did not respond. Check the current state before trying again." } };
  }
}

export async function readSnapshot(): Promise<ViewState | null> {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    return response.ok ? await response.json() as ViewState : null;
  } catch {
    return null;
  }
}
