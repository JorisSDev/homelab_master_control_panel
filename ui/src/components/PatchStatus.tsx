import { Disclosure, Empty } from "./Chrome";
import type { GuestUpdateRow, GuestUpdates, ServiceRow, ViewState } from "../types";

function reportedCounts(total: number | null, security: number | null) {
  if (total === null || security === null || !Number.isInteger(total) || !Number.isInteger(security)
    || security < 0 || total < security) return null;
  return { total, security };
}

type Counts = NonNullable<ReturnType<typeof reportedCounts>>;

function packageLine({ total, security }: Counts) {
  if (total === 0) return "No candidates reported";
  return `${security} security · ${total - security} other`;
}

export function machinePackageStatus(machine: ServiceRow, guests: GuestUpdates, result?: GuestUpdateRow) {
  const running = machine.kind !== "vm" && machine.status === "Running";
  const counts = running && guests.checked && !guests.error && result && !result.error && !result.recheck
    ? reportedCounts(result.packages, result.security)
    : null;
  let label = "Not checked";
  if (machine.kind === "vm") label = "Outside container check";
  else if (machine.status === "Stopped") label = "Stopped";
  else if (!running) label = "Machine status unavailable";
  else if (counts) label = packageLine(counts);
  else if (guests.error || result?.error) label = "Check incomplete";
  else if (result?.recheck) label = "Check again after update";
  else if (guests.checked && result) label = "Result unavailable";
  return { running, counts, label };
}

export function patchStatusOf(state: ViewState) {
  const packages = state.packages;
  const hostCounts = packages.checked && !packages.error ? reportedCounts(packages.total, packages.security) : null;
  const host = hostCounts ? packageLine(hostCounts) : packages.error ? "Check failed" : packages.checked ? "Result unavailable" : "Not checked";

  const guests = state.guest_updates;
  const byId = new Map(guests.rows.map((row) => [row.id, row]));
  const machines = state.services.rows.map((machine) => {
    const result = byId.get(machine.id);
    return { machine, result, ...machinePackageStatus(machine, guests, result) };
  }).sort((a, b) => (b.counts?.security ?? 0) - (a.counts?.security ?? 0));
  const running = machines.filter((row) => row.running);
  const reported = running.filter((row) => row.counts);
  const containerCounts = reported.reduce(
    (sum, { counts }) => ({ total: sum.total + (counts?.total ?? 0), security: sum.security + (counts?.security ?? 0) }),
    { total: 0, security: 0 },
  );
  let containers = "Not checked";
  if (reported.length) containers = packageLine(containerCounts);
  else if (!machines.length) containers = "Inventory unavailable";
  else if (!running.length) containers = "No running containers reported";
  else if (guests.checked || guests.error) containers = "No usable results";

  const plex = state.plex;
  let application = "No version check configured";
  if (plex && (plex.version_configured ?? Boolean(plex.version || plex.minimum))) {
    const labels = {
      below: "Plex below minimum",
      meets: "Plex meets minimum",
      "no-minimum": "Plex minimum not set",
      unknown: "Plex comparison unavailable",
    };
    application = labels[plex.version_status ?? "unknown"];
  }

  return { host, hostCounts, containers, containerCounts, running: running.length, reported: reported.length, machines, application, plex };
}

type PatchStatus = ReturnType<typeof patchStatusOf>;

export function PatchSummary({ patch }: { patch: PatchStatus }) {
  return (
    <dl className="patch-summary">
      <div>
        <dt>Host packages</dt>
        <dd className={patch.hostCounts?.security ? "patch-review" : undefined}>{patch.host}</dd>
      </div>
      <div>
        <dt>Container packages</dt>
        <dd className={patch.containerCounts.security ? "patch-review" : undefined}>{patch.containers}</dd>
        {patch.running > 0 ? <dd className="meta">{patch.reported} of {patch.running} running containers reported</dd> : null}
      </div>
      <div>
        <dt>Application versions</dt>
        <dd className={patch.plex?.version_status === "below" ? "patch-review" : undefined}>{patch.application}</dd>
      </div>
    </dl>
  );
}

export function ContainerPatchDetails({ patch }: { patch: PatchStatus }) {
  if (!patch.machines.length) return <Empty>No machines were read.</Empty>;
  return (
    <ul className="patch-machines" aria-label="Machine package coverage">
      {patch.machines.map(({ machine, result, counts, label }) => (
        <li key={machine.id}>
          <div className="patch-machine">
            <strong>{machine.name} <span className="meta num">{machine.id}</span></strong>
            <span className={counts?.security ? "patch-review num" : undefined}>{label}</span>
          </div>
          {result?.error ? <p className="meta">{result.error}</p> : null}
          {result && (result.compose.length || result.floating || result.reboot) ? (
            <Disclosure label="Recorded Compose and reboot details">
              {result.compose.length ? <p>Compose projects <span className="technical">{result.compose.join(", ")}</span></p> : null}
              {result.floating ? <p>Floating image tag detected.</p> : null}
              {result.reboot ? <p>Reboot requested.</p> : null}
            </Disclosure>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
