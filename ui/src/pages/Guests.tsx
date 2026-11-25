import { useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp, ExternalLink, GripVertical, Search, Server } from "lucide-react";
import { Badge, Confirm, Empty, Notice, Page, RouteLink } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { machineMark, postJson, readSnapshot, reorderIds, useMediaQuery } from "../lib";
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
  const guestId = path.startsWith("/guests/") ? path.slice("/guests/".length) : "";
  const [mode, setMode] = useState<"boot" | "address">("boot");
  const [query, setQuery] = useState("");
  const serverOrder = useMemo(() => bootIds(state.services.rows), [state.services.rows]);
  const serverKey = serverOrder.join(",");
  const [order, setOrder] = useState(serverOrder);
  const [baseline, setBaseline] = useState(serverKey);
  const [confirmSave, setConfirmSave] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dragId = useRef("");
  const machineLinks = useRef(new Map<string, HTMLAnchorElement>());
  const inventoryRef = useRef<HTMLDivElement>(null);
  const narrow = useMediaQuery("(max-width: 1100px)");
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
    setMessage(null);
    const result = await postJson("/api/guests/order", { confirm: true, ids: order });
    setBusy(false);
    setConfirmSave(false);
    if (!result.ok) {
      setMessage({ ok: false, text: String(result.data.error || "The order was not saved.") });
      return;
    }
    setMessage({ ok: true, text: "Saved the boot order." });
    const snapshot = await readSnapshot();
    if (snapshot) onState(snapshot);
  }

  return (
    <Page title="Machines" context={state.figures?.memory_assigned ? `${state.services.summary} · ${state.figures.memory_assigned} assigned` : state.services.summary}>
      {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
      <div className={open && !narrow ? "machine-layout machine-layout-split" : "machine-layout"}>
        <div className="surface-card inventory" ref={inventoryRef} tabIndex={-1}>
          <div className="inventory-toolbar">
            <div className="inventory-search">
              <Search aria-hidden="true" />
              <Input type="search" aria-label="Filter machines" placeholder="Filter machines" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <ToggleGroup type="single" value={mode} aria-label="Sort by" onValueChange={(value) => {
              if (value === "boot" || value === "address") setMode(value);
            }}>
              <ToggleGroupItem value="boot">Boot order</ToggleGroupItem>
              <ToggleGroupItem value="address">Address</ToggleGroupItem>
            </ToggleGroup>
          </div>
          {mode === "boot" && dirty ? (
            <div className="inventory-pending">
              <span>{canDrag ? "Boot order has unsaved changes." : "Clear the filter to save the boot order."}</span>
              {canDrag ? <Button type="button" disabled={busy} onClick={() => setConfirmSave(true)}>Save boot order</Button> : null}
            </div>
          ) : null}
          {rows.length === 0 ? <Empty>{query.trim() ? "No machines match this filter." : "No machines were reported."}</Empty> : (
            <ol className="machines">
              {rows.map((row) => {
                const index = order.indexOf(row.id);
                const kindLine = `${row.kind === "vm" ? "VM" : "CT"} ${row.id}`;
                const selected = row.id === guestId;
                return (
                  <li key={row.id} className="machine" data-selected={selected || undefined}
                    draggable={canDrag}
                    onDragStart={() => { dragId.current = row.id; }}
                    onDragEnd={() => { dragId.current = ""; }}
                    onDragOver={(event) => { if (canDrag) event.preventDefault(); }}
                    onDrop={() => {
                      const from = dragId.current;
                      dragId.current = "";
                      if (canDrag && from) setOrder((current) => reorderIds(current, from, row.id));
                    }}
                  >
                    <RouteLink href={`/guests/${row.id}`} go={go} className="machine-id"
                      aria-current={selected ? "page" : undefined}
                      ref={(node) => { if (node) machineLinks.current.set(row.id, node); else machineLinks.current.delete(row.id); }}>
                      <span className="machine-glyph"><Server aria-hidden="true" /></span>
                      <span className="machine-identity">
                        <strong>{row.name}</strong>
                        <span className="meta">{mode === "address" ? machineMark("address", 0, row.address || "") : kindLine}</span>
                      </span>
                      <span className="machine-summary"><Badge value={row.status} /><span className="meta num">{row.memory || "—"}</span></span>
                      <ChevronRight className="machine-chevron" aria-hidden="true" />
                    </RouteLink>
                    {canDrag ? (
                      <span className="machine-move">
                        <span className="machine-rank num" aria-label={`Boot order ${index + 1}`}><GripVertical aria-hidden="true" />{index + 1}</span>
                        <IconButton label={`Move ${row.name} up`} disabled={index <= 0} onClick={() => shift(row.id, -1)}><ChevronUp aria-hidden="true" /></IconButton>
                        <IconButton label={`Move ${row.name} down`} disabled={index < 0 || index >= order.length - 1} onClick={() => shift(row.id, 1)}><ChevronDown aria-hidden="true" /></IconButton>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {open && !narrow ? <Dossier key={open.id} row={open} state={state} /> : null}
        {open && narrow ? (
          <Sheet open onOpenChange={(next) => { if (!next) go("/guests"); }}>
            <SheetContent className="machine-sheet" onCloseAutoFocus={(event) => {
              event.preventDefault();
              (machineLinks.current.get(open.id) || inventoryRef.current)?.focus();
            }}>
              <SheetTitle className="sr-only">{open.name}</SheetTitle>
              <Dossier key={open.id} row={open} state={state} />
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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canUpdate = row.kind !== "vm" && row.status === "Running";

  async function start() {
    setBusy(true);
    setMessage(null);
    const result = await postJson(`/api/guests/${row.id}/update`, { confirm: true });
    setBusy(false);
    setConfirm(false);
    setMessage({ ok: result.ok, text: result.ok ? "Starting the machine update." : String(result.data.error || "The machine update did not start.") });
  }

  return (
    <article className="surface-card machine-detail">
      <header className="machine-detail-header">
        <div>
          <h2 className="section-title" id="machine-detail-title" tabIndex={-1}>{row.name}</h2>
          <p className="meta">{row.kind === "vm" ? "VM" : "CT"} {row.id}{row.role ? ` · ${row.role}` : ""}</p>
        </div>
        <Badge value={row.status} />
      </header>
      <div className="row-actions">
        {safeHref(row.url) ? (
          <Button variant="outline" asChild>
            <a href={safeHref(row.url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${row.name}`}>Open <ExternalLink aria-hidden="true" /></a>
          </Button>
        ) : null}
        {canUpdate ? <Button type="button" onClick={() => setConfirm(true)}>Update this machine</Button> : null}
      </div>
      {message ? <Notice tone={message.ok ? "success" : "error"} message={message.text} /> : null}
      <dl className="machine-resources">
        <div><dt>CPU</dt><dd className="num">{row.cpu || "—"}</dd></div>
        <div><dt>Memory</dt><dd className="num">{row.memory || "—"}</dd></div>
        <div><dt>Disk</dt><dd className="num">{row.disk || "—"}</dd></div>
      </dl>
      {row.services.length ? (
        <section className="detail-group">
          <h3>Services</h3><ul className="service-tags">{row.services.map((service, index) => <li key={`${service}-${index}`}>{service}</li>)}</ul>
        </section>
      ) : null}
      <section className="detail-group">
        <h3>Blast radius</h3>
        {(row.blast || []).length === 0 ? <Empty>No later guests or shared disks were recorded.</Empty> : (
          <ul>{(row.blast || []).map((line) => <li key={line}>{line}</li>)}</ul>
        )}
      </section>
      {update || protection || plex ? (
        <section className="detail-group">
          <h3>Maintenance and protection</h3>
          <dl className="fact-list">
            {update ? <div><dt>Updates</dt><dd>{update.packages} packages waiting{update.security ? `, ${update.security} security` : ""}{update.floating ? ", floating image tag" : ""}{update.reboot ? ", reboot wanted" : ""}</dd></div> : null}
            {protection ? <div><dt>Protection</dt><dd>Backup {protection.backup}. Snapshot {protection.snapshot}.{protection.copy ? ` ${protection.copy}` : ""}</dd></div> : null}
            {plex ? <div><dt>Application</dt><dd>Plex {plex.version || "version unknown"}{plex.claimed === "1" ? ", claimed" : plex.claimed ? ", not claimed" : ""}. Render device {plex.render}.</dd></div> : null}
          </dl>
        </section>
      ) : null}
      {confirm ? (
        <Confirm
          title="Start the machine update"
          destructive
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
        <Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function safeHref(url: string) {
  return url.startsWith("https://") || url.startsWith("http://") ? url : "";
}
