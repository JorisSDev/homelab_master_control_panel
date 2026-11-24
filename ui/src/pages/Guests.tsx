import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Badge, Confirm, Empty, Page } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
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
  const narrow = useNarrow();
  if (baseline !== serverKey) {
    setBaseline(serverKey);
    setOrder(serverOrder);
  }
  const dirty = order.join(",") !== serverKey;
  const rows = useMemo(() => arrange(state.services.rows, mode, query, order), [state.services.rows, mode, query, order]);
  const open = rows.find((row) => row.id === guestId) || state.services.rows.find((row) => row.id === guestId);
  const canDrag = mode === "boot" && query.trim() === "";

  function shift(id: string, direction: -1 | 1) {
    setOrder((current) => {
      const index = current.indexOf(id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current.length) {
        return current;
      }
      return reorderIds(current, id, current[next]);
    });
  }

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
        <span className="meta">Sort by</span>
        <ToggleGroup
          type="single"
          value={mode}
          aria-label="Sort by"
          onValueChange={(value) => {
            if (value === "boot" || value === "address") {
              setMode(value);
            }
          }}
        >
          <ToggleGroupItem value="boot">Boot</ToggleGroupItem>
          <ToggleGroupItem value="address">Address</ToggleGroupItem>
        </ToggleGroup>
        {mode === "boot" && dirty ? (
          <Button type="button" disabled={busy} onClick={() => setConfirmSave(true)}>
            Save
          </Button>
        ) : null}
      </div>
      {message ? <p className={message.startsWith("Saved") ? "ok" : "bad"}>{message}</p> : null}
      <div className={open && !narrow ? "split" : ""}>
        <ol className="machines">
          {rows.length === 0 ? <Empty>No machines were reported.</Empty> : null}
          {rows.map((row) => {
            const index = order.indexOf(row.id);
            const kindLine = `${row.kind === "vm" ? "VM" : "CT"} ${row.id}`;
            return (
              <li
                key={row.id}
                className={row.id === guestId ? "machine selected" : "machine"}
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
                  className="machine-id"
                  href={`/guests/${row.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    go(`/guests/${row.id}`);
                  }}
                >
                  <span className="machine-order num">{machineMark("boot", Math.max(index, 0) + 1, "")}</span>
                  <span>
                    <strong>{row.name}</strong>
                    <span className="meta">{mode === "address" ? machineMark("address", 0, row.address || "") : kindLine}</span>
                  </span>
                </a>
                <Badge value={row.status} />
                <span className="machine-memory num">{row.memory || "—"}</span>
                {canDrag ? (
                  <span className="machine-move">
                    <IconButton label={`Move ${row.name} up`} disabled={index <= 0} onClick={() => shift(row.id, -1)}>
                      <ChevronUp aria-hidden="true" />
                    </IconButton>
                    <IconButton label={`Move ${row.name} down`} disabled={index < 0 || index >= order.length - 1} onClick={() => shift(row.id, 1)}>
                      <ChevronDown aria-hidden="true" />
                    </IconButton>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        {open && !narrow ? <Dossier row={open} state={state} /> : null}
        {open && narrow ? (
          <Sheet open onOpenChange={(next) => { if (!next) go("/guests"); }}>
            <SheetContent aria-describedby={undefined}>
              <SheetTitle className="sr-only">{open.name}</SheetTitle>
              <Dossier row={open} state={state} />
            </SheetContent>
          </Sheet>
        ) : null}
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
          <strong className="machine-title">{row.name}</strong>
          <p className="meta">
            {row.kind === "vm" ? "VM" : "CT"} {row.id}
            {row.role ? ` · ${row.role}` : ""}
          </p>
        </div>
        <div className="page-action">
          <Badge value={row.status} />
          {safeHref(row.url) ? (
            <Button variant="outline" size="icon" asChild>
              <a href={safeHref(row.url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${row.name}`}>
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
          ) : null}
          {canUpdate ? (
            <Button type="button" onClick={() => setConfirm(true)}>
              Update this machine
            </Button>
          ) : null}
        </div>
      </header>
      {message ? <p className={message.startsWith("Starting") ? "ok" : "bad"}>{message}</p> : null}
      <p className="num">
        {row.cpu || "—"} CPU · {row.memory || "—"} memory · {row.disk || "—"} disk
      </p>
      <p className="section-label">Blast radius</p>
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

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(max-width: 1100px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return narrow;
}

function safeHref(url: string) {
  return url.startsWith("https://") || url.startsWith("http://") ? url : "";
}
