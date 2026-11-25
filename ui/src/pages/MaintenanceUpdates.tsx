import { ChevronRight, Layers, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Confirm, Disclosure, Empty, Notice } from "../components/Chrome";
import { Button } from "../components/ui/button";
import { postJson, readSnapshot } from "../lib";
import type { MaintenanceResult, MaintenanceTarget, RecoveryEvidence, UpdateReview, ViewState } from "../types";

const timestamp = new Intl.DateTimeFormat("lt-LT", { dateStyle: "short", timeStyle: "short" });

export function maintenanceTime(value?: string) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? timestamp.format(date) : "Time unknown";
}

function securityFinding({ packages, maintenance }: ViewState) {
  const count = packages.security;
  const last = maintenance?.security.last_run;
  if (last?.status === "success" && (!packages.checked_at || Date.parse(packages.checked_at) < Date.parse(last.at))) {
    return "Check again after the last install";
  }
  if (packages.error) return "Last check failed";
  if (!packages.checked || count === null || !Number.isInteger(count) || count < 0) return "Check needed";
  if (count === 0) return "No security candidates in the last check";
  return `${count} security ${count === 1 ? "candidate" : "candidates"} in the last check`;
}

function checkAge(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return "Check time unknown";
  return Date.now() - time > 24 * 60 * 60 * 1000 ? "Check older than 24 hours" : `Checked ${maintenanceTime(value)}`;
}

const automationNames = {
  scheduled: "Scheduled",
  paused: "Paused",
  not_configured: "Off",
  unknown: "Status unknown",
};

export function MaintenanceUpdates({ state, onState }: { state: ViewState; onState: (next: ViewState) => void }) {
  const updates = state.maintenance;
  const security = updates?.security;
  const apps = updates?.apps || [];
  const finding = securityFinding(state);
  const showAttention = finding.endsWith("in the last check") && Boolean(state.packages.security);
  return (
    <section className="surface-card maintenance-queue" aria-label="Available update workflows">
      <div className="maintenance-row">
        <span className="maintenance-icon"><ShieldCheck aria-hidden="true" /></span>
        <div className="maintenance-copy">
          <div className="maintenance-heading"><h2>Host security</h2>{updates?.active ? <Badge value="Update running" /> : null}</div>
          <p className={showAttention ? "patch-review" : undefined}>{finding}</p>
          <span className="meta">Proxmox host only · Automation {security ? automationNames[security.automation].toLowerCase() : "status unknown"}{state.packages.checked ? ` · ${checkAge(state.packages.checked_at)}` : ""}</span>
          {security?.blocker ? <span className="meta">{security.blocker}</span> : null}
          {security?.last_run ? <LastResult result={security.last_run} /> : null}
          {security?.automation_check ? <span className="meta">Automation · {security.automation_check.message} · {maintenanceTime(security.automation_check.at)}</span> : null}
        </div>
        {security ? <ReviewControl target={security} active={Boolean(updates?.active)} onState={onState} /> : null}
      </div>
      <div className="maintenance-row">
        <span className="maintenance-icon"><Layers aria-hidden="true" /></span>
        <div className="maintenance-copy">
          <div className="maintenance-heading"><h2>Apps</h2></div>
          <p>Review and update one Compose service at a time.</p>
          {apps.length === 0 ? <span className="meta">No apps enrolled for updates.</span> : null}
        </div>
        {apps.length ? (
          <ul className="maintenance-apps">
            {apps.map(app => (
              <li key={app.id}>
                <div>
                  <strong>{app.name}</strong>
                  <span className="meta">{app.blocker || "Ready to check for a candidate"}</span>
                  {app.last_run ? <LastResult result={app.last_run} /> : null}
                </div>
                <ReviewControl target={app} active={Boolean(updates?.active)} onState={onState} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function LastResult({ result }: { result: MaintenanceResult }) {
  return (
    <div className="maintenance-result">
      <span className={["blocked", "failed"].includes(result.status) ? "meta patch-review" : "meta"}>{result.message} · {maintenanceTime(result.at)}</span>
      {result.reboot_required ? <span className="meta patch-review">A reboot needs separate review.</span> : null}
      {result.retained_image ? <Disclosure label="Retained recovery image"><span className="technical">{result.retained_image}</span></Disclosure> : null}
    </div>
  );
}

function RecoverySummary({ backup }: { backup: RecoveryEvidence | null }) {
  if (!backup) return <p>No tested recovery evidence is recorded.</p>;
  return (
    <div className="maintenance-result">
      <p>{backup.fresh ? "Fresh backup recorded" : "Last backup is older than 24 hours"} · Restore tested {maintenanceTime(backup.restore_tested_at)}</p>
      {backup.same_disk ? <p>Recovery copy shares the live storage disk.</p> : null}
      <span className="meta">{backup.reference} · Backup {maintenanceTime(backup.backup_at)}</span>
    </div>
  );
}

function ReviewControl({ target, active, onState }: { target: MaintenanceTarget; active: boolean; onState: (next: ViewState) => void }) {
  const [review, setReview] = useState<UpdateReview | null>(null);
  const [busy, setBusy] = useState<"check" | "apply" | "">("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const security = target.id === "security";
  const endpoint = `/api/maintenance/${security ? "security" : `apps/${encodeURIComponent(target.id)}`}`;

  async function prepare() {
    setMessage(null);
    setBusy("check");
    const result = await postJson(`${endpoint}/preview`, {});
    setBusy("");
    if (result.ok) setReview(result.data as unknown as UpdateReview);
    else setMessage({ text: String(result.data.error || "The review could not be prepared."), error: true });
  }

  async function apply() {
    if (!review?.available || review.blocker || active || busy) return;
    setBusy("apply");
    const result = await postJson(`${endpoint}/apply`, { plan_id: review.id, confirm: true });
    setBusy("");
    setReview(null);
    setMessage({ text: result.ok ? "Update requested. The result will appear here." : String(result.data.error || "The update could not start."),
                 error: !result.ok });
    const snapshot = await readSnapshot();
    if (snapshot) onState(snapshot);
  }

  return (
    <div className="maintenance-actions">
      <Button ref={trigger} type="button" variant="outline" disabled={!target.can_preview || active || Boolean(busy)} onClick={() => void prepare()}>
        {busy === "check" ? "Preparing…" : `Review ${security ? "host patches" : target.name}`}<ChevronRight aria-hidden="true" />
      </Button>
      {message ? <Notice message={message.text} tone={message.error ? "error" : "neutral"} /> : null}
      {review ? (
        <Confirm title={security ? "Review host security patches" : `Review ${target.name} update`}
          confirmLabel={security ? "Install host patches" : `Update ${target.name}`} destructive
          confirmDisabled={!review.available || Boolean(review.blocker) || active} busy={busy === "apply"}
          onCancel={() => setReview(null)} onConfirm={() => void apply()} returnFocus={trigger.current}>
          <p>{security ? "Target is the Proxmox host. Package scripts may restart services. The panel will leave any reboot for a separate decision."
            : `Target is ${target.name}. Replacing the service can briefly interrupt access.`}</p>
          {review.packages?.length ? (
            <p><strong>{review.packages.length} reviewed {review.packages.length === 1 ? "package" : "packages"}</strong>
              {review.packages.some(pkg => pkg.critical) ? " · Critical changes included" : ""}</p>
          ) : null}
          <RecoverySummary backup={review.backup} />
          {review.blocker ? <Notice message={review.blocker} tone="warning" /> : null}
          {!review.available ? <p>{security ? "No security candidates in this check." : "The reviewed image is already running."}</p> : null}
          <Disclosure label="Technical details">
            <span className="meta">Review expires {maintenanceTime(review.expires_at)}</span>
            {review.packages?.length ? <ul className="maintenance-package-list">{review.packages.map(pkg => (
              <li key={pkg.name}><strong>{pkg.name}</strong><span className="technical">{pkg.current} → {pkg.candidate}</span>
                {pkg.critical ? <span className="meta patch-review">Critical package · Manual review</span> : null}</li>
            ))}</ul> : null}
            {review.candidate ? (
              <dl className="fact-list">
                <div><dt>Running image</dt><dd className="technical">{review.version || review.current}</dd></div>
                <div><dt>Candidate</dt><dd className="technical">{review.candidate}</dd></div>
              </dl>
            ) : null}
          </Disclosure>
        </Confirm>
      ) : null}
    </div>
  );
}

export function MaintenanceHistory({ state }: { state: ViewState }) {
  const history = state.maintenance?.history || [];
  if (!history.length) return <Empty>No reviewed update runs have been recorded.</Empty>;
  return (
    <ul className="maintenance-history">
      {history.map((event, index) => {
        const name = event.target === "security" ? "Host security" : state.maintenance?.apps.find(app => app.id === event.target)?.name || event.target;
        const status = { success: "Completed", failed: "Failed", blocked: "Blocked", running: "Running" }[event.status];
        return (
          <li key={`${event.at}-${event.target}-${index}`}>
            <Disclosure label={<span>{name} · <time dateTime={event.at}>{maintenanceTime(event.at)}</time> · {status}</span>}>
              <LastResult result={event} />
            </Disclosure>
          </li>
        );
      })}
    </ul>
  );
}
