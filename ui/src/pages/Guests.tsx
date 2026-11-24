import { useMemo, useState } from "react";
import { Badge, Confirm, Empty, Page } from "../components/Chrome";
import { postJson } from "../lib";
import type { ServiceRow, ViewState } from "../types";

export function Guests({
  state,
  path,
  go,
}: {
  state: ViewState;
  path: string;
  go: (path: string) => void;
}) {
  const guestId = path.startsWith("/guests/") ? decodeURIComponent(path.slice("/guests/".length)) : "";
  const [mode, setMode] = useState<"boot" | "address">("boot");
  const [query, setQuery] = useState("");
  const rows = useMemo(() => arrange(state.services.rows, mode, query), [state.services.rows, mode, query]);
  const open = rows.find((row) => row.id === guestId) || state.services.rows.find((row) => row.id === guestId);

  return (
    <Page
      title="Guests"
      context={state.figures?.memory_assigned ? `${state.figures.memory_assigned} assigned` : state.services.summary}
      action={
        <div className="row-actions">
          <button type="button" className={mode === "boot" ? "" : "quiet-button"} onClick={() => setMode("boot")}>
            Boot order
          </button>
          <button type="button" className={mode === "address" ? "" : "quiet-button"} onClick={() => setMode("address")}>
            Address
          </button>
        </div>
      }
    >
      <input
        className="filter"
        type="search"
        aria-label="Filter"
        placeholder="Filter"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className={open ? "split" : ""}>
        <ol className="sequence">
          {rows.length === 0 ? <Empty>No guests were reported.</Empty> : null}
          {rows.map((row) => (
            <li key={row.id} className={row.id === guestId ? "selected" : ""}>
              <a
                href={`/guests/${row.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  go(`/guests/${row.id}`);
                }}
              >
                <span className="num">{row.order ?? "–"}</span>
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
    </Page>
  );
}

function arrange(rows: ServiceRow[], mode: "boot" | "address", query: string) {
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((row) => `${row.name} ${row.id} ${row.role || ""} ${row.services.join(" ")}`.toLowerCase().includes(needle))
    : rows;
  return [...filtered].sort((left, right) => {
    if (mode === "address") {
      return (left.address || "zzz").localeCompare(right.address || "zzz");
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
    setMessage(result.ok ? "Starting the guest update." : String(result.data.error || "The guest update did not start."));
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
              Update this guest
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
          title="Start the guest update"
          confirmLabel="Start the guest update"
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
