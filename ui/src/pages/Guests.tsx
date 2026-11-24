import { useMemo, useRef, useState } from "react";
import { Badge, Confirm, Empty, Page } from "../components/Chrome";
import { machineMark, postJson, reorderIds } from "../lib";
import type { ServiceRow, ViewState } from "../types";

export function Guests({
  state,
  path,
  go,
  onState,
}: {
  state: ViewState;
  path: string;
  go: (path: string) => void;
  onState: (next: ViewState) => void;
}) {
  const guestId = path.startsWith("/guests/") ? decodeURIComponent(path.slice("/guests/".length)) : "";
  const [mode, setMode] = useState<"boot" | "address">("boot");
  const [query, setQuery] = useState("");
  const serverOrder = useMemo(() => bootIds(state.services.rows), [state.services.rows]);
  const serverKey = serverOrder.join(",");
  const [order, setOrder] = useState(serverOrder);
  const [baseline, setBaseline] = useState(serverKey);
  const [confirmSave, setConfirmSave] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dragId = useRef("");
  if (baseline !== serverKey) {
    setBaseline(serverKey);
    setOrder(serverOrder);
  }
  const dirty = order.join(",") !== serverKey;
  const rows = useMemo(() => arrange(state.services.rows, mode, query, order), [state.services.rows, mode, query, order]);
  const open = rows.find((row) => row.id === guestId) || state.services.rows.find((row) => row.id === guestId);
  const canDrag = mode === "boot" && query.trim() === "";

  async function save() {
    setBusy(true);
    setMessage("");
    const result = await postJson("/api/guests/order", { confirm: true, ids: order });
    setBusy(false);
    setConfirmSave(false);
    if (!result.ok) {
      setMessage(String(result.data.error || "The order was not saved."));
      return;
    }
    setMessage("Saved the boot order.");
    const response = await fetch("/api/state", { cache: "no-store" });
    if (response.ok) {
      onState((await response.json()) as ViewState);
    }
  }

  return (
    <Page title="Machines" context={state.figures?.memory_assigned ? `${state.figures.memory_assigned} assigned` : state.services.summary}>
      <div className="toolbar">
        <input
          className="filter"
          type="search"
          aria-label="Filter"
          placeholder="Filter"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="sort" role="group" aria-label="Sort">
          <span>Sort</span>
          <button type="button" aria-pressed={mode === "boot"} onClick={() => setMode("boot")}>
            Boot
          </button>
          <button type="button" aria-pressed={mode === "address"} onClick={() => setMode("address")}>
            Address
          </button>
        </div>
        {mode === "boot" ? (
          <button type="button" disabled={!dirty || busy} onClick={() => setConfirmSave(true)}>
            Save
          </button>
        ) : null}
      </div>
      {message ? <p className={message.startsWith("Saved") ? "ok" : "bad"}>{message}</p> : null}
      <div className={open ? "split" : ""}>
        <ol className="sequence">
          {rows.length === 0 ? <Empty>No machines were reported.</Empty> : null}
          {rows.map((row) => (
            <li
              key={row.id}
              className={row.id === guestId ? "selected" : ""}
              draggable={canDrag}
              onDragStart={() => {
                dragId.current = row.id;
              }}
              onDragOver={(event) => {
                if (canDrag) {
                  event.preventDefault();
                }
              }}
              onDrop={() => {
                const from = dragId.current;
                dragId.current = "";
                if (canDrag && from) {
                  setOrder((current) => reorderIds(current, from, row.id));
                }
              }}
            >
              <a
                href={`/guests/${row.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(`/guests/${row.id}`);
                }}
              >
                <span className="num">{machineMark(mode, Math.max(order.indexOf(row.id), 0) + 1, row.address || "")}</span>
                <span>
                  <strong>{row.name}</strong>
                  <span className="note">
                    {row.kind === "vm" ? "VM" : "CT"} {row.id}
                    {row.role ? ` · ${row.role}` : ""}
                    {row.services.length ? ` · ${row.services.join(", ")}` : ""}
                    {` · ${row.memory || "—"}`}
                  </span>
                </span>
                <Badge value={row.status} />
              </a>
              {safeHref(row.url) ? (
                <a className="text-link" href={safeHref(row.url)} target="_blank" rel="noopener noreferrer">
                  Open the service
                </a>
              ) : null}
            </li>
          ))}
        </ol>
        {open ? <Dossier row={open} state={state} /> : null}
      </div>
      {confirmSave ? (
        <Confirm title="Save boot order" confirmLabel="Save" busy={busy} onCancel={() => setConfirmSave(false)} onConfirm={() => void save()}>
          <p>This changes the order used the next time the host starts. Nothing restarts now.</p>
        </Confirm>
      ) : null}
    </Page>
  );
}

function bootIds(rows: ServiceRow[]) {
  return arrange(rows, "boot", "", []).map((row) => row.id);
}

function arrange(rows: ServiceRow[], mode: "boot" | "address", query: string, order: string[]) {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((row) => `${row.name} ${row.id} ${row.role || ""} ${row.services.join(" ")} ${row.address || ""}`.toLowerCase().includes(needle))
    : rows;
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...filtered].sort((left, right) => {
    if (mode === "address") {
      return (left.address || "zzz").localeCompare(right.address || "zzz", undefined, { numeric: true });
    }
    const leftRank = rank.get(left.id);
    const rightRank = rank.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? 10000) - (rightRank ?? 10000);
    }
    const leftOrder = left.order ?? 10000;
    const rightOrder = right.order ?? 10000;
    return leftOrder - rightOrder || Number(left.id) - Number(right.id);
  });
}

function Dossier({ row, state }: { row: ServiceRow; state: ViewState }) {
  const plex = state.plex && state.plex.id === row.id ? state.plex : null;
  const update = state.guest_updates.rows.find((item) => item.id === row.id);
  const protection = state.protection?.rows.find((item) => item.id === row.id);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const canUpdate = row.kind !== "vm" && row.status === "Running";

  async function start() {
    setBusy(true);
    setMessage("");
    const result = await postJson(`/api/guests/${row.id}/update`, { confirm: true });
    setBusy(false);
    setConfirm(false);
    setMessage(result.ok ? "Starting the machine update." : String(result.data.error || "The machine update did not start."));
  }

  return (
    <article className="dossier">
      <header className="page-head">
        <div>
          <h2>{row.name}</h2>
          <p className="quiet">
            {row.kind === "vm" ? "VM" : "CT"} {row.id}
            {row.role ? ` · ${row.role}` : ""}
          </p>
        </div>
        <div className="page-action">
          <Badge value={row.status} />
          {canUpdate ? (
            <button type="button" onClick={() => setConfirm(true)}>
              Update this machine
            </button>
          ) : null}
        </div>
      </header>
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      <p className="num">
        {row.cpu || "—"} CPU · {row.memory || "—"} memory · {row.disk || "—"} disk
      </p>
      {safeHref(row.url) ? (
        <p>
          <a href={safeHref(row.url)} target="_blank" rel="noopener noreferrer">
            Open the service
          </a>
        </p>
      ) : null}
      <h3>Blast radius</h3>
      {(row.blast || []).length === 0 ? <Empty>No later guests or shared disks were recorded.</Empty> : null}
      <ul>
        {(row.blast || []).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {update ? (
        <p>
          {update.packages} packages waiting
          {update.security ? `, ${update.security} security` : ""}
          {update.floating ? ", floating image tag" : ""}
          {update.reboot ? ", reboot wanted" : ""}
        </p>
      ) : null}
      {protection ? (
        <p>
          Backup {protection.backup}. Snapshot {protection.snapshot}.
          {protection.copy ? ` ${protection.copy}` : ""}
        </p>
      ) : null}
      {plex ? (
        <p>
          Plex {plex.version || "version unknown"}
          {plex.claimed === "1" ? ", claimed" : plex.claimed ? ", not claimed" : ""}. Render device {plex.render}.
        </p>
      ) : null}
      {row.services.length > 0 ? <p>{row.services.join(", ")}</p> : null}
      {confirm ? (
        <Confirm
          title="Start the machine update"
          confirmLabel="Start the machine update"
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void start()}
        >
          <p>This updates packages on {row.name} and can recreate its Compose services.</p>
        </Confirm>
      ) : null}
    </article>
  );
}

function safeHref(url: string) {
  return url.startsWith("https://") || url.startsWith("http://") ? url : "";
}
