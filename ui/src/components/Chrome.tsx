import { useEffect, useRef, type ReactNode } from "react";

export function Page({
  title,
  context,
  action,
  children,
}: {
  title: string;
  context?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{title}</h2>
          {context ? <p className="quiet">{context}</p> : null}
        </div>
        {action ? <div className="page-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function Badge({ value }: { value: string }) {
  const tone = value.toLowerCase();
  const kind = tone.includes("down") || tone.includes("stop") || tone === "low" || tone.includes("different")
    ? "down"
    : tone.includes("attention") || tone.includes("drift") || tone === "unknown"
      ? "attention"
      : tone.includes("run")
        ? "running"
        : "up";
  return <span className={`badge tone-${kind}`}>{value}</span>;
}

export function Meter({ label, free, total, low }: { label: string; free: string; total: string; low?: boolean }) {
  const freeN = parseFloat(free) || 0;
  const totalN = parseFloat(total) || 0;
  const used = totalN > 0 ? Math.max(0, Math.min(100, ((totalN - freeN) / totalN) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span className="num">{free && total ? `${free} free of ${total}` : "Unknown"}</span>
      </div>
      <div className="meter-track" aria-hidden="true">
        <span className={low ? "meter-fill low" : "meter-fill"} style={{ width: `${used}%` }} />
      </div>
    </div>
  );
}

export function Empty({ children }: { children: string }) {
  return <p className="quiet">{children}</p>;
}

export function Confirm({
  title,
  children,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  return (
    <div
      className="scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onCancel();
            return;
          }
          if (event.key !== "Tab" || !dialogRef.current) {
            return;
          }
          const items = [...dialogRef.current.querySelectorAll<HTMLButtonElement>("button")];
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <h3 id="confirm-title">{title}</h3>
        {children}
        <div className="row-actions">
          <button type="button" className="quiet-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" ref={confirmRef} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
