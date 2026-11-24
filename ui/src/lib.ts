import type { Digest, ViewState } from "./types";

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
  const response = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    window.location.reload();
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}
